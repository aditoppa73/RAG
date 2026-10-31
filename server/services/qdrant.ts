import { QdrantClient } from '@qdrant/js-client-rest';

const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
export const DEFAULT_COLLECTION = 'rag_documents';

export class QdrantService {
  private client: QdrantClient;

  constructor(url = QDRANT_URL) {
    this.client = new QdrantClient({ url, checkCompatibility: false });
  }

  async checkHealth(): Promise<{ ok: boolean; collections: string[] }> {
    try {
      const res = await this.client.getCollections();
      const collections = (res.collections || []).map(c => c.name);
      return { ok: true, collections };
    } catch (err) {
      return { ok: false, collections: [] };
    }
  }

  async ensureCollection(name = DEFAULT_COLLECTION, size = 768) {
    const list = await this.client.getCollections();
    const exists = list.collections.some(c => c.name === name);
    if (!exists) {
      await this.client.createCollection(name, {
        vectors: {
          size,
          distance: 'Cosine'
        }
      });
    }
  }

  async upsertPoints(
    collectionName: string,
    points: Array<{
      id: string;
      vector: number[];
      payload: {
        source: string;
        text: string;
        chunkIndex: number;
        totalChunks: number;
        metadata?: Record<string, any>;
        timestamp?: number;
      };
    }>
  ) {
    await this.ensureCollection(collectionName, points[0]?.vector?.length || 768);
    // Batch upsert in chunks of 50
    const CHUNK_SIZE = 50;
    for (let i = 0; i < points.length; i += CHUNK_SIZE) {
      const slice = points.slice(i, i + CHUNK_SIZE);
      await this.client.upsert(collectionName, {
        points: slice
      });
    }
  }

  async search(
    collectionName: string,
    queryVector: number[],
    limit = 10,
    scoreThreshold = 0.0
  ) {
    await this.ensureCollection(collectionName);
    const searchRes = await this.client.query(collectionName, {
      query: queryVector,
      limit,
      score_threshold: scoreThreshold,
      with_payload: true
    });
    return searchRes.points || [];
  }

  async getAllPoints(collectionName: string) {
    await this.ensureCollection(collectionName);
    const allPoints: any[] = [];
    let offset: any = undefined;

    while (true) {
      const scrollRes = await this.client.scroll(collectionName, {
        limit: 250,
        offset,
        with_payload: true,
        with_vector: true
      });

      if (scrollRes.points && scrollRes.points.length > 0) {
        allPoints.push(...scrollRes.points);
      }

      if (!scrollRes.next_page_offset || scrollRes.points.length === 0) {
        break;
      }
      offset = scrollRes.next_page_offset;
      if (allPoints.length >= 5000) break;
    }

    return allPoints;
  }

  async getCollectionDocuments(collectionName: string): Promise<Array<{
    source: string;
    chunks: number;
    sampleText: string;
    mediaType?: string;
    timestamp?: number;
  }>> {
    await this.ensureCollection(collectionName);
    const docsMap: Record<string, {
      source: string;
      chunks: number;
      sampleText: string;
      mediaType?: string;
      timestamp?: number;
    }> = {};

    let offset: any = undefined;
    while (true) {
      const scrollRes = await this.client.scroll(collectionName, {
        limit: 250,
        offset,
        with_payload: true,
        with_vector: false
      });

      for (const point of scrollRes.points || []) {
        const payload = point.payload as any;
        const source = payload?.source || payload?.metadata?.source || 'Sconosciuto';
        if (!docsMap[source]) {
          docsMap[source] = {
            source,
            chunks: 0,
            sampleText: (payload?.text || '').slice(0, 200),
            mediaType: payload?.metadata?.mediaType,
            timestamp: payload?.timestamp
          };
        }
        docsMap[source].chunks++;
      }

      if (!scrollRes.next_page_offset || (scrollRes.points && scrollRes.points.length === 0)) {
        break;
      }
      offset = scrollRes.next_page_offset;
    }

    return Object.values(docsMap).sort((a, b) =>
      a.source.localeCompare(b.source, undefined, { numeric: true, sensitivity: 'base' })
    );
  }

  async deleteBySource(collectionName: string, sourceName: string) {
    await this.client.delete(collectionName, {
      filter: {
        must: [
          {
            key: 'source',
            match: { value: sourceName }
          }
        ]
      }
    });
  }

  async clearCollection(name: string) {
    try {
      await this.client.delete(name, {
        filter: {}
      });
      return { success: true, message: `Collezione ${name} svuotata con successo` };
    } catch (err: any) {
      throw new Error(`Impossibile svuotare la collezione: ${err.message}`);
    }
  }

  async deleteCollection(name: string) {
    try {
      // Try official Qdrant API
      await this.client.deleteCollection(name);
      return { success: true, message: `Collezione ${name} cancellata con successo` };
    } catch (err: any) {
      // Fallback for Windows NTFS bind-mount mmap lock
      try {
        const { default: fs } = await import('fs/promises');
        const { default: path } = await import('path');
        const colPath = path.join(process.cwd(), 'qdrant_storage', 'collections', name);
        await fs.rm(colPath, { recursive: true, force: true });
        return { success: true, message: `Collezione ${name} cancellata con successo` };
      } catch (fallbackErr: any) {
        throw new Error(`Impossibile cancellare la collezione: ${err.message}`);
      }
    }
  }
}

export const qdrant = new QdrantService();
