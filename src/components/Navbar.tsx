import React from 'react';
import { Database, Cpu, Network, Search, UploadCloud, RefreshCw } from 'lucide-react';

interface NavbarProps {
  activeTab: 'ingest' | 'search' | 'graph';
  setActiveTab: (tab: 'ingest' | 'search' | 'graph') => void;
  collections: string[];
  activeCollection: string;
  setActiveCollection: (c: string) => void;
  status: {
    ollamaOk: boolean;
    qdrantOk: boolean;
    modelName: string;
  };
  onRefreshStatus: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  collections,
  activeCollection,
  setActiveCollection,
  status,
  onRefreshStatus
}) => {
  return (
    <header className="border-b border-[#30363d] bg-[#161b22] px-6 py-3.5 sticky top-0 z-50 shadow-md">
      <div className="flex flex-wrap items-center justify-between gap-4 max-w-7xl mx-auto">
        {/* Logo & Title */}
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-blue-600/20 border border-blue-500/30 rounded-xl text-blue-400">
            <Network className="w-6 h-6 animate-pulse" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-white flex items-center gap-2">
              RAG Obsidian Studio
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-blue-900/50 text-blue-300 border border-blue-700/50">
                Gemma 2 / Local
              </span>
            </h1>
            <p className="text-xs text-gray-400">Semantic Search & Knowledge Graph</p>
          </div>
        </div>

        {/* Navigation Tabs */}
        <nav className="flex items-center space-x-1 bg-[#0d1117] p-1 rounded-xl border border-[#30363d]">
          <button
            onClick={() => setActiveTab('ingest')}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-all ${
              activeTab === 'ingest'
                ? 'bg-blue-600 text-white shadow'
                : 'text-gray-400 hover:text-gray-200 hover:bg-[#161b22]'
            }`}
          >
            <UploadCloud className="w-4 h-4" />
            Ingestion Documenti
          </button>

          <button
            onClick={() => setActiveTab('search')}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-all ${
              activeTab === 'search'
                ? 'bg-blue-600 text-white shadow'
                : 'text-gray-400 hover:text-gray-200 hover:bg-[#161b22]'
            }`}
          >
            <Search className="w-4 h-4" />
            Ricerca Semantica
          </button>

          <button
            onClick={() => setActiveTab('graph')}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-all ${
              activeTab === 'graph'
                ? 'bg-purple-600 text-white shadow'
                : 'text-gray-400 hover:text-gray-200 hover:bg-[#161b22]'
            }`}
          >
            <Network className="w-4 h-4" />
            Grafo Obsidian
          </button>
        </nav>

        {/* Collection Selector & System Status */}
        <div className="flex items-center space-x-4">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">Collezione:</span>
            <select
              value={activeCollection}
              onChange={(e) => setActiveCollection(e.target.value)}
              className="bg-[#0d1117] text-xs text-gray-200 border border-[#30363d] rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-blue-500"
            >
              {collections.map((col) => (
                <option key={col} value={col}>
                  {col}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2 border-l border-[#30363d] pl-4">
            <div
              className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-mono border ${
                status.ollamaOk
                  ? 'bg-emerald-950/40 text-emerald-400 border-emerald-800/50'
                  : 'bg-rose-950/40 text-rose-400 border-rose-800/50'
              }`}
              title={`Embedding Model: ${status.modelName}`}
            >
              <Cpu className="w-3.5 h-3.5" />
              <span>Gemma 2: {status.ollamaOk ? 'GPU' : 'OFF'}</span>
            </div>

            <div
              className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-mono border ${
                status.qdrantOk
                  ? 'bg-emerald-950/40 text-emerald-400 border-emerald-800/50'
                  : 'bg-rose-950/40 text-rose-400 border-rose-800/50'
              }`}
              title="Qdrant Vector DB"
            >
              <Database className="w-3.5 h-3.5" />
              <span>Qdrant: {status.qdrantOk ? 'ON' : 'OFF'}</span>
            </div>

            <button
              onClick={onRefreshStatus}
              title="Aggiorna stato"
              className="p-1.5 text-gray-400 hover:text-white rounded-lg hover:bg-[#30363d] transition"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};

