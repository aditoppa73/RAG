import { embeddingService } from './embedding';

export const ollama = {
  checkHealth: () => embeddingService.checkHealth().then(h => ({
    ok: h.ok,
    models: [h.model],
    currentModel: h.model
  })),
  getEmbedding: (text: string) => embeddingService.getEmbedding(text),
  getBatchEmbeddings: (texts: string[]) => embeddingService.getBatchEmbeddings(texts)
};
