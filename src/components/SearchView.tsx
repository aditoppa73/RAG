import React, { useState, useEffect, useCallback } from 'react';
import {
  Search,
  Sliders,
  FileText,
  Copy,
  Check,
  Sparkles,
  Loader2,
  ArrowRight,
  Database,
  Layers,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  ExternalLink,
  Bot,
  Cpu,
  BookOpen
} from 'lucide-react';

interface SearchResult {
  id: string;
  score: number;
  source: string;
  text: string;
  chunkIndex?: number;
  totalChunks?: number;
  metadata?: Record<string, any>;
}

interface CollectionInfo {
  totalDocuments: number;
  totalChunks: number;
  documents: Array<{
    source: string;
    chunks: number;
    sampleText: string;
    mediaType?: string;
  }>;
}

interface SearchViewProps {
  activeCollection: string;
  onSelectResultForGraph?: (source: string) => void;
}

export const SearchView: React.FC<SearchViewProps> = ({
  activeCollection,
  onSelectResultForGraph
}) => {
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(6);
  const [threshold, setThreshold] = useState(0.0);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [searchMode, setSearchMode] = useState<'ai' | 'chunks' | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Generative RAG AI states
  const [isAiGenerating, setIsAiGenerating] = useState(false);
  const [aiAnswer, setAiAnswer] = useState<string | null>(null);
  const [modelUsed, setModelUsed] = useState<string | null>(null);
  const [availableModels, setAvailableModels] = useState<string[]>(['gemma2:2b', 'qwen2.5:latest']);
  const [selectedModel, setSelectedModel] = useState<string>('gemma2:2b');
  const [copiedAiAnswer, setCopiedAiAnswer] = useState(false);

  // Active Collection Metadata & Document List
  const [collectionInfo, setCollectionInfo] = useState<CollectionInfo | null>(null);
  const [isLoadingInfo, setIsLoadingInfo] = useState(false);
  const [showDocDrawer, setShowDocDrawer] = useState(false);
  const [docSearchQuery, setDocSearchQuery] = useState('');

  // Fetch available LLMs from Ollama
  const fetchAvailableModels = useCallback(async () => {
    try {
      const res = await fetch('/api/llm/models');
      if (res.ok) {
        const data = await res.json();
        if (data.models && data.models.length > 0) {
          // Filter out pure embed models for LLM generative dropdown
          const genModels = data.models.filter((m: string) => !m.includes('embed'));
          const finalList = genModels.length > 0 ? genModels : data.models;
          setAvailableModels(finalList);

          // Priority: gemma2:2b (fast & fits 6GB VRAM) -> qwen2.5 -> gemma2:9b -> first
          if (finalList.some((m: string) => m.startsWith('gemma2:2b'))) {
            setSelectedModel(finalList.find((m: string) => m.startsWith('gemma2:2b')));
          } else if (finalList.some((m: string) => m.startsWith('qwen2.5'))) {
            setSelectedModel(finalList.find((m: string) => m.startsWith('qwen2.5')));
          } else if (finalList.some((m: string) => m.startsWith('gemma2:9b'))) {
            setSelectedModel(finalList.find((m: string) => m.startsWith('gemma2:9b')));
          } else {
            setSelectedModel(finalList[0]);
          }
        }
      }
    } catch (err) {
      console.warn('Could not fetch LLM models from Ollama:', err);
    }
  }, []);

  const fetchCollectionInfo = useCallback(async (col = activeCollection) => {
    setIsLoadingInfo(true);
    try {
      const res = await fetch(`/api/collections/${encodeURIComponent(col)}/documents`);
      if (res.ok) {
        const data = await res.json();
        setCollectionInfo({
          totalDocuments: data.totalDocuments || 0,
          totalChunks: data.totalChunks || 0,
          documents: data.documents || []
        });
      } else {
        setCollectionInfo(null);
      }
    } catch (err) {
      console.error('Error fetching collection info:', err);
      setCollectionInfo(null);
    } finally {
      setIsLoadingInfo(false);
    }
  }, [activeCollection]);

  useEffect(() => {
    fetchCollectionInfo(activeCollection);
    fetchAvailableModels();
  }, [activeCollection, fetchCollectionInfo, fetchAvailableModels]);

  // 1. Fast Semantic Retrieval (Fragments only)
  const handleSearchOnly = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setSearched(true);
    setSearchMode('chunks');
    setAiAnswer(null);
    setModelUsed(null);

    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: query.trim(),
          collectionName: activeCollection,
          limit,
          threshold
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Errore durante la ricerca');
      setResults(data.results || []);
    } catch (err: any) {
      console.error(err);
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  // 2. Full RAG: Vector Retrieval + Generative Synthesis with LLM (Gemma 2)
  const handleAskAi = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!query.trim()) return;

    setIsAiGenerating(true);
    setSearched(true);
    setSearchMode('ai');
    setAiAnswer(null);

    try {
      const res = await fetch('/api/rag/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: query.trim(),
          collectionName: activeCollection,
          limit,
          threshold,
          model: selectedModel
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Errore durante la generazione RAG');
      setAiAnswer(data.answer);
      setModelUsed(data.modelUsed || selectedModel);
      setResults(data.sources || []);
    } catch (err: any) {
      console.error(err);
      setAiAnswer(`Si è verificato un errore durante l'elaborazione con il modello: ${err.message}`);
      setResults([]);
    } finally {
      setIsAiGenerating(false);
    }
  };

  const copyToClipboard = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const copyAiAnswer = () => {
    if (!aiAnswer) return;
    navigator.clipboard.writeText(aiAnswer);
    setCopiedAiAnswer(true);
    setTimeout(() => setCopiedAiAnswer(false), 2000);
  };

  const getScoreBadge = (score: number) => {
    const percent = Math.round(score * 100);
    if (score >= 0.75) {
      return (
        <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-950/60 text-emerald-400 border border-emerald-800/60">
          Similarità {percent}%
        </span>
      );
    }
    if (score >= 0.5) {
      return (
        <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-950/60 text-amber-400 border border-amber-800/60">
          Similarità {percent}%
        </span>
      );
    }
    return (
      <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-gray-800 text-gray-400 border border-gray-700">
        Similarità {percent}%
      </span>
    );
  };

  return (
    <div className="max-w-5xl mx-auto py-8 px-4 space-y-6">
      {/* Header */}
      <div className="text-center max-w-2xl mx-auto space-y-2">
        <h2 className="text-2xl font-bold text-white tracking-tight flex items-center justify-center gap-2">
          <Sparkles className="w-6 h-6 text-purple-400" />
          Ricerca Semantica & RAG Studio
        </h2>
        <p className="text-sm text-gray-400">
          Interroga la base di conoscenza tramite embedding <strong>EmbeddingGemma-2</strong> su Qdrant e
          fai sintetizzare la risposta direttamente a <strong>Gemma 2</strong> (Ollama).
        </p>
      </div>

      {/* Search Bar Form */}
      <div className="bg-[#161b22] border border-[#30363d] rounded-2xl p-5 shadow-xl">
        <form onSubmit={handleAskAi} className="space-y-4">
          <div className="relative flex items-center">
            <Search className="absolute left-4 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Fai una domanda sui tuoi documenti (es: 'Quali sono i termini contrattuali di rinnovo?')..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full bg-[#0d1117] border border-[#30363d] focus:border-purple-500 rounded-xl pl-12 pr-64 py-3.5 text-base text-gray-100 placeholder-gray-500 focus:outline-none transition"
            />
            
            {/* Action buttons inside search bar */}
            <div className="absolute right-2 flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleSearchOnly}
                disabled={loading || isAiGenerating || !query.trim()}
                title="Cerca solo i frammenti vettoriali senza passare da LLM"
                className="px-3.5 py-2 rounded-lg bg-[#21262d] hover:bg-[#30363d] text-gray-300 hover:text-white font-medium text-xs disabled:opacity-50 transition border border-[#30363d]"
              >
                {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Solo Frammenti'}
              </button>
              
              <button
                type="submit"
                disabled={loading || isAiGenerating || !query.trim()}
                title="Genera risposta con Gemma 2 / LLM basata sui documenti"
                className="px-4 py-2 rounded-lg bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white font-semibold text-xs disabled:opacity-50 transition shadow-lg flex items-center gap-1.5"
              >
                {isAiGenerating ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Analisi...</span>
                  </>
                ) : (
                  <>
                    <Bot className="w-3.5 h-3.5" />
                    <span>Rispondi con AI</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Filters, Model Selector and Controls */}
          <div className="flex flex-wrap items-center justify-between gap-4 pt-2 text-xs text-gray-400 border-t border-[#30363d]">
            <div className="flex items-center gap-4 flex-wrap">
              {/* LLM Model Dropdown */}
              <div className="flex items-center gap-1.5 bg-[#0d1117] px-2.5 py-1 rounded-lg border border-[#30363d]">
                <Cpu className="w-3.5 h-3.5 text-purple-400" />
                <span className="text-gray-300 font-medium">Modello LLM:</span>
                <select
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  className="bg-transparent text-purple-300 font-mono text-xs focus:outline-none cursor-pointer"
                >
                  {availableModels.map((m) => {
                    const label = m === 'gemma2:2b'
                      ? 'gemma2:2b (Consigliato GPU - Veloce)'
                      : m === 'gemma2:9b'
                      ? 'gemma2:9b (Richiede >8GB VRAM)'
                      : m.includes('qwen2.5')
                      ? `${m} (Leggero)`
                      : m;
                    return (
                      <option key={m} value={m} className="bg-[#161b22] text-gray-200">
                        {label}
                      </option>
                    );
                  })}
                </select>
              </div>

              {/* Max Results */}
              <div className="flex items-center gap-2">
                <Sliders className="w-3.5 h-3.5 text-gray-400" />
                <span>Max Fonti:</span>
                <input
                  type="range"
                  min="2"
                  max="15"
                  step="1"
                  value={limit}
                  onChange={(e) => setLimit(Number(e.target.value))}
                  className="w-20 accent-purple-500"
                />
                <span className="font-mono text-gray-200">{limit}</span>
              </div>

              {/* Threshold */}
              <div className="flex items-center gap-2 border-l border-[#30363d] pl-4">
                <span>Soglia Minima:</span>
                <input
                  type="range"
                  min="0"
                  max="0.95"
                  step="0.01"
                  value={threshold}
                  onChange={(e) => setThreshold(parseFloat(Number(e.target.value).toFixed(2)))}
                  className="w-24 accent-purple-500 cursor-pointer"
                />
                <span className="font-mono text-gray-200 min-w-[32px] text-right font-medium">
                  {Math.round(threshold * 100)}%
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 text-gray-400 font-mono text-[11px]">
              <Database className="w-3.5 h-3.5 text-blue-400" />
              <span>Collezione: <strong className="text-blue-300">{activeCollection}</strong></span>
              {collectionInfo && (
                <>
                  <span className="text-gray-600">•</span>
                  <span>{collectionInfo.totalDocuments} file</span>
                  <span className="text-gray-600">•</span>
                  <span>{collectionInfo.totalChunks} chunk</span>
                </>
              )}
            </div>
          </div>
        </form>
      </div>

      {/* Target Collection Info & Workspace Scope Card */}
      <div className="bg-[#161b22] border border-[#30363d] rounded-2xl p-4 shadow-lg space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-purple-600/15 border border-purple-500/30 rounded-xl text-purple-400">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-gray-400 font-medium">Ambito di Ricerca:</span>
                <span className="px-2.5 py-0.5 rounded-lg text-xs font-mono font-bold bg-blue-950 text-blue-300 border border-blue-700/60 shadow-sm">
                  {activeCollection}
                </span>
                {collectionInfo && (
                  <>
                    <span className="px-2 py-0.5 rounded-md text-xs font-mono font-semibold bg-emerald-950 text-emerald-300 border border-emerald-800/50">
                      {collectionInfo.totalDocuments} documenti indicizzati
                    </span>
                    <span className="px-2 py-0.5 rounded-md text-xs font-mono bg-purple-950 text-purple-300 border border-purple-800/50">
                      {collectionInfo.totalChunks} chunk vettoriali attivi
                    </span>
                  </>
                )}
              </div>
              <p className="text-[11px] text-gray-500 mt-0.5">
                Vettorializzazione con <strong>EmbeddingGemma-2</strong> (768d GPU) e analisi generativa via <strong>{selectedModel}</strong>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {collectionInfo && collectionInfo.totalDocuments > 0 && (
              <button
                type="button"
                onClick={() => setShowDocDrawer(!showDocDrawer)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
                  showDocDrawer
                    ? 'bg-blue-600 text-white border-blue-500 shadow'
                    : 'bg-[#0d1117] text-gray-300 hover:text-white border-[#30363d] hover:bg-[#21262d]'
                }`}
              >
                <Layers className="w-3.5 h-3.5 text-blue-400" />
                <span>{showDocDrawer ? 'Nascondi File' : 'Vedi File della Collezione'}</span>
                {showDocDrawer ? <ChevronUp className="w-3 h-3 ml-0.5" /> : <ChevronDown className="w-3 h-3 ml-0.5" />}
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                fetchCollectionInfo(activeCollection);
                fetchAvailableModels();
              }}
              disabled={isLoadingInfo}
              title="Ricarica info collezione e modelli"
              className="p-1.5 rounded-lg text-gray-400 hover:text-white bg-[#0d1117] hover:bg-[#21262d] border border-[#30363d] transition disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingInfo ? 'animate-spin text-blue-400' : ''}`} />
            </button>
          </div>
        </div>

        {/* Collapsible Documents List Drawer */}
        {showDocDrawer && collectionInfo && (
          <div className="pt-3 border-t border-[#30363d] space-y-2.5 animate-in fade-in duration-150">
            <div className="flex items-center justify-between gap-3 text-xs flex-wrap">
              <span className="text-gray-400 font-medium">
                Documenti attualmente presenti in "{activeCollection}":
              </span>
              <div className="relative w-52">
                <Search className="w-3 h-3 text-gray-500 absolute left-2 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Filtra file..."
                  value={docSearchQuery}
                  onChange={(e) => setDocSearchQuery(e.target.value)}
                  className="w-full bg-[#0d1117] border border-[#30363d] rounded-md pl-6 pr-2 py-1 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <div className="max-h-48 overflow-y-auto space-y-1.5 bg-[#0d1117] p-2 rounded-xl border border-[#30363d]">
              {collectionInfo.documents
                .filter((d) => !docSearchQuery.trim() || d.source.toLowerCase().includes(docSearchQuery.toLowerCase()))
                .map((d, i) => {
                  const ext = d.source.split('.').pop()?.toUpperCase() || 'DOC';
                  const isSheet = ['XLSX', 'XLS', 'CSV'].includes(ext);
                  const isImg = ['PNG', 'JPG', 'JPEG', 'WEBP'].includes(ext);
                  const isAudio = ['MP3', 'WAV', 'M4A'].includes(ext);

                  return (
                    <div
                      key={i}
                      className="flex items-center justify-between text-xs py-1.5 px-2.5 rounded-lg bg-[#161b22] border border-[#30363d]/50 hover:bg-[#21262d] transition"
                    >
                      <div className="flex items-center gap-2 overflow-hidden pr-2">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold border shrink-0 ${
                          isSheet
                            ? 'bg-emerald-950 text-emerald-300 border-emerald-800/40'
                            : isImg
                            ? 'bg-purple-950 text-purple-300 border-purple-800/40'
                            : isAudio
                            ? 'bg-amber-950 text-amber-300 border-amber-800/40'
                            : 'bg-blue-950 text-blue-300 border-blue-800/40'
                        }`}>
                          {isSheet ? '📊' : isImg ? '🖼️' : isAudio ? '🎙️' : '📄'} {ext}
                        </span>
                        <span className="truncate font-mono text-[11px] text-gray-200" title={d.source}>
                          {d.source}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[10px] font-mono text-purple-300 bg-purple-950/60 px-2 py-0.5 rounded border border-purple-800/40">
                          {d.chunks} chunk
                        </span>
                        {onSelectResultForGraph && (
                          <button
                            type="button"
                            onClick={() => onSelectResultForGraph(d.source)}
                            title="Visualizza questo documento nel Grafo"
                            className="p-1 rounded text-purple-400 hover:text-white hover:bg-purple-900/40 transition"
                          >
                            <ExternalLink className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        {collectionInfo && collectionInfo.totalDocuments === 0 && (
          <div className="p-3 bg-amber-950/30 border border-amber-800/50 rounded-xl text-xs text-amber-300 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>
              Attenzione: la collezione "<strong>{activeCollection}</strong>" è attualmente vuota (0 documenti indicizzati).
              Vai nella scheda <strong>Ingestion Documenti</strong> per caricare file prima di eseguire ricerche.
            </span>
          </div>
        )}
      </div>

      {/* AI Generative RAG Answer Card */}
      {isAiGenerating && (
        <div className="bg-gradient-to-r from-purple-950/40 to-blue-950/30 border border-purple-500/40 rounded-2xl p-6 shadow-xl space-y-3 animate-pulse">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-600/30 border border-purple-500/50 rounded-xl text-purple-300">
              <Bot className="w-5 h-5 animate-spin" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <span>Analisi RAG in corso con {selectedModel}...</span>
              </h3>
              <p className="text-xs text-gray-400">
                Estrazione vettoriale dei chunk da Qdrant e sintesi della risposta senza allucinazioni.
              </p>
            </div>
          </div>
        </div>
      )}

      {aiAnswer && (
        <div className="bg-[#121024] border border-purple-500/50 rounded-2xl p-6 shadow-2xl space-y-4 animate-in fade-in duration-200">
          <div className="flex items-center justify-between gap-4 border-b border-purple-900/40 pb-3 flex-wrap">
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-purple-600/20 border border-purple-500/40 rounded-xl text-purple-300">
                <Bot className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <span>Risposta dell'Assistente RAG</span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-purple-950 text-purple-300 border border-purple-700/60">
                    {modelUsed || selectedModel}
                  </span>
                </h3>
                <span className="text-[11px] text-gray-400 flex items-center gap-1 mt-0.5">
                  <BookOpen className="w-3 h-3 text-purple-400" />
                  Sintesi generata sulla base di <strong>{results.length} frammenti</strong> estratti da Qdrant
                </span>
              </div>
            </div>

            <button
              onClick={copyAiAnswer}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#1c1938] hover:bg-[#28244f] text-purple-200 border border-purple-800/40 transition"
            >
              {copiedAiAnswer ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-300">Copiato!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copia Risposta</span>
                </>
              )}
            </button>
          </div>

          {/* AI Response Text */}
          <div className="text-sm text-gray-200 leading-relaxed whitespace-pre-wrap font-sans bg-[#0d0c18] p-4 rounded-xl border border-purple-900/30">
            {aiAnswer}
          </div>

          {/* Consulted Source Files Summary */}
          {results.length > 0 && (
            <div className="pt-3 border-t border-purple-900/40 flex flex-wrap items-center gap-2">
              <span className="text-xs text-purple-300 font-semibold flex items-center gap-1.5 mr-1">
                <FileText className="w-3.5 h-3.5 text-purple-400" />
                Documenti consultati:
              </span>
              {Array.from(new Set(results.map((r) => r.source))).map((src, idx) => (
                <span
                  key={idx}
                  title={src}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-mono bg-[#0d0c18] text-purple-200 border border-purple-700/50 hover:border-purple-400 transition"
                >
                  <span className="text-purple-400 font-sans font-bold">📄</span>
                  <span className="truncate max-w-xs">{src}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Results Section (Document Chunks) - Mostrato solo in modalità "Solo Frammenti" */}
      {searchMode === 'chunks' && (
        <div className="space-y-4">
          {searched && (
            <div className="flex items-center justify-between px-2 text-xs text-gray-400">
              <span>
                Trovati {results.length} frammenti pertinenti per "{query}":
              </span>
              <span className="text-gray-500 font-mono">
                {results.length} frammenti
              </span>
            </div>
          )}

          {loading ? (
            <div className="py-16 text-center space-y-3">
              <Loader2 className="w-8 h-8 animate-spin text-blue-500 mx-auto" />
              <p className="text-sm text-gray-400">Generazione embedding ed estrazione da Qdrant in corso...</p>
            </div>
          ) : results.length > 0 ? (
            <div className="space-y-3">
              {results.map((res) => (
                <div
                  key={res.id}
                  className="bg-[#161b22] border border-[#30363d] hover:border-purple-500/50 transition-all rounded-xl p-5 shadow-sm space-y-3 group"
                >
                  {/* Header card */}
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2">
                      {/\.(png|jpe?g|webp|bmp)$/i.test(res.source) ? (
                        <span className="text-base">🖼️</span>
                      ) : /\.(mp3|wav|m4a|ogg)$/i.test(res.source) ? (
                        <span className="text-base">🎙️</span>
                      ) : (
                        <FileText className="w-4 h-4 text-purple-400" />
                      )}
                      <span className="font-semibold text-sm text-white group-hover:text-purple-300 transition">
                        {res.source}
                      </span>
                      {res.chunkIndex !== undefined && !/\.(png|jpe?g|webp|bmp|mp3|wav|m4a)$/i.test(res.source) && (
                        <span className="text-xs text-gray-500">
                          (chunk {res.chunkIndex + 1} di {res.totalChunks || '?'})
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {getScoreBadge(res.score)}
                      <button
                        onClick={() => copyToClipboard(res.id, res.text)}
                        title="Copia testo"
                        className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-[#30363d] transition"
                      >
                        {copiedId === res.id ? (
                          <Check className="w-4 h-4 text-emerald-400" />
                        ) : (
                          <Copy className="w-4 h-4" />
                        )}
                      </button>
                      {onSelectResultForGraph && (
                        <button
                          onClick={() => onSelectResultForGraph(res.source)}
                          title="Isola nel Grafo"
                          className="p-1.5 rounded-lg text-gray-400 hover:text-purple-300 hover:bg-[#30363d] transition"
                        >
                          <ArrowRight className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Content */}
                  <div className="bg-[#0d1117] p-3.5 rounded-lg border border-[#30363d]/60 text-sm text-gray-300 whitespace-pre-wrap leading-relaxed font-sans">
                    {res.text}
                  </div>

                  {/* Metadata Pill Bar if available */}
                  {res.metadata && Object.keys(res.metadata).length > 0 && (
                    <div className="flex flex-wrap gap-2 pt-1 text-[11px] text-gray-400">
                      {res.metadata.author && (
                        <span className="bg-[#0d1117] px-2 py-0.5 rounded border border-[#30363d]">
                          Autore: {res.metadata.author}
                        </span>
                      )}
                      {res.metadata.page !== undefined && (
                        <span className="bg-[#0d1117] px-2 py-0.5 rounded border border-[#30363d]">
                          Pagina: {res.metadata.page}
                        </span>
                      )}
                      {res.metadata.title && (
                        <span className="bg-[#0d1117] px-2 py-0.5 rounded border border-[#30363d]">
                          Titolo: {res.metadata.title}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="py-12 text-center bg-[#161b22] border border-[#30363d] rounded-2xl p-8 space-y-2">
              <p className="text-gray-300 font-medium">Nessun risultato rilevante trovato</p>
              <p className="text-xs text-gray-500">
                Prova ad abbassare la soglia di similarità o a verificare che la collezione contenga documenti indicizzati.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
