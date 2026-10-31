import fs from 'fs/promises';
import path from 'path';

const EMBEDDING_SERVICE_URL = process.env.EMBEDDING_SERVICE_URL || 'http://127.0.0.1:5002';

export interface EmbeddingHealth {
  ok: boolean;
  model: string;
  device?: string;
  gpu?: string | null;
  multimodal?: boolean;
}

export class EmbeddingService {
  private url: string;

  constructor(url = EMBEDDING_SERVICE_URL) {
    this.url = url;
  }

  async checkHealth(): Promise<EmbeddingHealth> {
    try {
      const res = await fetch(`${this.url}/health`, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const data = await res.json() as any;
      return {
        ok: true,
        model: data.model || 'google/embeddinggemma-2',
        device: data.device,
        gpu: data.gpu,
        multimodal: data.multimodal
      };
    } catch {
      return {
        ok: false,
        model: 'google/embeddinggemma-2 (Python Service Offline)',
        device: 'unknown'
      };
    }
  }

  async getEmbedding(text: string): Promise<number[]> {
    const cleanText = text.replace(/\s+/g, ' ').trim();
    if (!cleanText) return new Array(768).fill(0);

    const res = await fetch(`${this.url}/embed/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: cleanText })
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Embedding query failed: ${err}`);
    }

    const data = await res.json() as { embedding: number[] };
    return data.embedding;
  }

  async getBatchEmbeddings(texts: string[]): Promise<number[][]> {
    if (!texts || texts.length === 0) return [];

    const res = await fetch(`${this.url}/embed/text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts })
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Batch embedding failed: ${err}`);
    }

    const data = await res.json() as { embeddings: number[][] };
    return data.embeddings;
  }

  async embedImage(filePath: string, originalName?: string): Promise<number[]> {
    const fileBuffer = await fs.readFile(filePath);
    const filename = originalName || path.basename(filePath);
    const mimeType = filename.endsWith('.png') ? 'image/png' : 'image/jpeg';

    const formData = new FormData();
    const blob = new Blob([fileBuffer], { type: mimeType });
    formData.append('file', blob, filename);

    const res = await fetch(`${this.url}/embed/image`, {
      method: 'POST',
      body: formData
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Image embedding failed: ${err}`);
    }

    const data = await res.json() as { embedding: number[] };
    return data.embedding;
  }

  async embedAudio(filePath: string, originalName?: string): Promise<number[]> {
    const fileBuffer = await fs.readFile(filePath);
    const filename = originalName || path.basename(filePath);

    const formData = new FormData();
    const blob = new Blob([fileBuffer], { type: 'audio/wav' });
    formData.append('file', blob, filename);

    const res = await fetch(`${this.url}/embed/audio`, {
      method: 'POST',
      body: formData
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Audio embedding failed: ${err}`);
    }

    const data = await res.json() as { embedding: number[] };
    return data.embedding;
  }
}

export const embeddingService = new EmbeddingService();

