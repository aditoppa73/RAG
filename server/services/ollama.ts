import path from 'path';
import { embeddingService } from './embedding';

const OLLAMA_HOST = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const DEFAULT_LLM_MODEL = process.env.DEFAULT_LLM_MODEL || 'gemma2:2b';
const KNOWN_LIGHT_MODELS = ['gemma2:2b', 'qwen2.5:3b', 'qwen2.5:latest'];

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
    
    // Choose model priority: requested model -> gemma2:2b (safe for 6GB GPU) -> qwen2.5 -> gemma2:9b
    let chosenModel = model || DEFAULT_LLM_MODEL;
    if (!availableModels.includes(chosenModel)) {
      if (availableModels.some(m => m.startsWith('gemma2:2b'))) {
        chosenModel = availableModels.find(m => m.startsWith('gemma2:2b'))!;
      } else if (availableModels.some(m => m.startsWith('qwen2.5'))) {
        chosenModel = availableModels.find(m => m.startsWith('qwen2.5'))!;
      } else if (availableModels.some(m => m.startsWith('gemma2:9b'))) {
        chosenModel = availableModels.find(m => m.startsWith('gemma2:9b'))!;
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
      const fileName = path.basename(c.source);
      return `[DOCUMENTO: ${fileName} | Rilevanza: ${similarityPercent}%]\n${c.text.trim()}`;
    }).join('\n\n--------------------\n\n');

    const prompt = `Sei un assistente RAG esperto e analitico. Il tuo compito è rispondere alla domanda dell'utente basandoti ESCLUSIVAMENTE sui contesti documentali estratti da Qdrant riportati di seguito.

REGOLE FONDAMENTALI:
1. Rispondi in italiano con tono chiaro, professionale e ben strutturato (usa elenchi puntati o tabelle se opportuno).
2. Usa SOLTANTO le informazioni presenti nei contesti forniti. NON inventare o estrapolare nulla che non sia verificabile.
3. Se i contesti non contengono informazioni sufficienti a rispondere alla domanda, dichiara chiaramente che i documenti indicizzati non contengono tale dato.
4. Quando citi una regola, un articolo o un requisito, indica SEMPRE il nome esatto del documento tra parentesi quadre (es. [nome_file]). Non usare MAI etichette anonime come "FONTE 1" o segnaposto generici.

CONTESTI ESTRATTI DALLA BASE DI CONOSCENZA:
==============================
${contextBlock}
==============================

DOMANDA DELL'UTENTE:
${query}

RISPOSTA:`;

    // Helper to resolve any residual [FONTE X] citations and clean up the response
    const formatAndAttachSources = (text: string): string => {
      let resolved = text;

      // 1. If LLM produced dummy template lines, remove them
      resolved = resolved
        .replace(/\n*\*{0,2}Fonti consultate:\*{0,2}\s*\n-\s*\[?nome_file(\.pdf)?\]?/gi, '')
        .replace(/\n*\*{0,2}Riassunto:\*{0,2}\s*$/gi, '')
        .trim();

      // 2. Replace any [FONTE 1], [FONTE 6], etc. with actual filenames
      contexts.forEach((c, i) => {
        const fileName = path.basename(c.source);
        const regex = new RegExp(`\\[FONTE\\s*${i + 1}(?:\\s*:[^\\]]*)?\\]`, 'gi');
        resolved = resolved.replace(regex, `[${fileName}]`);
      });

      // 3. Extract unique source filenames
      const uniqueSources = Array.from(new Set(contexts.map(c => path.basename(c.source))));
      const sourcesFooter = `\n\n---\n**📄 Documenti consultati:**\n` + 
        uniqueSources.map(s => `- \`${s}\``).join('\n');

      return `${resolved}${sourcesFooter}`;
    };

    const sendGenerateRequest = async (targetModel: string, options?: Record<string, any>) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout

      try {
        const res = await fetch(`${OLLAMA_HOST}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
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
          throw new Error(`Risposta non valida da Ollama (${res.status}): ${raw.slice(0, 200)}`);
        }

        if (parsed.error) {
          throw new Error(parsed.error);
        }

        return parsed.response ? parsed.response.trim() : '';
      } finally {
        clearTimeout(timeoutId);
      }
    };

    try {
      // 1. Try standard generation on target model
      const rawAnswer = await sendGenerateRequest(chosenModel);
      const answer = formatAndAttachSources(rawAnswer);
      return { answer, modelUsed: chosenModel };
    } catch (err: any) {
      const errMsg = String(err?.message || err);
      console.warn(`[Ollama Generation Failed on ${chosenModel}]`, errMsg);

      // 2. Automatic Failover to lighter model if heavy model crashed / dropped socket
      const candidateFallbacks = [...availableModels, ...KNOWN_LIGHT_MODELS];
      const fallback = candidateFallbacks.find(
        m => m !== chosenModel && (m.includes('2b') || m.includes('3b') || m.includes('qwen'))
      );

      if (fallback) {
        console.log(`[Ollama Failover] Tentativo di recupero automatico con modello leggero: ${fallback}...`);
        try {
          // Wait 2.5s in case Ollama runner crashed and daemon is restarting
          await new Promise(resolve => setTimeout(resolve, 2500));
          const rawFallback = await sendGenerateRequest(fallback);
          const fallbackAnswer = formatAndAttachSources(rawFallback);
          return {
            answer: `${fallbackAnswer}\n\n*(Nota: Risposta elaborata automaticamente con **${fallback}** poiché **${chosenModel}** richiede più VRAM di quella disponibile sulla GPU.)*`,
            modelUsed: `${fallback} (failover da ${chosenModel})`
          };
        } catch (fbErr: any) {
          console.warn('[Ollama Failover Failed]', fbErr);
        }
      }

      throw new Error(
        `Errore generazione risposta LLM (${chosenModel}): ${errMsg}. La memoria GPU (6GB) è insufficiente per questo modello: seleziona 'gemma2:2b' dal menu a tendina.`
      );
    }
  }
};
