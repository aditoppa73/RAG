import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { forceCollide } from 'd3-force-3d';
import {
  Sliders,
  Maximize2,
  RefreshCw,
  FileText,
  Info,
  X,
  ExternalLink,
  ZoomIn,
  ZoomOut,
  Target,
  Settings2,
  Search,
  Sparkles
} from 'lucide-react';

interface Node {
  id: string;
  name: string;
  source: string;
  group: string;
  val: number;
  chunkCount?: number;
  previewText?: string;
  x?: number;
  y?: number;
}

interface Link {
  source: string | Node;
  target: string | Node;
  similarity: number;
  type: 'semantic' | 'document_sequence';
}

interface GraphData {
  nodes: Node[];
  links: Link[];
  stats: {
    totalNodes: number;
    totalLinks: number;
    avgSimilarity: number;
    thresholdUsed: number;
    topKUsed?: number;
  };
}

interface GraphViewProps {
  activeCollection: string;
  initialSelectedSource?: string | null;
}

// Consistent colors by file extension/group
function getGroupColor(ext: string): string {
  const clean = ext.toLowerCase().replace('.', '');
  switch (clean) {
    case 'pdf':
      return '#f87171'; // red / coral
    case 'doc':
    case 'docx':
      return '#60a5fa'; // blue
    case 'txt':
    case 'md':
      return '#34d399'; // emerald green
    case 'csv':
    case 'tsv':
    case 'json':
      return '#38bdf8'; // sky blue
    case 'xlsx':
    case 'xls':
      return '#10b981'; // emerald green
    case 'pptx':
    case 'ppt':
      return '#f97316'; // vibrant orange
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'webp':
      return '#c084fc'; // purple image
    case 'mp3':
    case 'wav':
    case 'm4a':
    case 'ogg':
      return '#f59e0b'; // amber audio
    default:
      return '#a78bfa'; // purple
  }
}

