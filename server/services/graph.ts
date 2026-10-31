import { qdrant, DEFAULT_COLLECTION } from './qdrant';

export interface GraphNode {
  id: string;
  name: string;
  source: string;
  group: string;
  val: number; // size in force graph
  chunkCount?: number;
  previewText?: string;
}

export interface GraphLink {
  source: string;
  target: string;
  similarity: number;
  type: 'semantic' | 'document_sequence';
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
  stats: {
    totalNodes: number;
    totalLinks: number;
    avgSimilarity: number;
    thresholdUsed: number;
    topKUsed: number;
  };
}

function dotProduct(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}

function vectorMagnitude(a: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * a[i];
  }
  return Math.sqrt(sum);
}

function cosineSimilarity(a: number[], b: number[]): number {
  const magA = vectorMagnitude(a);
  const magB = vectorMagnitude(b);
  if (magA === 0 || magB === 0) return 0;
  return dotProduct(a, b) / (magA * magB);
}

export async function generateObsidianGraph(
  collectionName = DEFAULT_COLLECTION,
  threshold = 0.70,
  mode: 'document' | 'chunk' = 'document',
  topK = 3
): Promise<GraphData> {
  const points = await qdrant.getAllPoints(collectionName);
  if (!points || points.length === 0) {
    return {
      nodes: [],
      links: [],
      stats: { totalNodes: 0, totalLinks: 0, avgSimilarity: 0, thresholdUsed: threshold, topKUsed: topK }
    };
  }

  if (mode === 'chunk') {
    // Each chunk is a node
    const nodes: GraphNode[] = points.map((p, idx) => {
      const payload = p.payload as any;
      const source = payload?.source || `doc_${idx}`;
      const text = payload?.text || payload?.page_content || '';
      return {
        id: String(p.id),
        name: `${source} [chunk ${payload?.chunkIndex ?? idx}]`,
        source,
        group: source,
        val: 3,
        previewText: text.slice(0, 200)
      };
    });

    const links: GraphLink[] = [];
    const addedLinkKeys = new Set<string>();

    const addLink = (src: string, tgt: string, sim: number, type: 'semantic' | 'document_sequence') => {
      const key = src < tgt ? `${src}__${tgt}` : `${tgt}__${src}`;
      if (!addedLinkKeys.has(key)) {
        addedLinkKeys.add(key);
        links.push({
          source: src,
          target: tgt,
          similarity: Number(sim.toFixed(4)),
          type
        });
      }
    };

    // 1. Group chunks by document to create backbone sequence links
    const chunksByDoc: Record<string, any[]> = {};
    points.forEach((p) => {
      const payload = p.payload as any;
      const src = payload?.source || 'unknown';
      if (!chunksByDoc[src]) chunksByDoc[src] = [];
      chunksByDoc[src].push(p);
    });

    // Add sequential backbone links for each document
    for (const docSource in chunksByDoc) {
      const docChunks = chunksByDoc[docSource];
      // sort by chunkIndex
      docChunks.sort((a, b) => ((a.payload?.chunkIndex ?? 0) - (b.payload?.chunkIndex ?? 0)));
      for (let i = 0; i < docChunks.length - 1; i++) {
        addLink(String(docChunks[i].id), String(docChunks[i + 1].id), 0.95, 'document_sequence');
      }
    }

    // 2. Add Top-K cross-document semantic links
    for (let i = 0; i < points.length; i++) {
      const pA = points[i];
      const vA = pA.vector as number[];
      if (!vA) continue;
      const srcA = (pA.payload as any)?.source;

      // Find top matches outside own document
      const candidates: { id: string; sim: number }[] = [];
      for (let j = 0; j < points.length; j++) {
        if (i === j) continue;
        const pB = points[j];
        const srcB = (pB.payload as any)?.source;
        if (srcA && srcB && srcA === srcB) continue; // skip intra-doc, already linked by sequence

        const vB = pB.vector as number[];
        if (!vB) continue;

        const sim = cosineSimilarity(vA, vB);
        if (sim >= threshold) {
          candidates.push({ id: String(pB.id), sim });
        }
      }

      candidates.sort((a, b) => b.sim - a.sim);
      const topNeighbors = candidates.slice(0, Math.min(topK, 2)); // limit chunk cross-links
      for (const neighbor of topNeighbors) {
        addLink(String(pA.id), neighbor.id, neighbor.sim, 'semantic');
      }
    }

    const simSum = links.reduce((sum, l) => sum + l.similarity, 0);

    return {
      nodes,
      links,
      stats: {
        totalNodes: nodes.length,
        totalLinks: links.length,
        avgSimilarity: links.length > 0 ? Number((simSum / links.length).toFixed(3)) : 0,
        thresholdUsed: threshold,
        topKUsed: topK
      }
    };
  }

  // Document Mode: Group chunks by source document
  const docGroups: Record<string, { vectors: number[][]; texts: string[]; count: number }> = {};

  for (const p of points) {
    const payload = p.payload as any;
    const source = payload?.source || payload?.metadata?.source || 'document_unknown';
    const vec = p.vector as number[];
    const text = payload?.text || payload?.page_content || '';

    if (!docGroups[source]) {
      docGroups[source] = { vectors: [], texts: [], count: 0 };
    }
    if (vec && Array.isArray(vec)) {
      docGroups[source].vectors.push(vec);
    }
    if (text) {
      docGroups[source].texts.push(text);
    }
    docGroups[source].count++;
  }

  // Calculate centroid (average embedding) for each document
  const docNames = Object.keys(docGroups);
  const docCentroids: Record<string, number[]> = {};

  for (const name of docNames) {
    const { vectors } = docGroups[name];
    if (vectors.length === 0) continue;
    const dim = vectors[0].length;
    const centroid = new Array(dim).fill(0);
    for (const v of vectors) {
      for (let d = 0; d < dim; d++) {
        centroid[d] += v[d];
      }
    }
    for (let d = 0; d < dim; d++) {
      centroid[d] /= vectors.length;
    }
    docCentroids[name] = centroid;
  }

  const nodes: GraphNode[] = docNames.map((name) => {
    const info = docGroups[name];
    // Node size scales comfortably with chunk count
    const nodeVal = Math.max(6, Math.min(22, 6 + Math.sqrt(info.count) * 2.5));
    const sampleSnippet = info.texts[0]?.slice(0, 220) || '';
    const ext = name.split('.').pop()?.toLowerCase() || 'doc';
    return {
      id: name,
      name,
      source: name,
      group: ext,
      val: nodeVal,
      chunkCount: info.count,
      previewText: sampleSnippet
    };
  });

  // Calculate pairwise similarities between centroids
  const simMatrix: Record<string, Array<{ target: string; similarity: number }>> = {};
  for (const name of docNames) {
    simMatrix[name] = [];
  }

  for (let i = 0; i < docNames.length; i++) {
    const nameA = docNames[i];
    const cA = docCentroids[nameA];
    if (!cA) continue;

    for (let j = i + 1; j < docNames.length; j++) {
      const nameB = docNames[j];
      const cB = docCentroids[nameB];
      if (!cB) continue;

      const sim = cosineSimilarity(cA, cB);
      if (sim >= threshold) {
        simMatrix[nameA].push({ target: nameB, similarity: sim });
        simMatrix[nameB].push({ target: nameA, similarity: sim });
      }
    }
  }

  // Apply Top-K filtering per document node to prevent spaghetti cliques
  const links: GraphLink[] = [];
  const addedEdges = new Set<string>();

  for (const name of docNames) {
    const sorted = simMatrix[name].sort((a, b) => b.similarity - a.similarity);
    const topNeighbors = sorted.slice(0, topK);

    for (const neighbor of topNeighbors) {
      const key = name < neighbor.target ? `${name}__${neighbor.target}` : `${neighbor.target}__${name}`;
      if (!addedEdges.has(key)) {
        addedEdges.add(key);
        links.push({
          source: name,
          target: neighbor.target,
          similarity: Number(neighbor.similarity.toFixed(4)),
          type: 'semantic'
        });
      }
    }
  }

  const simSum = links.reduce((sum, l) => sum + l.similarity, 0);

  return {
    nodes,
    links,
    stats: {
      totalNodes: nodes.length,
      totalLinks: links.length,
      avgSimilarity: links.length > 0 ? Number((simSum / links.length).toFixed(3)) : 0,
      thresholdUsed: threshold,
      topKUsed: topK
    }
  };
}
