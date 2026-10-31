import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Upload,
  FileText,
  Folder,
  FolderOpen,
  FolderSearch,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Plus,
  Eraser,
  Trash2,
  FileCheck,
  Search,
  X,
  Sparkles,
  Layers,
  HardDrive,
  FileSpreadsheet,
  Image as ImageIcon,
  Mic,
  ChevronRight,
  ArrowUp,
  CheckSquare,
  Square,
  Home,
  RotateCcw,
  Clock,
  Play,
  Database,
  ExternalLink,
  RefreshCw,
  Eye,
  ChevronDown,
  ChevronUp,
  FolderTree,
  FolderPlus
} from 'lucide-react';

interface IngestionViewProps {
  activeCollection: string;
  collections?: string[];
  onIngestSuccess: () => void;
  onNewCollection: (name: string) => void;
  onClearCollection?: (name: string) => Promise<void> | void;
  onDeleteCollection?: (name: string) => Promise<void> | void;
  onViewInGraph?: (source: string) => void;
}

export interface CollectionDocItem {
  source: string;
  chunks: number;
  sampleText: string;
  mediaType?: string;
  timestamp?: number;
}

export type QueueItemStatus = 'pending' | 'processing' | 'success' | 'failed';

export interface IngestionQueueItem {
  id: string;
  name: string;
  fullPath?: string;
  file?: File;
  size: number;
  status: QueueItemStatus;
  chunks?: number;
  error?: string;
  category: 'document' | 'sheet' | 'image' | 'audio' | 'slide';
  extLabel: string;
  color: string;
  icon: string;
}

const ALLOWED_EXTENSIONS = [
  '.pdf', '.docx', '.doc', '.xlsx', '.xls', '.pptx', '.ppt', '.md', '.markdown', '.txt', '.json', '.csv',
  '.png', '.jpg', '.jpeg', '.webp', '.bmp',
  '.mp3', '.wav', '.m4a', '.ogg', '.flac'
];

function isSupportedFilename(filename: string): boolean {
  const name = filename.toLowerCase();
  if (name.startsWith('.') || name.startsWith('~$') || name.includes('node_modules')) {
    return false;
  }
  return ALLOWED_EXTENSIONS.some((ext) => name.endsWith(ext));
}

function getFileMeta(filename: string) {
  const ext = filename.split('.').pop()?.toUpperCase() || 'FILE';
  if (['PNG', 'JPG', 'JPEG', 'WEBP', 'BMP'].includes(ext)) {
    return { type: 'image' as const, label: ext, color: 'bg-purple-950 text-purple-300 border-purple-800/50', icon: '🖼️' };
  }
  if (['MP3', 'WAV', 'M4A', 'OGG', 'FLAC'].includes(ext)) {
    return { type: 'audio' as const, label: ext, color: 'bg-amber-950 text-amber-300 border-amber-800/50', icon: '🎙️' };
  }
  if (['XLSX', 'XLS', 'CSV'].includes(ext)) {
    return { type: 'sheet' as const, label: ext, color: 'bg-emerald-950 text-emerald-300 border-emerald-800/50', icon: '📊' };
  }
  if (['PPTX', 'PPT'].includes(ext)) {
    return { type: 'slide' as const, label: ext, color: 'bg-orange-950 text-orange-300 border-orange-800/50', icon: '📽️' };
  }
  return { type: 'document' as const, label: ext, color: 'bg-blue-950 text-blue-300 border-blue-800/50', icon: '📄' };
}

// Recursively traverse dropped folders via HTML5 Drag & Drop
async function getFilesFromDataTransfer(dataTransfer: DataTransfer): Promise<File[]> {
  const files: File[] = [];
  const items = dataTransfer.items;

  async function traverseEntry(entry: any, currentPath = ''): Promise<void> {
    if (!entry) return;
    if (entry.isFile) {
      await new Promise<void>((resolve) => {
        entry.file(
          (file: File) => {
            const relPath = currentPath ? `${currentPath}/${file.name}` : file.name;
            Object.defineProperty(file, 'webkitRelativePath', {
              value: relPath,
              writable: false
            });
            files.push(file);
            resolve();
          },
          () => resolve()
        );
      });
    } else if (entry.isDirectory) {
      const dirReader = entry.createReader();
      const readAllEntries = async () => {
        const batch: any[] = await new Promise((resolve) =>
          dirReader.readEntries(
            (entries: any[]) => resolve(entries),
            () => resolve([])
          )
        );
        if (batch && batch.length > 0) {
          for (const child of batch) {
            await traverseEntry(child, currentPath ? `${currentPath}/${entry.name}` : entry.name);
          }
          await readAllEntries();
        }
      };
      await readAllEntries();
    }
  }

  if (items && items.length > 0 && (items[0] as any).webkitGetAsEntry) {
    for (let i = 0; i < items.length; i++) {
      const entry = (items[i] as any).webkitGetAsEntry();
      if (entry) {
        await traverseEntry(entry);
      }
    }
  } else if (dataTransfer.files) {
    for (let i = 0; i < dataTransfer.files.length; i++) {
      files.push(dataTransfer.files[i]);
    }
  }

  return files;
}

