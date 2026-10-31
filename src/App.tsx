import React, { useState, useEffect } from 'react';
import { Navbar } from './components/Navbar';
import { IngestionView } from './components/IngestionView';
import { SearchView } from './components/SearchView';
import { GraphView } from './components/GraphView';

export function App() {
  const [activeTab, setActiveTabState] = useState<'ingest' | 'search' | 'graph'>(() => {
    const tabParam = new URLSearchParams(window.location.search).get('tab');
    if (tabParam === 'ingest' || tabParam === 'search' || tabParam === 'graph') {
      return tabParam;
    }
    return (localStorage.getItem('rag_active_tab') as any) || 'ingest';
  });
  const [collections, setCollections] = useState<string[]>(['test-doc', 'rag_documents']);
  const [activeCollection, setActiveCollectionState] = useState<string>(() => {
    return localStorage.getItem('rag_active_collection') || 'test-doc';
  });
  const [targetGraphSource, setTargetGraphSource] = useState<string | null>(null);

  const setActiveTab = (tab: 'ingest' | 'search' | 'graph') => {
    setActiveTabState(tab);
    localStorage.setItem('rag_active_tab', tab);
  };

  const setActiveCollection = (col: string) => {
    setActiveCollectionState(col);
    localStorage.setItem('rag_active_collection', col);
  };

  const [status, setStatus] = useState({
    ollamaOk: false,
    qdrantOk: false,
    modelName: 'nomic-embed-text'
  });

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/status');
      if (res.ok) {
        const data = await res.json();
        setStatus({
          ollamaOk: data.ollama?.ok || false,
          qdrantOk: data.qdrant?.ok || false,
          modelName: data.ollama?.currentModel || 'nomic-embed-text'
        });
        if (data.qdrant?.collections && data.qdrant.collections.length > 0) {
          setCollections(data.qdrant.collections);
          if (!data.qdrant.collections.includes(activeCollection)) {
            setActiveCollection(data.qdrant.collections[0]);
          }
        }
      }
    } catch (err) {
      console.error('Status check failed', err);
    }
  };

  const fetchCollections = async () => {
    try {
      const res = await fetch('/api/collections');
      if (res.ok) {
        const data = await res.json();
        if (data.collections && data.collections.length > 0) {
          setCollections(data.collections);
        }
      }
    } catch (err) {
      console.error('Fetch collections failed', err);
    }
  };

  useEffect(() => {
    fetchStatus();
    fetchCollections();
  }, []);

  const handleNewCollection = async (name: string) => {
    try {
      const res = await fetch('/api/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      if (res.ok) {
        await fetchCollections();
        setActiveCollection(name);
      }
    } catch (err) {
      console.error('Error creating collection', err);
    }
  };

  const handleClearCollection = async (name: string) => {
    try {
      const res = await fetch(`/api/collections/${encodeURIComponent(name)}/clear`, {
        method: 'POST'
      });
      if (res.ok) {
        await fetchCollections();
      }
    } catch (err) {
      console.error('Error clearing collection', err);
    }
  };

  const handleDeleteCollection = async (name: string) => {
    try {
      const res = await fetch(`/api/collections/${encodeURIComponent(name)}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        const remaining = collections.filter(c => c !== name);
        setCollections(remaining);
        if (remaining.length > 0) {
          setActiveCollection(remaining[0]);
        }
        await fetchCollections();
      }
    } catch (err) {
      console.error('Error deleting collection', err);
    }
  };

  const handleSelectResultForGraph = (source: string) => {
    setTargetGraphSource(source);
    setActiveTab('graph');
  };

  return (
    <div className="min-h-screen bg-[#0d1117] text-gray-100 flex flex-col font-sans">
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        collections={collections}
        activeCollection={activeCollection}
        setActiveCollection={setActiveCollection}
        status={status}
        onRefreshStatus={fetchStatus}
      />

      <main className="flex-1">
        {activeTab === 'ingest' && (
          <IngestionView
            activeCollection={activeCollection}
            collections={collections}
            onIngestSuccess={() => {
              fetchCollections();
            }}
            onNewCollection={handleNewCollection}
            onClearCollection={handleClearCollection}
            onDeleteCollection={handleDeleteCollection}
            onViewInGraph={handleSelectResultForGraph}
          />
        )}

        {activeTab === 'search' && (
          <SearchView
            activeCollection={activeCollection}
            onSelectResultForGraph={handleSelectResultForGraph}
          />
        )}

        {activeTab === 'graph' && (
          <GraphView
            activeCollection={activeCollection}
            initialSelectedSource={targetGraphSource}
          />
        )}
      </main>
    </div>
  );
}

export default App;

