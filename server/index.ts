import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { fileURLToPath } from 'url';
import { ollama } from './services/ollama';
import { qdrant, DEFAULT_COLLECTION } from './services/qdrant';
import { ingestDocument, ingestFile, scanAndIngestDirectory, extractTextFromFile } from './services/ingestion';
import { generateObsidianGraph } from './services/graph';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Global process error guards to ensure server stays online under any file error
process.on('uncaughtException', (err) => {
  console.error('[SERVER ERROR CAUGHT] Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[SERVER ERROR CAUGHT] Unhandled Rejection:', reason);
});

app.use(cors());
app.use(express.json());

// Set up temporary storage for file uploads outside Vite workspace
const uploadDir = path.join(os.tmpdir(), 'rag_uploads');
fs.mkdir(uploadDir, { recursive: true }).catch(() => {});

const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 200 * 1024 * 1024, files: 1000 }
});

// 1. Status Check
app.get('/api/status', async (req, res) => {
  const [ollamaStatus, qdrantStatus] = await Promise.all([
    ollama.checkHealth(),
    qdrant.checkHealth()
  ]);

  res.json({
    ollama: ollamaStatus,
    qdrant: qdrantStatus,
    timestamp: new Date().toISOString()
  });
});

// 2. Collections List
app.get('/api/collections', async (req, res) => {
  try {
    const health = await qdrant.checkHealth();
    res.json({ collections: health.collections });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Create Collection
app.post('/api/collections', async (req, res) => {
  try {
    const { name, size = 768 } = req.body;
    if (!name) return res.status(400).json({ error: 'Collection name is required' });
    await qdrant.ensureCollection(name, size);
    res.json({ success: true, name });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Svuota collezione (rimuove tutti i vettori mantenendo la struttura)
app.post('/api/collections/:name/clear', async (req, res) => {
  try {
    const { name } = req.params;
    if (!name) return res.status(400).json({ error: 'Nome collezione obbligatorio' });
    const result = await qdrant.clearCollection(name);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Cancella completamente la collezione
app.delete('/api/collections/:name', async (req, res) => {
  try {
    const { name } = req.params;
    if (!name) return res.status(400).json({ error: 'Nome collezione obbligatorio' });
    const result = await qdrant.deleteCollection(name);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Elenco documenti presenti in una specifica collezione
app.get('/api/collections/:name/documents', async (req, res) => {
  try {
    const { name } = req.params;
    if (!name) return res.status(400).json({ error: 'Nome collezione obbligatorio' });
    const docs = await qdrant.getCollectionDocuments(name);
    const totalChunks = docs.reduce((acc, d) => acc + d.chunks, 0);
    res.json({
      collection: name,
      totalDocuments: docs.length,
      totalChunks,
      documents: docs
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Elimina singolo documento da una collezione
app.delete('/api/collections/:name/documents/:source', async (req, res) => {
  try {
    const { name, source } = req.params;
    if (!name || !source) return res.status(400).json({ error: 'Parametri mancanti' });
    const decodedSource = decodeURIComponent(source);
    await qdrant.deleteBySource(name, decodedSource);
    res.json({
      success: true,
      message: `Documento "${decodedSource}" rimosso con successo dalla collezione ${name}`
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 4. File Upload Ingestion
app.post('/api/upload', upload.array('files'), async (req, res) => {
  try {
    const files = req.files as Express.Multer.File[];
    const collectionName = (req.body.collection as string) || DEFAULT_COLLECTION;

    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'Nessun file fornito per il caricamento.' });
    }

    const results: any[] = [];
    for (const file of files) {
      try {
        const originalName = file.originalname || path.basename(file.path);
        const ingestRes = await ingestFile(file.path, originalName, collectionName);
        results.push({
          filename: originalName,
          chunks: ingestRes.chunks,
          mediaType: ingestRes.mediaType,
          status: 'success'
        });
      } catch (fileErr: any) {
        console.error(`[Ingestion Error] File: ${file.originalname}`, fileErr);
        results.push({
          filename: file.originalname,
          error: fileErr.message,
          status: 'failed'
        });
      } finally {
        // Clean up temp file
        await fs.unlink(file.path).catch(() => {});
      }
    }

    res.json({
      success: true,
      processed: results.length,
      details: results
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Local Filesystem Explorer API for In-App Folder Navigation
async function getAvailableDrives(): Promise<string[]> {
  if (process.platform !== 'win32') return ['/'];
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  const drives: string[] = [];
  await Promise.all(
    letters.map(async (l) => {
      try {
        const root = `${l}:\\`;
        const stat = await fs.stat(root);
        if (stat.isDirectory()) drives.push(root);
      } catch {}
    })
  );
  return drives.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}

interface ScannedFileInfo {
  name: string;
  relativePath: string;
  subfolder: string;
  fullPath: string;
  size: number;
  ext: string;
  supported: boolean;
}

const SUPPORTED_EXTS = new Set([
  '.pdf', '.docx', '.doc', '.xlsx', '.xls', '.pptx', '.ppt', '.md', '.markdown', '.txt', '.json', '.csv',
  '.png', '.jpg', '.jpeg', '.webp', '.bmp', '.mp3', '.wav', '.m4a'
]);

const IGNORED_DIRECTORY_NAMES = new Set([
  'node_modules',
  'System Volume Information',
  'Recovery',
  '$Recycle.Bin',
  '.git',
  '.gemini',
  '.vscode',
  '.idea',
  '__pycache__',
  'venv',
  '.env'
]);

function shouldIgnoreEntry(name: string): boolean {
  if (name.startsWith('.') || name.startsWith('~$') || name.startsWith('$')) return true;
  return IGNORED_DIRECTORY_NAMES.has(name);
}

app.get('/api/browse-fs', async (req, res) => {
  try {
    let rawPath = (req.query.path as string) || process.cwd();
    // Normalize Windows drive letter: "C:" or "c:" -> "C:\"
    if (/^[a-zA-Z]:$/.test(rawPath.trim())) {
      rawPath = `${rawPath.trim().toUpperCase()}\\`;
    }
    const targetPath = path.resolve(rawPath);

    const stat = await fs.stat(targetPath).catch(() => null);
    if (!stat || !stat.isDirectory()) {
      return res.status(404).json({ error: 'Cartella non trovata' });
    }

    const isRecursive = req.query.recursive !== 'false'; // default true: recursive scan of all subfolders
    const entries = await fs.readdir(targetPath, { withFileTypes: true });
    const directories: string[] = [];

    // Collect immediate subdirectories for navigation panel
    for (const entry of entries) {
      if (!shouldIgnoreEntry(entry.name) && entry.isDirectory()) {
        directories.push(entry.name);
      }
    }

    // Natural case-insensitive alphabetical sorting
    const naturalSort = (a: string, b: string) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    directories.sort(naturalSort);

    // Scan files: either recursively in all subdirectories or shallow in targetPath
    const files: ScannedFileInfo[] = [];
    let subfoldersWithFilesCount = 0;
    const visitedSubfolders = new Set<string>();

    async function walkDirectory(currentDir: string, depth = 0) {
      if (files.length >= 5000 || depth > 15) return;
      let dirEntries;
      try {
        dirEntries = await fs.readdir(currentDir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of dirEntries) {
        if (files.length >= 5000) break;
        if (shouldIgnoreEntry(entry.name)) continue;

        const fullFilePath = path.join(currentDir, entry.name);

        if (entry.isDirectory()) {
          if (isRecursive) {
            await walkDirectory(fullFilePath, depth + 1);
          }
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          try {
            const fileStat = await fs.stat(fullFilePath);
            const relPath = path.relative(targetPath, fullFilePath).replace(/\\/g, '/');
            const subfolder = path.dirname(relPath) === '.' ? '' : path.dirname(relPath);

            if (subfolder && !visitedSubfolders.has(subfolder)) {
              visitedSubfolders.add(subfolder);
              subfoldersWithFilesCount++;
            }

            files.push({
              name: entry.name,
              relativePath: relPath,
              subfolder,
              fullPath: fullFilePath,
              size: fileStat.size,
              ext: ext.replace('.', ''),
              supported: SUPPORTED_EXTS.has(ext)
            });
          } catch {}
        }
      }
    }

    await walkDirectory(targetPath, 0);

    // Sort files: grouped by subfolder, then by name
    files.sort((a, b) => {
      if (a.subfolder !== b.subfolder) {
        return naturalSort(a.subfolder, b.subfolder);
      }
      return naturalSort(a.name, b.name);
    });

    const drives = await getAvailableDrives();
    const isRoot = path.dirname(targetPath) === targetPath;

    res.json({
      currentPath: targetPath,
      projectRoot: process.cwd(),
      parentPath: !isRoot ? path.dirname(targetPath) : null,
      drives,
      directories,
      files,
      isRecursive,
      totalFiles: files.length,
      supportedFiles: files.filter((f) => f.supported).length,
      subfoldersCount: subfoldersWithFilesCount
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Ingest direct files from server paths (supports fullPath & optional displayName / relativePath)
app.post('/api/ingest-paths', async (req, res) => {
  try {
    const { paths, collectionName = DEFAULT_COLLECTION } = req.body;
    if (!paths || !Array.isArray(paths) || paths.length === 0) {
      return res.status(400).json({ error: 'Nessun percorso fornito' });
    }

    const results = [];
    for (const rawItem of paths) {
      const filePath = typeof rawItem === 'string' ? rawItem : rawItem.fullPath;
      const originalName = (typeof rawItem === 'object' && (rawItem.displayName || rawItem.name))
        ? (rawItem.displayName || rawItem.name)
        : path.basename(filePath);

      try {
        const ingestRes = await ingestFile(filePath, originalName, collectionName);
        results.push({
          filename: originalName,
          chunks: ingestRes.chunks,
          mediaType: ingestRes.mediaType,
          status: 'success'
        });
      } catch (err: any) {
        results.push({
          filename: originalName,
          error: err.message,
          status: 'failed'
        });
      }
    }

    res.json({ success: true, processed: results.length, details: results });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/scan-folder', async (req, res) => {
  try {
    const { folderPath, collectionName = DEFAULT_COLLECTION, recursive = true } = req.body;
    if (!folderPath) {
      return res.status(400).json({ error: 'Percorso cartella obbligatorio.' });
    }

    const exists = await fs.stat(folderPath).catch(() => null);
    if (!exists || !exists.isDirectory()) {
      return res.status(404).json({ error: `La cartella "${folderPath}" non esiste sul server.` });
    }

    const scanResult = await scanAndIngestDirectory(folderPath, collectionName, recursive);
    res.json({
      success: true,
      folder: folderPath,
      ...scanResult
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Semantic Search
app.post('/api/search', async (req, res) => {
  try {
    const { query, collectionName = DEFAULT_COLLECTION, limit = 8, threshold = 0.0 } = req.body;
    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: 'Query di ricerca non valida.' });
    }

    const queryEmbedding = await ollama.getEmbedding(query);
    const matches = await qdrant.search(collectionName, queryEmbedding, limit, threshold);

    const formatted = matches.map(m => {
      const payload = m.payload as any;
      return {
        id: m.id,
        score: Number(m.score.toFixed(4)),
        source: payload?.source || payload?.metadata?.source || 'Sconosciuto',
        text: payload?.text || payload?.page_content || '',
        chunkIndex: payload?.chunkIndex,
        totalChunks: payload?.totalChunks,
        metadata: payload?.metadata
      };
    });

    res.json({
      query,
      count: formatted.length,
      results: formatted
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 7. Obsidian-Style Connected Graph
app.get('/api/graph', async (req, res) => {
  try {
    const collectionName = (req.query.collection as string) || DEFAULT_COLLECTION;
    const threshold = parseFloat((req.query.threshold as string) || '0.70');
    const mode = (req.query.mode as string) === 'chunk' ? 'chunk' : 'document';
    const topK = parseInt((req.query.topK as string) || '3', 10);

    const graph = await generateObsidianGraph(collectionName, threshold, mode, topK);
    res.json(graph);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 8. Delete Document
app.delete('/api/documents', async (req, res) => {
  try {
    const { collectionName = DEFAULT_COLLECTION, source } = req.body;
    if (!source) return res.status(400).json({ error: 'Nome sorgente obbligatorio' });
    await qdrant.deleteBySource(collectionName, source);
    res.json({ success: true, deleted: source });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`[RAG Server] Running on http://localhost:${PORT}`);
});