export const GraphView: React.FC<GraphViewProps> = ({
  activeCollection,
  initialSelectedSource
}) => {
  const [data, setData] = useState<GraphData>({
    nodes: [],
    links: [],
    stats: { totalNodes: 0, totalLinks: 0, avgSimilarity: 0, thresholdUsed: 0.7 }
  });

  // Graph algorithm params
  const [threshold, setThreshold] = useState(0.68);
  const [topK, setTopK] = useState(3);
  const [mode, setMode] = useState<'document' | 'chunk'>('document');

  // Physics simulation tuning
  const [chargeStrength, setChargeStrength] = useState(-320);
  const [linkDistance, setLinkDistance] = useState(100);
  const [collisionPadding, setCollisionPadding] = useState(14);

  // Display & UI state
  const [labelMode, setLabelMode] = useState<'hover' | 'always' | 'hidden'>('hover');
  const [showSettings, setShowSettings] = useState(false);
  const [filterText, setFilterText] = useState('');
  const [loading, setLoading] = useState(false);

  // Interaction
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [hoverNode, setHoverNode] = useState<Node | null>(null);

  const fgRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  // Update container dimensions on window resize
  useEffect(() => {
    function updateSize() {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight
        });
      }
    }
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  // Fetch graph data from backend
  const fetchGraphData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/graph?collection=${encodeURIComponent(activeCollection)}&threshold=${threshold}&mode=${mode}&topK=${topK}`
      );
      const graphData: GraphData = await res.json();
      setData(graphData);

      if (initialSelectedSource) {
        const found = graphData.nodes.find((n) => n.source === initialSelectedSource);
        if (found) setSelectedNode(found);
      }
    } catch (err) {
      console.error('Failed to load graph:', err);
    } finally {
      setLoading(false);
    }
  }, [activeCollection, threshold, mode, topK, initialSelectedSource]);

  useEffect(() => {
    fetchGraphData();
  }, [fetchGraphData]);

  // Apply D3 physics configuration
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;

    try {
      // Repulsion force between all nodes
      const charge = fg.d3Force('charge');
      if (charge) charge.strength(chargeStrength);

      // Distance between connected links
      const link = fg.d3Force('link');
      if (link) link.distance(linkDistance);

      // Collision avoidance force so nodes never pile on top of each other
      fg.d3Force(
        'collide',
        forceCollide((node: any) => (node.val || 7) + collisionPadding)
      );

      // Re-warm simulation smoothly
      fg.d3ReheatSimulation();
    } catch (e) {
      console.warn('D3 force setup error:', e);
    }
  }, [chargeStrength, linkDistance, collisionPadding, data]);

  // Active highlighted focal node (either hovered or selected)
  const focalNode = hoverNode || selectedNode;

  // Compute set of highlighted nodes and links for Obsidian isolation effect
  const { highlightNodes, highlightLinks } = useMemo(() => {
    const hNodes = new Set<string>();
    const hLinks = new Set<any>();

    if (focalNode) {
      hNodes.add(focalNode.id);
      data.links.forEach((link) => {
        const sId = typeof link.source === 'object' ? (link.source as Node).id : link.source;
        const tId = typeof link.target === 'object' ? (link.target as Node).id : link.target;

        if (sId === focalNode.id) {
          hNodes.add(String(tId));
          hLinks.add(link);
        } else if (tId === focalNode.id) {
          hNodes.add(String(sId));
          hLinks.add(link);
        }
      });
    }

    return { highlightNodes: hNodes, highlightLinks: hLinks };
  }, [focalNode, data]);

  // Neighbors of selected node for the inspector drawer
  const selectedNeighbors = useMemo(() => {
    if (!selectedNode) return [];
    const neighbors: Array<{ node: Node; similarity: number }> = [];

    data.links.forEach((link) => {
      const sId = typeof link.source === 'object' ? (link.source as Node).id : link.source;
      const tId = typeof link.target === 'object' ? (link.target as Node).id : link.target;

      if (sId === selectedNode.id) {
        const targetNode = data.nodes.find((n) => n.id === tId);
        if (targetNode) neighbors.push({ node: targetNode, similarity: link.similarity });
      } else if (tId === selectedNode.id) {
        const sourceNode = data.nodes.find((n) => n.id === sId);
        if (sourceNode) neighbors.push({ node: sourceNode, similarity: link.similarity });
      }
    });

    return neighbors.sort((a, b) => b.similarity - a.similarity);
  }, [selectedNode, data]);

  // Search filter matching
  const matchingNodeIds = useMemo(() => {
    if (!filterText.trim()) return null;
    const term = filterText.toLowerCase();
    const ids = new Set<string>();
    data.nodes.forEach((n) => {
      if (
        n.name.toLowerCase().includes(term) ||
        (n.previewText && n.previewText.toLowerCase().includes(term))
      ) {
        ids.add(n.id);
      }
    });
    return ids;
  }, [data.nodes, filterText]);

  // Camera navigation helpers
  const handleZoomIn = () => {
    if (fgRef.current) {
      fgRef.current.zoom(fgRef.current.zoom() * 1.35, 300);
    }
  };

  const handleZoomOut = () => {
    if (fgRef.current) {
      fgRef.current.zoom(fgRef.current.zoom() / 1.35, 300);
    }
  };

  const handleFitView = () => {
    if (fgRef.current) {
      fgRef.current.zoomToFit(400, 60);
    }
  };

  const handleCenterNode = (node: Node) => {
    if (fgRef.current && node.x !== undefined && node.y !== undefined) {
      fgRef.current.centerAt(node.x, node.y, 400);
      fgRef.current.zoom(2.4, 400);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-65px)] bg-[#0d1117] relative select-none overflow-hidden">
      {/* Top Main Toolbar */}
      <div className="bg-[#161b22]/90 backdrop-blur-md border-b border-[#30363d] px-6 py-2.5 flex flex-wrap items-center justify-between gap-4 z-10 shadow-md">
        {/* Left: View Mode & Search */}
        <div className="flex items-center gap-3">
          <div className="flex bg-[#0d1117] p-1 rounded-xl border border-[#30363d]">
            <button
              onClick={() => setMode('document')}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition ${
                mode === 'document' ? 'bg-purple-600 text-white shadow' : 'text-gray-400 hover:text-white'
              }`}
            >
              Documenti
            </button>
            <button
              onClick={() => setMode('chunk')}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition ${
                mode === 'chunk' ? 'bg-purple-600 text-white shadow' : 'text-gray-400 hover:text-white'
              }`}
            >
              Chunk Vettoriali
            </button>
          </div>

          <div className="relative">
            <Search className="w-3.5 h-3.5 text-gray-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Cerca nodi nel grafo..."
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              className="bg-[#0d1117] border border-[#30363d] rounded-lg pl-8 pr-3 py-1.5 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-purple-500 w-52 transition"
            />
            {filterText && (
              <button
                onClick={() => setFilterText('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white text-xs"
              >
                ×
              </button>
            )}
          </div>
        </div>

        {/* Center: Graph Stats */}
        <div className="hidden md:flex items-center gap-3 text-xs text-gray-400">
          <span className="bg-[#0d1117] px-3 py-1.5 rounded-lg border border-[#30363d]">
            Nodi: <strong className="text-white ml-1">{data.nodes.length}</strong>
          </span>
          <span className="bg-[#0d1117] px-3 py-1.5 rounded-lg border border-[#30363d]">
            Archi: <strong className="text-white ml-1">{data.links.length}</strong>
          </span>
          <span className="bg-[#0d1117] px-3 py-1.5 rounded-lg border border-[#30363d]">
            Sim. Media:{' '}
            <strong className="text-emerald-400 ml-1">
              {data.stats.avgSimilarity ? `${Math.round(data.stats.avgSimilarity * 100)}%` : '0%'}
            </strong>
          </span>
        </div>

        {/* Right: Quick Actions */}
        <div className="flex items-center gap-2.5">
          {/* Zoom In, Zoom Out & Fit Navigation Controls */}
          <div className="flex items-center gap-0.5 bg-[#0d1117] p-1 rounded-xl border border-[#30363d] shadow-sm">
            <button
              onClick={handleZoomIn}
              title="Ingrandisci (Zoom In)"
              className="p-1.5 hover:bg-[#21262d] text-gray-300 hover:text-white rounded-lg transition active:scale-95"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleZoomOut}
              title="Rimpicciolisci (Zoom Out)"
              className="p-1.5 hover:bg-[#21262d] text-gray-300 hover:text-white rounded-lg transition active:scale-95"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <div className="h-4 w-[1px] bg-[#30363d] mx-0.5" />
            <button
              onClick={handleFitView}
              title="Centra e Adatta la Vista (Fit)"
              className="flex items-center gap-1 px-2.5 py-1 hover:bg-[#21262d] text-gray-300 hover:text-white rounded-lg transition active:scale-95 text-xs font-medium"
            >
              <Target className="w-3.5 h-3.5 text-purple-400" />
              <span>Fit</span>
            </button>
          </div>

          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition ${
              showSettings
                ? 'bg-purple-900/40 text-purple-300 border-purple-600'
                : 'bg-[#0d1117] text-gray-300 hover:text-white border-[#30363d]'
            }`}
          >
            <Settings2 className="w-3.5 h-3.5 text-purple-400" />
            <span>Fisica & Filtri</span>
          </button>

          <button
            onClick={fetchGraphData}
            title="Ricalcola connessioni semantiche"
            className="p-2 bg-[#0d1117] hover:bg-[#21262d] text-gray-300 hover:text-white rounded-lg border border-[#30363d] transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-purple-400' : ''}`} />
          </button>
        </div>
      </div>

      {/* Main Canvas Area */}
      <div
        ref={containerRef}
        className="flex-1 w-full h-full relative cursor-grab active:cursor-grabbing bg-[#0a0d13]"
        onClick={() => {
          // Deselect when clicking background
          if (!hoverNode) {
            setSelectedNode(null);
          }
        }}
      >
        {data.nodes.length === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-6 space-y-3 z-0">
            <div className="p-4 bg-[#161b22] border border-[#30363d] rounded-2xl text-purple-400">
              <FileText className="w-10 h-10 mx-auto opacity-60" />
            </div>
            <h3 className="text-lg font-semibold text-white">Nessun documento indicizzato nel grafo</h3>
            <p className="text-sm text-gray-400 max-w-md">
              Aggiungi file PDF, Word o di testo dalla schermata Ingestion per esplorare la costellazione
              delle correlazioni semantiche.
            </p>
          </div>
        ) : (
          <ForceGraph2D
            ref={fgRef}
            width={dimensions.width}
            height={dimensions.height}
            graphData={data}
            backgroundColor="#0a0d13"
            nodeRelSize={4}
            cooldownTicks={120}
            warmupTicks={30}
            enableNodeDrag={true}
            // Link styling with Obsidian dimming
            linkColor={(link: any) => {
              if (focalNode) {
                return highlightLinks.has(link)
                  ? 'rgba(168, 85, 247, 0.95)' // glowing active link
                  : 'rgba(255, 255, 255, 0.03)'; // dimmed invisible link
              }
              if (link.type === 'document_sequence') {
                return 'rgba(99, 102, 241, 0.35)';
              }
              return 'rgba(168, 85, 247, 0.22)';
            }}
            linkWidth={(link: any) => {
              if (focalNode && highlightLinks.has(link)) {
                return Math.max(2.5, (link.similarity || 0.5) * 4);
              }
              return Math.max(0.8, (link.similarity || 0.5) * 1.8);
            }}
            linkDirectionalParticles={(link: any) => {
              if (focalNode) {
                return highlightLinks.has(link) ? 3 : 0;
              }
              return 1;
            }}
            linkDirectionalParticleSpeed={(link: any) => (link.similarity || 0.5) * 0.006}
            linkDirectionalParticleWidth={2}
            linkDirectionalParticleColor={() => '#38bdf8'}
            // Node hover and selection callbacks
            onNodeHover={(node: any) => setHoverNode(node || null)}
            onNodeClick={(node: any, event: any) => {
              event.stopPropagation();
              setSelectedNode(node);
            }}
            // Custom Obsidian Canvas Rendering
            nodeCanvasObject={(node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
              const isSelected = selectedNode?.id === node.id;
              const isHovered = hoverNode?.id === node.id;
              const isFocal = isSelected || isHovered;

              const isDimmed = focalNode ? !highlightNodes.has(node.id) : false;
              const isSearchMatch = matchingNodeIds ? matchingNodeIds.has(node.id) : true;

              const baseColor = getGroupColor(node.group || node.source);
              const nodeRadius = (node.val || 7);

              ctx.save();

              // Opacity logic for Obsidian hover isolation
              if (isDimmed || (matchingNodeIds && !isSearchMatch)) {
                ctx.globalAlpha = 0.12;
              } else {
                ctx.globalAlpha = 1.0;
              }

              // 1. Draw glowing neon halo on hover/select or search match
              if (isFocal || (matchingNodeIds && isSearchMatch)) {
                ctx.beginPath();
                ctx.arc(node.x, node.y, nodeRadius + 5, 0, 2 * Math.PI, false);
                ctx.fillStyle = isFocal ? `${baseColor}44` : 'rgba(250, 204, 21, 0.3)';
                ctx.fill();

                ctx.beginPath();
                ctx.arc(node.x, node.y, nodeRadius + 9, 0, 2 * Math.PI, false);
                ctx.fillStyle = isFocal ? `${baseColor}1a` : 'rgba(250, 204, 21, 0.1)';
                ctx.fill();
              }

              // 2. Draw Main Node Circle
              ctx.beginPath();
              ctx.arc(node.x, node.y, nodeRadius, 0, 2 * Math.PI, false);
              ctx.fillStyle = isFocal ? '#ffffff' : baseColor;
              ctx.fill();

              // Border ring
              ctx.lineWidth = isFocal ? 2.5 : 1.2;
              ctx.strokeStyle = isFocal ? baseColor : 'rgba(255, 255, 255, 0.45)';
              ctx.stroke();

              // 3. Draw Clean Obsidian Pill Label
              const shouldShowLabel =
                labelMode === 'always' ||
                (labelMode === 'hover' && (isFocal || (focalNode && highlightNodes.has(node.id)))) ||
                (matchingNodeIds && isSearchMatch);

              if (shouldShowLabel && (!isDimmed || isFocal)) {
                const labelText =
                  node.name.length > 26 ? `${node.name.slice(0, 24)}…` : node.name;
                const fontSize = Math.max(11 / globalScale, 3.8);

                ctx.font = `500 ${fontSize}px system-ui, -apple-system, sans-serif`;
                const textWidth = ctx.measureText(labelText).width;
                const paddingX = 5 / globalScale;
                const paddingY = 2.5 / globalScale;
                const labelY = node.y + nodeRadius + 4 / globalScale;

                // Pill background
                ctx.beginPath();
                const rectX = node.x - textWidth / 2 - paddingX;
                const rectY = labelY;
                const rectW = textWidth + paddingX * 2;
                const rectH = fontSize + paddingY * 2;
                const radius = 3 / globalScale;

                ctx.fillStyle = isFocal ? 'rgba(22, 27, 34, 0.95)' : 'rgba(13, 17, 23, 0.85)';
                ctx.strokeStyle = isFocal ? baseColor : 'rgba(255, 255, 255, 0.15)';
                ctx.lineWidth = 1 / globalScale;

                // Rounded rectangle
                ctx.roundRect(rectX, rectY, rectW, rectH, radius);
                ctx.fill();
                ctx.stroke();

                // Text
                ctx.textAlign = 'center';
                ctx.textBaseline = 'top';
                ctx.fillStyle = isFocal ? '#ffffff' : 'rgba(240, 246, 252, 0.85)';
                ctx.fillText(labelText, node.x, labelY + paddingY);
              }

              ctx.restore();
            }}
          />
        )}

        {/* Physics & Settings Panel (Slide-out Drawer from Left) */}
        {showSettings && (
          <div className="absolute top-4 left-4 bottom-20 w-80 bg-[#161b22]/95 backdrop-blur-md border border-[#30363d] rounded-2xl shadow-2xl p-4 flex flex-col justify-between z-30 animate-in slide-in-from-left duration-200">
            <div className="space-y-4 overflow-y-auto pr-1">
              <div className="flex items-center justify-between border-b border-[#30363d] pb-2.5">
                <div className="flex items-center gap-2">
                  <Sliders className="w-4 h-4 text-purple-400" />
                  <h4 className="font-semibold text-white text-sm">Fisica & Collegamenti</h4>
                </div>
                <button
                  onClick={() => setShowSettings(false)}
                  className="p-1 rounded-lg text-gray-400 hover:text-white hover:bg-[#30363d] transition"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Param: Similarity Threshold */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs text-gray-300">
                  <span>Soglia Similarità:</span>
                  <span className="font-mono text-purple-400 font-semibold">
                    {Math.round(threshold * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min="0.45"
                  max="0.95"
                  step="0.02"
                  value={threshold}
                  onChange={(e) => setThreshold(Number(e.target.value))}
                  className="w-full accent-purple-500 cursor-pointer"
                />
                <span className="text-[10px] text-gray-500 block">
                  Determina il grado di affinità minimo per connettere due nodi.
                </span>
              </div>

              {/* Param: Max Connections per Node (Top-K) */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs text-gray-300">
                  <span>Max Archi per Nodo (Top-K):</span>
                  <span className="font-mono text-purple-400 font-semibold">{topK}</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="8"
                  step="1"
                  value={topK}
                  onChange={(e) => setTopK(Number(e.target.value))}
                  className="w-full accent-purple-500 cursor-pointer"
                />
                <span className="text-[10px] text-gray-500 block">
                  Evita l'effetto "spaghetti": limita le connessioni a quelle più rilevanti.
                </span>
              </div>

              {/* Param: Repulsion Strength */}
              <div className="space-y-1.5 border-t border-[#30363d] pt-3">
                <div className="flex items-center justify-between text-xs text-gray-300">
                  <span>Repulsione Nodi (Charge):</span>
                  <span className="font-mono text-blue-400 font-semibold">{Math.abs(chargeStrength)}</span>
                </div>
                <input
                  type="range"
                  min="-600"
                  max="-100"
                  step="20"
                  value={chargeStrength}
                  onChange={(e) => setChargeStrength(Number(e.target.value))}
                  className="w-full accent-blue-500 cursor-pointer"
                />
                <span className="text-[10px] text-gray-500 block">
                  Spinge via i nodi per evitare ammassi densi.
                </span>
              </div>

              {/* Param: Link Distance */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs text-gray-300">
                  <span>Lunghezza Connessioni:</span>
                  <span className="font-mono text-blue-400 font-semibold">{linkDistance}px</span>
                </div>
                <input
                  type="range"
                  min="40"
                  max="220"
                  step="10"
                  value={linkDistance}
                  onChange={(e) => setLinkDistance(Number(e.target.value))}
                  className="w-full accent-blue-500 cursor-pointer"
                />
              </div>

              {/* Param: Collision Padding */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs text-gray-300">
                  <span>Anti-Sovrapposizione:</span>
                  <span className="font-mono text-blue-400 font-semibold">{collisionPadding}px</span>
                </div>
                <input
                  type="range"
                  min="4"
                  max="28"
                  step="2"
                  value={collisionPadding}
                  onChange={(e) => setCollisionPadding(Number(e.target.value))}
                  className="w-full accent-blue-500 cursor-pointer"
                />
              </div>

              {/* Param: Label Visibility */}
              <div className="space-y-1.5 border-t border-[#30363d] pt-3">
                <span className="text-xs text-gray-300 block">Etichette Nodi:</span>
                <div className="grid grid-cols-3 gap-1 bg-[#0d1117] p-1 rounded-lg border border-[#30363d]">
                  <button
                    onClick={() => setLabelMode('hover')}
                    className={`py-1 text-[11px] rounded transition ${
                      labelMode === 'hover'
                        ? 'bg-purple-600 text-white font-medium'
                        : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    Su Passaggio
                  </button>
                  <button
                    onClick={() => setLabelMode('always')}
                    className={`py-1 text-[11px] rounded transition ${
                      labelMode === 'always'
                        ? 'bg-purple-600 text-white font-medium'
                        : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    Sempre
                  </button>
                  <button
                    onClick={() => setLabelMode('hidden')}
                    className={`py-1 text-[11px] rounded transition ${
                      labelMode === 'hidden'
                        ? 'bg-purple-600 text-white font-medium'
                        : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    Nascoste
                  </button>
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-[#30363d] flex items-center justify-between">
              <button
                onClick={() => {
                  setThreshold(0.68);
                  setTopK(3);
                  setChargeStrength(-320);
                  setLinkDistance(100);
                  setCollisionPadding(14);
                  setLabelMode('hover');
                }}
                className="text-xs text-gray-400 hover:text-white underline"
              >
                Ripristina Default
              </button>
              <button
                onClick={() => {
                  setShowSettings(false);
                  fetchGraphData();
                }}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-purple-600 hover:bg-purple-500 text-white transition shadow"
              >
                Applica
              </button>
            </div>
          </div>
        )}

        {/* Selected Node Inspector Drawer (Obsidian Sidebar) */}
        {selectedNode && (
          <div className="absolute top-4 right-4 bottom-4 w-96 bg-[#161b22]/95 backdrop-blur-md border border-[#30363d] rounded-2xl shadow-2xl p-5 flex flex-col justify-between z-20 overflow-hidden animate-in slide-in-from-right duration-200">
            <div className="space-y-4 overflow-y-auto pr-1">
              {/* Header */}
              <div className="flex items-start justify-between gap-3 border-b border-[#30363d] pb-3">
                <div className="flex items-center gap-2.5">
                  <div
                    className="w-3.5 h-3.5 rounded-full shrink-0 shadow-sm"
                    style={{ backgroundColor: getGroupColor(selectedNode.group) }}
                  />
                  <div>
                    <h4 className="font-semibold text-white text-sm break-all leading-tight">
                      {selectedNode.name}
                    </h4>
                    <span className="text-[11px] text-gray-400">
                      {selectedNode.chunkCount
                        ? `${selectedNode.chunkCount} frammenti vettoriali indicizzati`
                        : 'Frammento vettoriale'}
                    </span>
                  </div>
                </div>

                <button
                  onClick={() => setSelectedNode(null)}
                  className="p-1 rounded-lg text-gray-400 hover:text-white hover:bg-[#30363d] transition"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Text Preview */}
              {selectedNode.previewText && (
                <div className="space-y-1.5">
                  <span className="text-xs font-medium text-gray-400 flex items-center gap-1.5">
                    <Info className="w-3.5 h-3.5 text-blue-400" />
                    Estratto Contenuto
                  </span>
                  <div className="bg-[#0d1117] p-3 rounded-xl border border-[#30363d] text-xs text-gray-300 leading-relaxed max-h-48 overflow-y-auto whitespace-pre-wrap font-sans">
                    {selectedNode.previewText}
                  </div>
                </div>
              )}

              {/* Semantically Connected Neighbors */}
              <div className="space-y-2 pt-2 border-t border-[#30363d]">
                <span className="text-xs font-medium text-gray-400 flex items-center justify-between">
                  <span>Connessioni Semantiche ({selectedNeighbors.length})</span>
                  <span className="text-[10px] text-purple-400 font-mono">
                    Top-{topK} (≥ {Math.round(threshold * 100)}%)
                  </span>
                </span>

                {selectedNeighbors.length === 0 ? (
                  <p className="text-xs text-gray-500 italic bg-[#0d1117] p-3 rounded-lg border border-[#30363d]">
                    Nessun documento supera la soglia di similarità attuale con questo nodo. Prova ad
                    abbassare la soglia dal pannello "Fisica & Filtri".
                  </p>
                ) : (
                  <div className="space-y-1.5 max-h-56 overflow-y-auto">
                    {selectedNeighbors.map(({ node, similarity }) => (
                      <button
                        key={node.id}
                        onClick={() => {
                          setSelectedNode(node);
                          handleCenterNode(node);
                        }}
                        className="w-full text-left bg-[#0d1117] hover:bg-[#21262d] p-2.5 rounded-lg border border-[#30363d] transition flex items-center justify-between group"
                      >
                        <div className="flex items-center gap-2 overflow-hidden">
                          <div
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: getGroupColor(node.group) }}
                          />
                          <span className="text-xs text-gray-200 group-hover:text-purple-300 transition truncate">
                            {node.name}
                          </span>
                        </div>
                        <span className="text-xs font-mono font-semibold text-emerald-400 ml-2 shrink-0">
                          {Math.round(similarity * 100)}%
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Footer with actions */}
            <div className="pt-3 border-t border-[#30363d] flex justify-end">
              <button
                onClick={() => handleCenterNode(selectedNode)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-purple-600 hover:bg-purple-500 text-white transition shadow active:scale-95"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Centra sul Nodo
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