export const IngestionView: React.FC<IngestionViewProps> = ({
  activeCollection,
  collections = [],
  onIngestSuccess,
  onNewCollection,
  onClearCollection,
  onDeleteCollection
}) => {
  // Unified Ingestion Queue: stores all files (from browser upload or disk paths)
  const [queueItems, setQueueItems] = useState<IngestionQueueItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [filterSearch, setFilterSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<'all' | 'document' | 'sheet' | 'image' | 'audio'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'success' | 'failed'>('all');

  // Local folder scanning via text path
  const [localFolderPath, setLocalFolderPath] = useState('');
  const [isScanningFolder, setIsScanningFolder] = useState(false);

  // In-App Folder Explorer Modal State
  const [showFolderModal, setShowFolderModal] = useState(false);
  const [modalCurrentPath, setModalCurrentPath] = useState('');
  const [modalParentPath, setModalParentPath] = useState<string | null>(null);
  const [modalProjectRoot, setModalProjectRoot] = useState<string>('');
  const [modalDrives, setModalDrives] = useState<string[]>([]);
  const [modalDirectories, setModalDirectories] = useState<string[]>([]);
  const [modalFiles, setModalFiles] = useState<Array<{
    name: string;
    relativePath?: string;
    subfolder?: string;
    fullPath: string;
    size: number;
    ext: string;
    supported: boolean;
  }>>([]);
  const [modalSelectedPaths, setModalSelectedPaths] = useState<Set<string>>(new Set());
  const [modalLoading, setModalLoading] = useState(false);
  const [modalRecursive, setModalRecursive] = useState<boolean>(true);
  const [modalSubfoldersCount, setModalSubfoldersCount] = useState<number>(0);

  // Collection management
  const [newColName, setNewColName] = useState('');

  // Process status
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number; currentFileName: string } | null>(null);
  const [logMessages, setLogMessages] = useState<Array<{ text: string; type: 'info' | 'success' | 'error' }>>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const addLog = (text: string, type: 'info' | 'success' | 'error' = 'info') => {
    setLogMessages((prev) => [{ text, type }, ...prev]);
  };

  // Add browser files (drag & drop or file dialog) to queue
  const addBrowserFilesToQueue = (incomingList: File[]) => {
    const supported = incomingList.filter((f) => isSupportedFilename(f.name));
    if (supported.length === 0) {
      addLog(`Nessun file supportato trovato tra i ${incomingList.length} file selezionati.`, 'error');
      return;
    }

    setQueueItems((prev) => {
      const existingKeys = new Set(prev.map((it) => it.id));
      const newItems: IngestionQueueItem[] = [];

      for (const f of supported) {
        const id = f.webkitRelativePath || `${f.name}-${f.size}`;
        if (!existingKeys.has(id)) {
          const meta = getFileMeta(f.name);
          newItems.push({
            id,
            name: f.webkitRelativePath || f.name,
            file: f,
            size: f.size,
            status: 'pending',
            category: meta.type,
            extLabel: meta.label,
            color: meta.color,
            icon: meta.icon
          });
          existingKeys.add(id);
        }
      }

      return [...prev, ...newItems];
    });

    addLog(`Aggiunti ${supported.length} documenti supportati alla Coda File.`, 'info');
  };

  // Drag and drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    try {
      const extracted = await getFilesFromDataTransfer(e.dataTransfer);
      addBrowserFilesToQueue(extracted);
    } catch (err: any) {
      addLog(`Errore durante il trascinamento: ${err.message}`, 'error');
    }
  };

  // Fetch Directory for In-App Explorer Modal (supports recursive scanning of subfolders)
  const fetchDirectory = async (dirPath?: string, recursiveOverride?: boolean) => {
    setModalLoading(true);
    try {
      const useRecursive = recursiveOverride !== undefined ? recursiveOverride : modalRecursive;
      let url = `/api/browse-fs?recursive=${useRecursive}`;
      if (dirPath) {
        url += `&path=${encodeURIComponent(dirPath)}`;
      }
      const res = await fetch(url);
      if (!res.ok) throw new Error('Impossibile accedere alla cartella');
      const data = await res.json();

      setModalCurrentPath(data.currentPath);
      setModalParentPath(data.parentPath);
      if (data.projectRoot) setModalProjectRoot(data.projectRoot);
      if (data.drives) setModalDrives(data.drives);
      setModalDirectories(data.directories || []);
      setModalFiles(data.files || []);
      setModalSubfoldersCount(data.subfoldersCount || 0);

      // Auto-select all supported files found across folder and subfolders
      const supported = (data.files || []).filter((f: any) => f.supported).map((f: any) => f.fullPath);
      setModalSelectedPaths(new Set(supported));
    } catch (err: any) {
      addLog(`Errore esplorazione cartella: ${err.message}`, 'error');
    } finally {
      setModalLoading(false);
    }
  };

  const handleOpenFolderExplorer = () => {
    setShowFolderModal(true);
    fetchDirectory();
  };

  // Add files selected in Modal to the main Queue
  const addModalFilesToQueue = (paths: string[]): IngestionQueueItem[] => {
    const selectedFileObjects = modalFiles.filter((f) => paths.includes(f.fullPath) && f.supported);
    const addedItems: IngestionQueueItem[] = [];

    setQueueItems((prev) => {
      const existingIds = new Set(prev.map((it) => it.id));
      const next = [...prev];

      for (const f of selectedFileObjects) {
        if (!existingIds.has(f.fullPath)) {
          const meta = getFileMeta(f.name);
          const displayName = f.relativePath || f.name;
          const newItem: IngestionQueueItem = {
            id: f.fullPath,
            name: displayName,
            fullPath: f.fullPath,
            size: f.size,
            status: 'pending',
            category: meta.type,
            extLabel: meta.label,
            color: meta.color,
            icon: meta.icon
          };
          next.push(newItem);
          addedItems.push(newItem);
          existingIds.add(f.fullPath);
        }
      }
      return next;
    });

    return addedItems;
  };

  // Quick Action: Add all files of a specific subfolder recursively from the left pane
  const handleAddSubfolderRecursively = async (subfolderName: string) => {
    const subfolderPath = navigateToChild(modalCurrentPath, subfolderName);
    addLog(`Scansione della sottocartella "${subfolderName}" in corso...`, 'info');
    try {
      const res = await fetch(`/api/browse-fs?path=${encodeURIComponent(subfolderPath)}&recursive=true`);
      if (!res.ok) throw new Error('Errore durante la lettura della sottocartella');
      const data = await res.json();
      const supportedFiles = (data.files || []).filter((f: any) => f.supported);
      if (supportedFiles.length === 0) {
        addLog(`Nessun file supportato trovato nella sottocartella "${subfolderName}".`, 'info');
        return;
      }

      setQueueItems((prev) => {
        const existingIds = new Set(prev.map((it) => it.id));
        const next = [...prev];
        for (const f of supportedFiles) {
          if (!existingIds.has(f.fullPath)) {
            const meta = getFileMeta(f.name);
            const displayName = f.relativePath ? `${subfolderName}/${f.relativePath}` : `${subfolderName}/${f.name}`;
            next.push({
              id: f.fullPath,
              name: displayName,
              fullPath: f.fullPath,
              size: f.size,
              status: 'pending',
              category: meta.type,
              extLabel: meta.label,
              color: meta.color,
              icon: meta.icon
            });
            existingIds.add(f.fullPath);
          }
        }
        return next;
      });

      addLog(`✓ Aggiunti ${supportedFiles.length} file dalla sottocartella "${subfolderName}" alla Coda File!`, 'success');
    } catch (err: any) {
      addLog(`Errore: ${err.message}`, 'error');
    }
  };

  // Modal Action 1: "Aggiungi alla Coda"
  const handleModalAddToQueue = () => {
    if (modalSelectedPaths.size === 0) {
      addLog('Seleziona almeno un file dalla cartella.', 'error');
      return;
    }
    const paths = Array.from(modalSelectedPaths);
    addModalFilesToQueue(paths);
    setShowFolderModal(false);
    addLog(`Aggiunti ${paths.length} file dalla cartella locale alla Coda File.`, 'info');
  };

  // Core Batch Ingestion Executor
  const executeIngestion = async (itemsToProcess: IngestionQueueItem[]) => {
    if (itemsToProcess.length === 0) {
      addLog('Nessun file da elaborare.', 'error');
      return;
    }

    setLoading(true);
    let successCount = 0;
    let totalChunksCount = 0;
    const total = itemsToProcess.length;

    addLog(`Avvio elaborazione di ${total} file nella collezione "${activeCollection}"...`, 'info');

    for (let i = 0; i < total; i++) {
      const item = itemsToProcess[i];
      setProgress({ current: i + 1, total, currentFileName: item.name });

      // Set item status to processing
      setQueueItems((prev) =>
        prev.map((it) => (it.id === item.id ? { ...it, status: 'processing', error: undefined } : it))
      );

      try {
        let chunks = 0;

        if (item.fullPath) {
          // Process file directly from disk path via /api/ingest-paths
          const res = await fetch('/api/ingest-paths', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              paths: [{ fullPath: item.fullPath, displayName: item.name }],
              collectionName: activeCollection
            })
          });

          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();
          const detail = data.details?.[0];

          if (detail && detail.status === 'success') {
            chunks = detail.chunks || 0;
            successCount++;
            totalChunksCount += chunks;
            setQueueItems((prev) =>
              prev.map((it) => (it.id === item.id ? { ...it, status: 'success', chunks } : it))
            );
            addLog(`✓ [${i + 1}/${total}] ${item.name} -> ${chunks} chunk vettorializzati`, 'success');
          } else {
            const errMsg = detail?.error || 'Errore durante l\'indicizzazione';
            setQueueItems((prev) =>
              prev.map((it) => (it.id === item.id ? { ...it, status: 'failed', error: errMsg } : it))
            );
            addLog(`⚠ [${i + 1}/${total}] ${item.name}: ${errMsg}`, 'error');
          }
        } else if (item.file) {
          // Process file from browser upload via /api/upload (preserve relative path if from dragged folder)
          const formData = new FormData();
          formData.append('files', item.file, item.name);
          formData.append('collection', activeCollection);

          let res = await fetch('/api/upload', {
            method: 'POST',
            body: formData
          });

          if (res.status === 502 || res.status === 503 || res.status === 504) {
            await new Promise((r) => setTimeout(r, 1200));
            res = await fetch('/api/upload', {
              method: 'POST',
              body: formData
            });
          }

          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.error || `Server HTTP ${res.status}`);
          }

          const data = await res.json();
          const first = data.details?.[0];
          if (first && first.status === 'success') {
            chunks = first.chunks || 0;
            successCount++;
            totalChunksCount += chunks;
            setQueueItems((prev) =>
              prev.map((it) => (it.id === item.id ? { ...it, status: 'success', chunks } : it))
            );
            addLog(`✓ [${i + 1}/${total}] ${item.name} -> ${chunks} chunk vettorializzati`, 'success');
          } else if (first && first.status === 'failed') {
            const errMsg = first.error || 'Errore elaborazione file';
            setQueueItems((prev) =>
              prev.map((it) => (it.id === item.id ? { ...it, status: 'failed', error: errMsg } : it))
            );
            addLog(`⚠ [${i + 1}/${total}] ${item.name}: ${errMsg}`, 'error');
          } else {
            successCount++;
            setQueueItems((prev) =>
              prev.map((it) => (it.id === item.id ? { ...it, status: 'success', chunks: 1 } : it))
            );
            addLog(`✓ [${i + 1}/${total}] ${item.name} indicizzato con successo`, 'success');
          }
        }
      } catch (err: any) {
        setQueueItems((prev) =>
          prev.map((it) => (it.id === item.id ? { ...it, status: 'failed', error: err.message } : it))
        );
        addLog(`❌ [${i + 1}/${total}] Errore su ${item.name}: ${err.message}`, 'error');
      }
    }

    setProgress(null);
    setLoading(false);
    addLog(`🎉 Indicizzazione completata! ${successCount} su ${total} file elaborati (${totalChunksCount} chunk totali).`, 'success');
    onIngestSuccess();

    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Modal Action 2: "Indicizza Subito"
  const handleModalIngestImmediately = async () => {
    if (modalSelectedPaths.size === 0) {
      addLog('Seleziona almeno un file dalla cartella.', 'error');
      return;
    }
    const paths = Array.from(modalSelectedPaths);
    setShowFolderModal(false);

    // Build items to process
    const selectedFileObjects = modalFiles.filter((f) => paths.includes(f.fullPath) && f.supported);
    const newItems: IngestionQueueItem[] = selectedFileObjects.map((f) => {
      const meta = getFileMeta(f.name);
      const displayName = f.relativePath || f.name;
      return {
        id: f.fullPath,
        name: displayName,
        fullPath: f.fullPath,
        size: f.size,
        status: 'pending',
        category: meta.type,
        extLabel: meta.label,
        color: meta.color,
        icon: meta.icon
      };
    });

    // Populate queue so the user sees all files immediately in the right card
    setQueueItems((prev) => {
      const existingIds = new Set(prev.map((it) => it.id));
      const filteredNew = newItems.filter((it) => !existingIds.has(it.id));
      return [...prev, ...filteredNew];
    });

    await executeIngestion(newItems);
  };

  // Start Ingestion for all Pending Items in Queue
  const handleStartQueueIngestion = () => {
    const pendingItems = queueItems.filter((it) => it.status === 'pending');
    if (pendingItems.length === 0) {
      addLog('Nessun file in attesa da indicizzare.', 'error');
      return;
    }
    executeIngestion(pendingItems);
  };

  // Retry failed items
  const handleRetryFailedItems = () => {
    const failedItems = queueItems.filter((it) => it.status === 'failed');
    if (failedItems.length === 0) return;
    executeIngestion(failedItems);
  };

  // Single Item Retry
  const handleRetrySingle = (item: IngestionQueueItem) => {
    executeIngestion([item]);
  };

  // Remove Single Item from Queue
  const handleRemoveItem = (id: string) => {
    setQueueItems((prev) => prev.filter((it) => it.id !== id));
  };

  // Clear Completed items from Queue
  const handleClearCompleted = () => {
    setQueueItems((prev) => prev.filter((it) => it.status !== 'success'));
  };

  // Local Server-Side Folder Scanner via Text Input
  const handleScanLocalFolder = async () => {
    if (!localFolderPath.trim()) {
      addLog('Inserisci un percorso cartella valido.', 'error');
      return;
    }
    setIsScanningFolder(true);
    addLog(`Scansione ricorsiva della cartella "${localFolderPath.trim()}" in corso sul server...`, 'info');

    try {
      const res = await fetch('/api/scan-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folderPath: localFolderPath.trim(),
          collectionName: activeCollection,
          recursive: true
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Errore durante la scansione della cartella');

      addLog(`✓ Scansione completata! ${data.processedFiles} file indicizzati (${data.totalChunks} chunk).`, 'success');
      onIngestSuccess();
      setLocalFolderPath('');
    } catch (err: any) {
      addLog(`Errore scansione cartella: ${err.message}`, 'error');
    } finally {
      setIsScanningFolder(false);
    }
  };

  const handleCreateCollection = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newColName.trim()) return;
    onNewCollection(newColName.trim());
    addLog(`Collezione "${newColName.trim()}" creata con successo.`, 'success');
    setNewColName('');
  };

  const handleClearCollection = async () => {
    if (!onClearCollection) return;
    if (!window.confirm(`Vuoi davvero SVUOTARE la collezione "${activeCollection}"?\nTutti i vettori e documenti indicizzati verranno rimossi.`)) return;

    setLoading(true);
    try {
      await onClearCollection(activeCollection);
      addLog(`Collezione "${activeCollection}" svuotata con successo.`, 'success');
      setQueueItems([]);
      onIngestSuccess();
    } catch (err: any) {
      addLog(`Errore: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteCollection = async () => {
    if (!onDeleteCollection) return;
    if (!window.confirm(`ATTENZIONE: Vuoi ELIMINARE definitivamente la collezione "${activeCollection}" da Qdrant?`)) return;

    setLoading(true);
    try {
      await onDeleteCollection(activeCollection);
      addLog(`Collezione "${activeCollection}" eliminata da Qdrant.`, 'success');
      setQueueItems([]);
      onIngestSuccess();
    } catch (err: any) {
      addLog(`Errore: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  // Queue item filtering
  const filteredQueue = queueItems.filter((item) => {
    const matchesSearch = !filterSearch.trim() || item.name.toLowerCase().includes(filterSearch.toLowerCase());
    if (!matchesSearch) return false;

    if (activeCategory !== 'all' && item.category !== activeCategory) return false;
    if (statusFilter !== 'all' && item.status !== statusFilter) return false;

    return true;
  });

  const pendingCount = queueItems.filter((it) => it.status === 'pending').length;
  const successCount = queueItems.filter((it) => it.status === 'success').length;
  const failedCount = queueItems.filter((it) => it.status === 'failed').length;
  const totalBytes = queueItems.reduce((acc, it) => acc + it.size, 0);

  // Toggle selection in folder modal
  const toggleModalSelectAll = () => {
    const supported = modalFiles.filter((f) => f.supported).map((f) => f.fullPath);
    if (modalSelectedPaths.size === supported.length) {
      setModalSelectedPaths(new Set());
    } else {
      setModalSelectedPaths(new Set(supported));
    }
  };

  const toggleModalFile = (path: string) => {
    setModalSelectedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  // Breadcrumbs calculation & path helpers
  const pathParts = modalCurrentPath ? modalCurrentPath.split(/[/\\]/).filter(Boolean) : [];

  const formatBreadcrumbPath = (parts: string[], targetIdx: number) => {
    if (parts.length === 0) return '';
    const first = parts[0];
    if (/^[a-zA-Z]:$/.test(first)) {
      if (targetIdx === 0) {
        return `${first}\\`;
      }
      return `${first}\\${parts.slice(1, targetIdx + 1).join('\\')}`;
    }
    return parts.slice(0, targetIdx + 1).join('/');
  };

  const navigateToChild = (parentPath: string, childName: string) => {
    if (parentPath.endsWith('\\') || parentPath.endsWith('/')) {
      return `${parentPath}${childName}`;
    }
    return `${parentPath}\\${childName}`;
  };

  return (
    <div className="max-w-6xl mx-auto py-6 px-4 space-y-6">
      {/* Top Header & Collection Controls */}
      <div className="bg-[#161b22] border border-[#30363d] rounded-2xl p-5 shadow-lg flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-blue-600/10 border border-blue-500/20 rounded-xl text-blue-400">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-gray-400 font-medium">Collezione Attiva:</span>
              <span className="px-2.5 py-0.5 rounded-lg text-xs font-mono font-bold bg-blue-950 text-blue-300 border border-blue-700/60 shadow-sm">
                {activeCollection}
              </span>
            </div>
            <p className="text-[11px] text-gray-500 mt-0.5">Vettori con Google EmbeddingGemma 2 (768d GPU) & IBM Docling + Pandas</p>
          </div>
        </div>

        {/* Collection Actions */}
        <div className="flex flex-wrap items-center gap-2.5">
          <form onSubmit={handleCreateCollection} className="flex items-center gap-1.5">
            <input
              type="text"
              placeholder="Nome nuova collezione..."
              value={newColName}
              onChange={(e) => setNewColName(e.target.value)}
              className="bg-[#0d1117] border border-[#30363d] focus:border-blue-500 rounded-lg px-3 py-1.5 text-xs text-gray-200 placeholder-gray-500 focus:outline-none w-44 transition"
            />
            <button
              type="submit"
              disabled={loading || !newColName.trim()}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white transition disabled:opacity-50 shadow"
            >
              <Plus className="w-3.5 h-3.5" />
              Crea
            </button>
          </form>

          <div className="h-5 w-[1px] bg-[#30363d] hidden sm:block mx-1" />

          <button
            onClick={handleClearCollection}
            disabled={loading}
            title="Svuota tutti i documenti e vettori di questa collezione"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-950/40 hover:bg-amber-900/60 text-amber-300 border border-amber-800/50 transition disabled:opacity-50"
          >
            <Eraser className="w-3.5 h-3.5" />
            Svuota
          </button>

          <button
            onClick={handleDeleteCollection}
            disabled={loading}
            title="Elimina definitivamente la collezione"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800/50 transition disabled:opacity-50"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Elimina
          </button>
        </div>
      </div>

      {/* Main Dropzone & Ingestion Studio */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Dropzone & File Selection (6 cols) */}
        <div className="lg:col-span-6 space-y-4">
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded-2xl p-7 text-center transition-all bg-[#161b22]/70 relative overflow-hidden ${
              isDragging
                ? 'border-blue-500 bg-blue-950/20 scale-[1.01]'
                : 'border-[#30363d] hover:border-blue-500/50'
            }`}
          >
            {/* Hidden native input for single/multi files */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.docx,.doc,.xlsx,.xls,.pptx,.ppt,.md,.markdown,.txt,.json,.csv,.png,.jpg,.jpeg,.webp,.mp3,.wav,.m4a,.ogg"
              onChange={(e) => {
                if (e.target.files) addBrowserFilesToQueue(Array.from(e.target.files));
              }}
              className="hidden"
            />

            <div className="max-w-md mx-auto space-y-3.5">
              <div className="p-3.5 bg-[#0d1117] border border-[#30363d] rounded-2xl w-14 h-14 mx-auto flex items-center justify-center text-blue-400 shadow-inner">
                <Upload className="w-7 h-7" />
              </div>

              <div>
                <h3 className="text-base font-semibold text-white">
                  Trascina File o Cartelle per la Coda
                </h3>
                <p className="text-xs text-gray-400 mt-1">
                  I documenti verranno aggiunti alla lista a destra per l'anteprima e l'elaborazione
                </p>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
                {/* 1. Sfoglia File */}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white flex items-center gap-2 shadow-md transition active:scale-95"
                >
                  <FileText className="w-4 h-4" />
                  <span>Sfoglia File Singoli/Multipli</span>
                </button>

                {/* 2. Sfoglia Cartella (In-App Modal) */}
                <button
                  type="button"
                  onClick={handleOpenFolderExplorer}
                  className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-purple-600 hover:bg-purple-500 text-white flex items-center gap-2 shadow-md transition active:scale-95"
                >
                  <FolderOpen className="w-4 h-4 text-white" />
                  <span>Esplora Cartella (In-App)</span>
                </button>
              </div>

              {/* Supported Modalities Pill Bar */}
              <div className="pt-2.5 border-t border-[#30363d]/60 flex flex-wrap items-center justify-center gap-1.5 text-[10px] text-gray-400">
                <span className="px-2 py-0.5 bg-[#0d1117] rounded-md border border-[#30363d]/50 flex items-center gap-1 text-blue-300">
                  <FileText className="w-3 h-3" /> PDF, DOCX, DOC
                </span>
                <span className="px-2 py-0.5 bg-[#0d1117] rounded-md border border-[#30363d]/50 flex items-center gap-1 text-emerald-300">
                  <FileSpreadsheet className="w-3 h-3" /> XLSX, XLS, CSV
                </span>
                <span className="px-2 py-0.5 bg-[#0d1117] rounded-md border border-[#30363d]/50 flex items-center gap-1 text-purple-300">
                  <ImageIcon className="w-3 h-3" /> PNG, JPG, WEBP
                </span>
                <span className="px-2 py-0.5 bg-[#0d1117] rounded-md border border-[#30363d]/50 flex items-center gap-1 text-amber-300">
                  <Mic className="w-3 h-3" /> MP3, WAV, M4A
                </span>
              </div>
            </div>
          </div>

          {/* Alternative: Direct Local Folder Path Scanner */}
          <div className="bg-[#161b22] border border-[#30363d] rounded-2xl p-4 shadow space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-300 flex items-center gap-1.5">
                <HardDrive className="w-4 h-4 text-blue-400" />
                Scansione Cartella da Percorso Disco
              </span>
              <span className="text-[11px] text-gray-500">
                Incolla il percorso locale (es. C:\Progetti\Modelli)
              </span>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="text"
                placeholder="Es: C:\Documenti\Progetti"
                value={localFolderPath}
                onChange={(e) => setLocalFolderPath(e.target.value)}
                className="flex-1 bg-[#0d1117] border border-[#30363d] rounded-xl px-3 py-2 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500 font-mono transition"
              />
              <button
                type="button"
                onClick={handleScanLocalFolder}
                disabled={isScanningFolder || !localFolderPath.trim()}
                className="px-4 py-2 rounded-xl text-xs font-medium bg-[#21262d] hover:bg-blue-600 hover:text-white text-gray-200 border border-[#30363d] transition disabled:opacity-50 flex items-center gap-1.5 shrink-0 shadow"
              >
                {isScanningFolder ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
                ) : (
                  <FolderSearch className="w-3.5 h-3.5 text-blue-400" />
                )}
                <span>{isScanningFolder ? 'Scansione...' : 'Scansiona Cartella'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Right Column: Dynamic File Queue & Status Tracker (6 cols) */}
        <div className="lg:col-span-6 space-y-4 flex flex-col justify-between">
          <div className="bg-[#161b22] border border-[#30363d] rounded-2xl p-4 shadow flex flex-col h-[510px]">
            {/* Queue Header */}
            <div className="flex items-center justify-between border-b border-[#30363d] pb-3 mb-2.5 shrink-0">
              <div className="flex items-center gap-2">
                <FileCheck className="w-4 h-4 text-emerald-400" />
                <h4 className="font-semibold text-white text-sm">
                  Coda File ({queueItems.length})
                </h4>
                {/* Status Badges */}
                {queueItems.length > 0 && (
                  <div className="flex items-center gap-1.5 text-[11px] font-mono">
                    {pendingCount > 0 && (
                      <span className="px-1.5 py-0.5 rounded bg-blue-950 text-blue-300 border border-blue-800/40">
                        {pendingCount} in attesa
                      </span>
                    )}
                    {successCount > 0 && (
                      <span className="px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800/40">
                        {successCount} indicizzati
                      </span>
                    )}
                    {failedCount > 0 && (
                      <span className="px-1.5 py-0.5 rounded bg-rose-950 text-rose-300 border border-rose-800/40">
                        {failedCount} errori
                      </span>
                    )}
                  </div>
                )}
              </div>

              {queueItems.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-400 font-mono">
                    {(totalBytes / (1024 * 1024)).toFixed(1)} MB
                  </span>
                  {successCount > 0 && (
                    <button
                      onClick={handleClearCompleted}
                      title="Rimuovi i file completati dalla visualizzazione"
                      className="text-[11px] text-gray-400 hover:text-white transition underline"
                    >
                      Pulisci completati
                    </button>
                  )}
                  <button
                    onClick={() => setQueueItems([])}
                    title="Svuota l'intera coda"
                    className="text-xs text-rose-400 hover:text-rose-300 transition"
                  >
                    Svuota coda
                  </button>
                </div>
              )}
            </div>

            {queueItems.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-6 space-y-2 text-gray-500">
                <Folder className="w-10 h-10 opacity-30 mb-1 text-gray-400" />
                <p className="text-xs font-semibold text-gray-300">Nessun file presente in coda</p>
                <p className="text-[11px] max-w-sm text-gray-500">
                  Usa <strong className="text-gray-300">Esplora Cartella</strong> o <strong className="text-gray-300">Sfoglia File</strong> per aggiungere i documenti: appariranno qui con dettagli e chunk estratti.
                </p>
              </div>
            ) : (
              <div className="flex-1 flex flex-col min-h-0 space-y-2.5">
                {/* Search & Status Filters */}
                <div className="space-y-1.5 shrink-0">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-gray-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      placeholder="Cerca tra i file in coda..."
                      value={filterSearch}
                      onChange={(e) => setFilterSearch(e.target.value)}
                      className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg pl-8 pr-3 py-1.5 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  {/* Status Pills */}
                  <div className="flex items-center justify-between text-[11px] pt-0.5">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setStatusFilter('all')}
                        className={`px-2 py-0.5 rounded transition font-medium ${
                          statusFilter === 'all' ? 'bg-blue-600 text-white' : 'bg-[#0d1117] text-gray-400 hover:text-white'
                        }`}
                      >
                        Tutti ({queueItems.length})
                      </button>
                      <button
                        onClick={() => setStatusFilter('pending')}
                        className={`px-2 py-0.5 rounded transition font-medium ${
                          statusFilter === 'pending' ? 'bg-blue-600 text-white' : 'bg-[#0d1117] text-gray-400 hover:text-white'
                        }`}
                      >
                        In attesa ({pendingCount})
                      </button>
                      <button
                        onClick={() => setStatusFilter('success')}
                        className={`px-2 py-0.5 rounded transition font-medium ${
                          statusFilter === 'success' ? 'bg-emerald-600 text-white' : 'bg-[#0d1117] text-gray-400 hover:text-white'
                        }`}
                      >
                        Indicizzati ({successCount})
                      </button>
                      {failedCount > 0 && (
                        <button
                          onClick={() => setStatusFilter('failed')}
                          className={`px-2 py-0.5 rounded transition font-medium ${
                            statusFilter === 'failed' ? 'bg-rose-600 text-white' : 'bg-[#0d1117] text-rose-400 hover:text-white'
                          }`}
                        >
                          Errori ({failedCount})
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Scrollable File List */}
                <div className="flex-1 overflow-y-auto space-y-1.5 pr-1 bg-[#0d1117] p-2 rounded-xl border border-[#30363d]">
                  {filteredQueue.map((item) => (
                    <div
                      key={item.id}
                      className="text-xs text-gray-300 flex items-center justify-between py-1.5 px-2.5 rounded-lg bg-[#161b22] hover:bg-[#21262d] border border-[#30363d]/50 transition group"
                    >
                      <div className="flex items-center gap-2 overflow-hidden pr-2">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold border shrink-0 ${item.color}`}>
                          {item.icon} {item.extLabel}
                        </span>
                        <div className="overflow-hidden">
                          <p className="truncate font-mono text-[11px] text-gray-200 group-hover:text-blue-300 transition" title={item.name}>
                            {item.name}
                          </p>
                          {item.error && (
                            <p className="text-[10px] text-rose-400 truncate font-mono">
                              {item.error}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2.5 shrink-0">
                        {/* Status Icon & Detail */}
                        {item.status === 'processing' && (
                          <span className="flex items-center gap-1 text-[11px] text-blue-400 font-mono">
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            Elaborazione...
                          </span>
                        )}

                        {item.status === 'success' && (
                          <span className="flex items-center gap-1 text-[11px] text-emerald-400 font-mono font-semibold">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            {item.chunks} chunk
                          </span>
                        )}

                        {item.status === 'failed' && (
                          <div className="flex items-center gap-1.5">
                            <span className="text-rose-400 text-[10px] font-mono flex items-center gap-1">
                              <AlertCircle className="w-3.5 h-3.5" /> Errore
                            </span>
                            <button
                              type="button"
                              onClick={() => handleRetrySingle(item)}
                              title="Riprova questo file"
                              className="p-1 rounded bg-rose-950 hover:bg-rose-900 text-rose-300 border border-rose-800 transition"
                            >
                              <RotateCcw className="w-3 h-3" />
                            </button>
                          </div>
                        )}

                        {item.status === 'pending' && (
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] text-gray-500 font-mono">
                              {(item.size / 1024).toFixed(0)} KB
                            </span>
                            <button
                              type="button"
                              onClick={() => handleRemoveItem(item.id)}
                              title="Rimuovi dalla coda"
                              className="text-gray-500 hover:text-rose-400 p-0.5 rounded transition"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Progress Bar during batch ingestion */}
                {progress && (
                  <div className="p-2.5 bg-[#0d1117] rounded-xl border border-blue-500/40 space-y-1.5 shrink-0">
                    <div className="flex items-center justify-between text-xs text-gray-300 font-medium">
                      <span className="flex items-center gap-1.5 text-blue-400">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Elaborazione GPU & Docling...
                      </span>
                      <span className="font-mono text-purple-400">
                        {progress.current} / {progress.total} ({Math.round((progress.current / progress.total) * 100)}%)
                      </span>
                    </div>

                    <div className="w-full bg-[#161b22] rounded-full h-2 overflow-hidden border border-[#30363d]">
                      <div
                        className="bg-gradient-to-r from-blue-500 to-purple-600 h-2 transition-all duration-300"
                        style={{ width: `${(progress.current / progress.total) * 100}%` }}
                      />
                    </div>

                    <p className="text-[10px] text-gray-400 truncate font-mono">
                      File: {progress.currentFileName}
                    </p>
                  </div>
                )}

                {/* Ingestion Action Buttons */}
                <div className="space-y-1.5 shrink-0">
                  {pendingCount > 0 ? (
                    <button
                      type="button"
                      onClick={handleStartQueueIngestion}
                      disabled={loading}
                      className="w-full py-2.5 rounded-xl text-xs font-semibold bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white transition shadow-lg disabled:opacity-50 flex items-center justify-center gap-2 active:scale-[0.99]"
                    >
                      {loading ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>Elaborazione con Gemma 2 & Docling...</span>
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-4 h-4" />
                          <span>Avvia Indicizzazione ({pendingCount} file in attesa)</span>
                        </>
                      )}
                    </button>
                  ) : failedCount > 0 ? (
                    <button
                      type="button"
                      onClick={handleRetryFailedItems}
                      disabled={loading}
                      className="w-full py-2.5 rounded-xl text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white transition shadow-lg disabled:opacity-50 flex items-center justify-center gap-2 active:scale-[0.99]"
                    >
                      <RotateCcw className="w-4 h-4" />
                      <span>Riprova i {failedCount} File con Errore</span>
                    </button>
                  ) : successCount > 0 ? (
                    <div className="w-full py-2 px-3 rounded-xl text-xs text-center font-medium bg-emerald-950/40 text-emerald-300 border border-emerald-800/50 flex items-center justify-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      <span>Tutti i {successCount} documenti sono stati indicizzati con successo</span>
                    </div>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Real-time Activity Terminal Log */}
      <div className="bg-[#161b22] border border-[#30363d] rounded-2xl p-4 shadow space-y-2.5">
        <div className="flex items-center justify-between border-b border-[#30363d] pb-2">
          <span className="text-xs font-semibold text-gray-300 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            Registro Attività & Log Ingestion
          </span>
          {logMessages.length > 0 && (
            <button
              onClick={() => setLogMessages([])}
              className="text-[11px] text-gray-400 hover:text-white transition"
            >
              Pulisci registro
            </button>
          )}
        </div>

        <div className="bg-[#0d1117] p-3 rounded-xl border border-[#30363d] max-h-44 overflow-y-auto font-mono text-xs space-y-1">
          {logMessages.length === 0 ? (
            <p className="text-gray-500 italic">Pronto. Seleziona file o cartelle per avviare l'ingestion.</p>
          ) : (
            logMessages.map((log, idx) => (
              <div
                key={idx}
                className={`flex items-start gap-2 ${
                  log.type === 'error'
                    ? 'text-rose-400'
                    : log.type === 'success'
                    ? 'text-emerald-400'
                    : 'text-gray-300'
                }`}
              >
                <span className="text-gray-600 shrink-0">›</span>
                <span className="break-all">{log.text}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* In-App Folder Explorer Modal (Matching Dark UI, Zero Browser Prompts) */}
      {showFolderModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-[#161b22] border border-[#30363d] rounded-2xl shadow-2xl w-full max-w-4xl h-[620px] flex flex-col overflow-hidden animate-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-[#30363d] flex items-center justify-between bg-[#161b22]">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-purple-600/20 border border-purple-500/30 rounded-xl text-purple-400">
                  <FolderOpen className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-white">
                    Esplora Cartelle del Sistema
                  </h3>
                  <p className="text-xs text-gray-400">
                    Naviga nelle cartelle, visualizza tutti i file ed estrai i documenti senza popup del browser
                  </p>
                </div>
              </div>

              <button
                onClick={() => setShowFolderModal(false)}
                className="p-1.5 text-gray-400 hover:text-white rounded-lg hover:bg-[#30363d] transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Breadcrumb Navigation Bar */}
            <div className="px-6 py-2.5 bg-[#0d1117] border-b border-[#30363d] flex items-center justify-between gap-3 text-xs overflow-hidden">
              <div className="flex items-center gap-1.5 overflow-x-auto py-1 font-mono text-gray-300 flex-1">
                {/* 1. Home Button -> Navigates to project root on server */}
                <button
                  type="button"
                  onClick={() => fetchDirectory(modalProjectRoot || undefined)}
                  title="Torna alla Cartella del Progetto"
                  className="p-1 text-blue-400 hover:text-blue-300 rounded hover:bg-[#21262d] transition shrink-0"
                >
                  <Home className="w-3.5 h-3.5" />
                </button>

                {/* 2. Up Arrow -> Navigates to parent directory */}
                {modalParentPath && (
                  <button
                    type="button"
                    onClick={() => fetchDirectory(modalParentPath)}
                    title="Cartella Superiore"
                    className="p-1 text-gray-400 hover:text-white rounded hover:bg-[#21262d] transition shrink-0"
                  >
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>
                )}

                {/* 3. Quick Windows Drives Selector (e.g. C:\, G:\, H:\) */}
                {modalDrives.length > 0 && (
                  <>
                    <div className="h-4 w-[1px] bg-[#30363d] mx-1 shrink-0" />
                    <div className="flex items-center gap-1 shrink-0">
                      {modalDrives.map((drive) => {
                        const isCurrentDrive = modalCurrentPath.toUpperCase().startsWith(drive.toUpperCase().replace('\\', ''));
                        return (
                          <button
                            key={drive}
                            type="button"
                            onClick={() => fetchDirectory(drive)}
                            className={`px-1.5 py-0.5 rounded text-[11px] font-mono font-bold border transition ${
                              isCurrentDrive
                                ? 'bg-blue-600/30 text-blue-300 border-blue-500/50'
                                : 'bg-[#161b22] text-gray-400 border-[#30363d] hover:text-white hover:bg-[#21262d]'
                            }`}
                            title={`Vai all'unità ${drive}`}
                          >
                            {drive}
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}

                <div className="h-4 w-[1px] bg-[#30363d] mx-1 shrink-0" />

                {/* 4. Interactive Breadcrumbs */}
                <div className="flex items-center gap-1 overflow-x-auto truncate">
                  {pathParts.map((part, idx) => {
                    const subPath = formatBreadcrumbPath(pathParts, idx);
                    const isLast = idx === pathParts.length - 1;
                    return (
                      <React.Fragment key={idx}>
                        <button
                          type="button"
                          onClick={() => fetchDirectory(subPath)}
                          className={`hover:text-blue-400 transition truncate ${
                            isLast ? 'text-white font-semibold' : 'text-gray-400'
                          }`}
                        >
                          {part}
                        </button>
                        {!isLast && <ChevronRight className="w-3 h-3 text-gray-600 shrink-0" />}
                      </React.Fragment>
                    );
                  })}
                </div>
              </div>

              {/* Select All Toggle & Recursive Scan Toggle */}
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    const next = !modalRecursive;
                    setModalRecursive(next);
                    fetchDirectory(modalCurrentPath, next);
                  }}
                  title="Se attivo, scansiona automaticamente tutte le sottocartelle della cartella padre"
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition ${
                    modalRecursive
                      ? 'bg-purple-950/70 text-purple-300 border-purple-600/60 shadow-sm'
                      : 'bg-[#21262d] text-gray-400 border-[#30363d] hover:text-white'
                  }`}
                >
                  <FolderTree className="w-3.5 h-3.5 text-purple-400" />
                  <span>Ricorsivo: <strong className={modalRecursive ? 'text-purple-300' : 'text-gray-400'}>{modalRecursive ? 'ON' : 'OFF'}</strong></span>
                </button>

                {modalFiles.filter((f) => f.supported).length > 0 && (
                  <button
                    type="button"
                    onClick={toggleModalSelectAll}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-[#21262d] hover:bg-[#30363d] text-gray-300 hover:text-white border border-[#30363d] transition"
                  >
                    {modalSelectedPaths.size === modalFiles.filter((f) => f.supported).length ? (
                      <>
                        <CheckSquare className="w-3.5 h-3.5 text-blue-400" />
                        <span>Deseleziona Tutti</span>
                      </>
                    ) : (
                      <>
                        <Square className="w-3.5 h-3.5 text-gray-400" />
                        <span>Seleziona Tutti ({modalFiles.filter((f) => f.supported).length})</span>
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>

            {/* Modal Body: Left Subfolders & Right Files */}
            <div className="flex-1 grid grid-cols-1 md:grid-cols-12 min-h-0 bg-[#0d1117]/50">
              {/* Subdirectories column (4 cols) */}
              <div className="md:col-span-4 border-r border-[#30363d] p-3 overflow-y-auto space-y-1 bg-[#161b22]/40">
                <div className="flex items-center justify-between px-2 py-1">
                  <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                    Sottocartelle ({modalDirectories.length})
                  </span>
                  {modalRecursive && modalDirectories.length > 0 && (
                    <span className="text-[10px] font-mono text-purple-300 bg-purple-950/80 px-1.5 py-0.5 rounded border border-purple-800/40">
                      Incluse
                    </span>
                  )}
                </div>

                {modalDirectories.length === 0 ? (
                  <p className="text-xs text-gray-500 italic p-2">Nessuna sottocartella</p>
                ) : (
                  modalDirectories.map((dir, i) => (
                    <div
                      key={i}
                      className="w-full flex items-center justify-between gap-1 px-2.5 py-1.5 rounded-lg text-xs text-gray-300 hover:text-white hover:bg-[#21262d] border border-transparent hover:border-[#30363d] transition group"
                    >
                      <button
                        type="button"
                        onClick={() => fetchDirectory(navigateToChild(modalCurrentPath, dir))}
                        className="flex items-center gap-2 flex-1 text-left truncate"
                        title={`Apri sottocartella "${dir}"`}
                      >
                        <Folder className="w-4 h-4 text-amber-400 group-hover:text-amber-300 shrink-0" />
                        <span className="truncate font-mono">{dir}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleAddSubfolderRecursively(dir)}
                        title={`Aggiungi ricorsivamente tutti i file di "${dir}" alla Coda`}
                        className="p-1 rounded text-gray-500 hover:text-emerald-300 hover:bg-emerald-950/60 border border-transparent hover:border-emerald-800/40 transition shrink-0 opacity-70 group-hover:opacity-100"
                      >
                        <FolderPlus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))
                )}
              </div>

              {/* Files in folder column (8 cols) */}
              <div className="md:col-span-8 p-3 overflow-y-auto space-y-1.5 flex flex-col">
                <div className="flex items-center justify-between px-2 py-1 shrink-0 flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                      File Trovati ({modalFiles.length})
                    </span>
                    {modalRecursive && modalSubfoldersCount > 0 && (
                      <span className="text-[10px] font-mono text-purple-300 bg-purple-950/80 px-2 py-0.5 rounded border border-purple-800/40 flex items-center gap-1">
                        <FolderTree className="w-3 h-3" />
                        {modalSubfoldersCount} sottocartelle incluse
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] text-gray-400 font-mono">
                    <strong className="text-white">{modalSelectedPaths.size}</strong> selezionati
                  </span>
                </div>

                {modalLoading ? (
                  <div className="flex-1 flex flex-col items-center justify-center p-8 space-y-2 text-gray-400">
                    <Loader2 className="w-6 h-6 animate-spin text-blue-400" />
                    <span className="text-xs">Lettura cartella e sottocartelle in corso...</span>
                  </div>
                ) : modalFiles.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-center p-8 text-gray-500 space-y-2">
                    <FileText className="w-8 h-8 opacity-40" />
                    <p className="text-xs">Nessun file supportato presente in questa cartella o nelle sue sottocartelle.</p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {modalFiles.map((file, i) => {
                      const meta = getFileMeta(file.name);
                      const isSelected = modalSelectedPaths.has(file.fullPath);

                      return (
                        <div
                          key={i}
                          onClick={() => {
                            if (file.supported) toggleModalFile(file.fullPath);
                          }}
                          className={`flex items-center justify-between p-2 rounded-xl border text-xs transition cursor-pointer ${
                            file.supported
                              ? isSelected
                                ? 'bg-blue-950/30 border-blue-600/60 text-white'
                                : 'bg-[#161b22] border-[#30363d]/60 text-gray-300 hover:bg-[#21262d]'
                              : 'bg-[#161b22]/30 border-transparent text-gray-500 cursor-not-allowed opacity-60'
                          }`}
                        >
                          <div className="flex items-center gap-2 overflow-hidden pr-2 flex-1">
                            {file.supported ? (
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleModalFile(file.fullPath)}
                                className="accent-blue-600 cursor-pointer rounded shrink-0"
                              />
                            ) : (
                              <span className="w-3.5 h-3.5 inline-block shrink-0" />
                            )}

                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold border shrink-0 ${meta.color}`}>
                              {meta.icon} {meta.label}
                            </span>

                            {file.subfolder && (
                              <span
                                className="px-1.5 py-0.5 rounded text-[10px] font-mono text-purple-300 bg-purple-950/70 border border-purple-800/40 shrink-0 truncate max-w-[150px]"
                                title={`Sottocartella: ${file.subfolder}`}
                              >
                                📁 {file.subfolder}
                              </span>
                            )}

                            <span className="truncate font-mono text-[11px]" title={file.relativePath || file.name}>
                              {file.name}
                            </span>
                          </div>

                          <span className="text-[10px] text-gray-500 font-mono shrink-0 pl-2">
                            {(file.size / 1024).toFixed(0)} KB
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer with Two Clear Actions */}
            <div className="px-6 py-3.5 border-t border-[#30363d] bg-[#161b22] flex flex-wrap items-center justify-between gap-4">
              <div className="text-xs text-gray-400 space-y-0.5">
                <div className="flex items-center gap-2">
                  <span>File selezionati: </span>
                  <strong className="text-white font-mono">{modalSelectedPaths.size}</strong>
                  <span>su {modalFiles.filter((f) => f.supported).length} supportati</span>
                </div>
                {modalRecursive && modalSubfoldersCount > 0 && (
                  <p className="text-[11px] text-purple-400 flex items-center gap-1 font-mono">
                    ✓ Include tutti i documenti delle {modalSubfoldersCount} sottocartelle
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setShowFolderModal(false)}
                  className="px-3.5 py-2 rounded-xl text-xs font-medium bg-[#21262d] hover:bg-[#30363d] text-gray-300 hover:text-white border border-[#30363d] transition shadow"
                >
                  Annulla
                </button>

                {/* Option 1: Add to Queue */}
                <button
                  type="button"
                  onClick={handleModalAddToQueue}
                  disabled={modalSelectedPaths.size === 0}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-[#21262d] hover:bg-[#30363d] text-blue-300 hover:text-white border border-blue-500/40 transition active:scale-95 disabled:opacity-50 flex items-center gap-1.5"
                >
                  <FileCheck className="w-3.5 h-3.5 text-blue-400" />
                  <span>Aggiungi alla Coda ({modalSelectedPaths.size})</span>
                </button>

                {/* Option 2: Ingest Immediately */}
                <button
                  type="button"
                  onClick={handleModalIngestImmediately}
                  disabled={modalSelectedPaths.size === 0}
                  className="px-5 py-2 rounded-xl text-xs font-semibold bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white shadow-lg transition active:scale-95 disabled:opacity-50 flex items-center gap-2"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Indicizza Subito ({modalSelectedPaths.size})</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
