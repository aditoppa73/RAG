import { embeddingService } from './embedding';

const OLLAMA_HOST = process.env.OLLAMA_URL || 'http://localhost:11434';
const DEFAULT_LLM_MODEL = process.env.DEFAULT_LLM_MODEL || 'gemma2:9b';

export interface OllamaHealth {
  ok: boolean;
  models: string[];
  currentModel: string;
  ollamaAvailable: boolean;
}

export interface RagContextChunk {
  source: string;
  text: string;
  score: number;
  chunkIndex?: number;
}

export interface GenerateAnswerParams {
  query: string;
  contexts: RagContextChunk[];
  model?: string;
}

export const ollama = {
  // Embedding delegates to Python microservice (google/embeddinggemma-2 on GPU)
  getEmbedding: (text: string) => embeddingService.getEmbedding(text),
  getBatchEmbeddings: (texts: string[]) => embeddingService.getBatchEmbeddings(texts),

  // Check health of both Ollama LLM and Python embedding microservice
  async checkHealth(): Promise<OllamaHealth> {
    const embedHealth = await embeddingService.checkHealth().catch(() => ({ ok: false, model: 'unknown' }));
    
    try {
      const res = await fetch(`${OLLAMA_HOST}/api/tags`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const data = await res.json() as { models?: Array<{ name: string }> };
        const modelNames = (data.models || []).map(m => m.name);
        return {
          ok: embedHealth.ok,
          ollamaAvailable: true,
          models: modelNames.length > 0 ? modelNames : [DEFAULT_LLM_MODEL],
          currentModel: modelNames.includes(DEFAULT_LLM_MODEL) ? DEFAULT_LLM_MODEL : (modelNames[0] || DEFAULT_LLM_MODEL)
        };
      }
    } catch {}

    return {
      ok: embedHealth.ok,
      ollamaAvailable: false,
      models: [embedHealth.model],
      currentModel: embedHealth.model
    };
  },

  // List available generative models from Ollama (excluding embedding-only models)
  async listModels(): Promise<string[]> {
    try {
      const res = await fetch(`${OLLAMA_HOST}/api/tags`, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) return [];
      const data = await res.json() as { models?: Array<{ name: string }> };
      const allNames = (data.models || []).map(m => m.name);
      return allNames.filter(name => !name.includes('embed'));
    } catch {
      return [];
    }
  },

  // Generative analysis with LLM (Gemma 2 / Qwen 2.5) over Qdrant search contexts
  async generateAnswer({ query, contexts, model }: GenerateAnswerParams): Promise<{ answer: string; modelUsed: string }> {
    const availableModels = await this.listModels();
    
    // Choose model priority: requested model -> gemma2:9b -> gemma2:2b -> qwen2.5 -> first available
    let chosenModel = model || DEFAULT_LLM_MODEL;
    if (!availableModels.includes(chosenModel)) {
      if (availableModels.some(m => m.startsWith('gemma2:9b'))) {
        chosenModel = availableModels.find(m => m.startsWith('gemma2:9b'))!;
      } else if (availableModels.some(m => m.startsWith('gemma2:2b'))) {
        chosenModel = availableModels.find(m => m.startsWith('gemma2:2b'))!;
      } else if (availableModels.some(m => m.startsWith('gemma2'))) {
        chosenModel = availableModels.find(m => m.startsWith('gemma2'))!;
      } else if (availableModels.some(m => m.startsWith('qwen2.5'))) {
        chosenModel = availableModels.find(m => m.startsWith('qwen2.5'))!;
      } else if (availableModels.length > 0) {
        chosenModel = availableModels[0];
      }
    }

    if (contexts.length === 0) {
      return {
        answer: "Non sono stati trovati documenti pertinenti nella collezione selezionata per rispondere a questa domanda.",
        modelUsed: chosenModel
      };
    }

    const contextBlock = contexts.map((c, i) => {
      const similarityPercent = Math.round(c.score * 100);
      return `[FONTE ${i + 1}: ${c.source} | Rilevanza: ${similarityPercent}%]\n${c.text.trim()}`;
    }).join('\n\n--------------------\n\n');

    const prompt = `Sei un assistente RAG esperto e analitico. Il tuo compito è rispondere alla domanda dell'utente basandoti ESCLUSIVAMENTE sui contesti documentali estratti da Qdrant riportati di seguito.

REGOLE FONDAMENTALI:
1. Rispondi in italiano con tono chiaro, professionale e ben strutturato (usa elenchi puntati o sezioni se opportuno).
2. Usa SOLTANTO le informazioni presenti nei contesti forniti. NON inventare o estrapolare nulla che non sia verificabile.
3. Se i contesti non contengono informazioni sufficienti a rispondere alla domanda, dichiara chiaramente che i documenti indicizzati non contengono tale dato.
4. Ogni volta che citi un dato o concetto, indica la fonte tra parentesi quadre (es. [nome_file.pdf]).

CONTESTI ESTRATTI DALLA BASE DI CONOSCENZA:
==============================
${contextBlock}
==============================

DOMANDA DELL'UTENTE:
${query}

RISPOSTA:`;

    const sendGenerateRequest = async (targetModel: string, options?: Record<string, any>) => {
      const res = await fetch(`${OLLAMA_HOST}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: targetModel,
          prompt,
          stream: false,
          options: {
            temperature: 0.2,
            top_p: 0.9,
            num_predict: 1024,
            ...options
          }
        })
      });

      const raw = await res.text();
      let parsed: any;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error(`Risposta Ollama non valida (${res.status}): ${raw.slice(0, 200)}`);
      }

      if (parsed.error) {
        throw new Error(parsed.error);
      }

      return parsed.response ? parsed.response.trim() : '';
    };

    try {
      // 1. Try standard generation on target model
      const answer = await sendGenerateRequest(chosenModel);
      return { answer, modelUsed: chosenModel };
    } catch (err: any) {
      const errMsg = String(err?.message || err);
      console.warn(`[Ollama Generation Warning with ${chosenModel}]`, errMsg);

      // Check for GPU VRAM Out Of Memory
      if (errMsg.includes('out of memory') || errMsg.includes('cudaMalloc') || errMsg.includes('terminated')) {
        console.log(`[Ollama Failover] VRAM insufficiente per ${chosenModel}. Tentativo di fallback CPU/RAM (num_gpu: 0)...`);
        try {
          const cpuAnswer = await sendGenerateRequest(chosenModel, { num_gpu: 0 });
          return { answer: cpuAnswer, modelUsed: `${chosenModel} (CPU offload)` };
        } catch (cpuErr) {
          console.warn('[Ollama CPU offload failed]', cpuErr);
        }

        // Try smaller lightweight model (e.g. gemma2:2b or qwen2.5:3b) if available
        const fallback = availableModels.find(m => m !== chosenModel && (m.includes('2b') || m.includes('3b') || m.includes('qwen')));
        if (fallback) {
          console.log(`[Ollama Failover] Esecuzione su modello alternativo leggero: ${fallback}...`);
          const fallbackAnswer = await sendGenerateRequest(fallback);
          return { answer: fallbackAnswer, modelUsed: `${fallback} (fallback da ${chosenModel})` };
        }
      }

      throw new Error(`Errore generazione risposta LLM (${chosenModel}): ${errMsg}`);
    }
  }
};
