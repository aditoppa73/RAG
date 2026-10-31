import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { createRequire } from 'module';
import { embeddingService } from './embedding';
import { qdrant, DEFAULT_COLLECTION } from './qdrant';

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const officeparser = require('officeparser');
const WordExtractor = require('word-extractor');

function isBinaryBuffer(buf: Buffer): boolean {
  const len = Math.min(buf.length, 1024);
  for (let i = 0; i < len; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

export interface Chunk {
  text: string;
  chunkIndex: number;
  totalChunks: number;
  source: string;
}

export function chunkText(text: string, chunkSize = 600, overlap = 100): string[] {
  const clean = text
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\t/g, ' ')
    .trim();
  if (clean.length <= chunkSize) return [clean];

  const chunks: string[] = [];
  let startIndex = 0;

  while (startIndex < clean.length) {
    let endIndex = startIndex + chunkSize;

    if (endIndex < clean.length) {
      const slice = clean.slice(startIndex, endIndex + 50);
      const paragraphBreak = slice.lastIndexOf('\n\n');
      const sentenceBreak = slice.lastIndexOf('. ');
      const newlineBreak = slice.lastIndexOf('\n');

      if (paragraphBreak > chunkSize * 0.6) {
        endIndex = startIndex + paragraphBreak + 2;
      } else if (sentenceBreak > chunkSize * 0.6) {
        endIndex = startIndex + sentenceBreak + 2;
      } else if (newlineBreak > chunkSize * 0.6) {
        endIndex = startIndex + newlineBreak + 1;
      }
    } else {
      endIndex = clean.length;
    }

    const chunk = clean.slice(startIndex, endIndex).trim();
    if (chunk.length > 20) {
      chunks.push(chunk);
    }

    if (endIndex >= clean.length) break;
    startIndex = Math.max(startIndex + 1, endIndex - overlap);
  }

  return chunks.length > 0 ? chunks : [clean];
}

async function parsePdfBuffer(fileBuffer: Buffer): Promise<string> {
  // 1. Try robust Python service (pypdf, zero native crash risk)
  try {
    const formData = new FormData();
    const blob = new Blob([fileBuffer], { type: 'application/pdf' });
    formData.append('file', blob, 'document.pdf');
    const res = await fetch('http://127.0.0.1:5002/extract-pdf', {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(10000)
    });
    if (res.ok) {
      const data = await res.json() as { text: string };
      if (data.text && data.text.trim().length > 10) {
        return data.text;
      }
    }
  } catch (pyErr) {
    // Fall back to node parser
  }

  // 2. Fallback to node pdfParse
  try {
    if (typeof pdfParse === 'function') {
      const data = await pdfParse(fileBuffer);
      return data.text || '';
    }
    if (pdfParse && pdfParse.PDFParse) {
      const parser = new pdfParse.PDFParse({ data: fileBuffer });
      try {
        const res = await parser.getText();
        if (typeof res === 'string') return res;
        if (res && res.text) return res.text;
        if (res && res.pages && Array.isArray(res.pages)) {
          return res.pages.map((p: any) => p.text || '').join('\n');
        }
        return String(res || '');
      } finally {
        await parser.destroy().catch(() => {});
      }
    }
  } catch (nodeErr) {
    console.warn('[PDF Parsing Warning] Could not parse PDF content', nodeErr);
  }
  return '';
}

async function extractWithDocling(fileBuffer: Buffer, filename: string): Promise<string | null> {
  try {
    const formData = new FormData();
    const blob = new Blob([fileBuffer]);
    formData.append('file', blob, filename);
    const res = await fetch('http://127.0.0.1:5002/extract-docling', {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(60000)
    });
    if (res.ok) {
      const data = await res.json() as { text: string };
      if (data.text && data.text.trim().length > 10) {
        return data.text;
      }
    }
  } catch (err) {
    console.warn(`[Docling Warning] Fallback triggered for ${filename}`);
  }
  return null;
}

export async function extractTextFromFile(filePath: string, buffer?: Buffer, originalName?: string): Promise<string> {
  const targetName = originalName || filePath;
  const ext = path.extname(targetName).toLowerCase();
  const fileBuffer = buffer || (await fs.readFile(filePath));

  switch (ext) {
    case '.pdf': {
      // 1. Try IBM Docling (deep layout, reading order, formatted tables)
      const doclingText = await extractWithDocling(fileBuffer, targetName);
      if (doclingText) return doclingText;

      // 2. Fallback to pypdf / node parser
      const parsedText = await parsePdfBuffer(fileBuffer);
      return parsedText;
    }

    case '.docx': {
      // 1. Try IBM Docling for structured markdown
      const doclingText = await extractWithDocling(fileBuffer, targetName);
      if (doclingText) return doclingText;

      // 2. Fallback to mammoth
      const result = await mammoth.extractRawText({ buffer: fileBuffer });
      return result.value || '';
    }

    case '.xlsx':
    case '.xls':
    case '.pptx':
    case '.ppt': {
      // IBM Docling parses spreadsheets & presentations into structured markdown tables and slides
      const doclingText = await extractWithDocling(fileBuffer, targetName);
      if (doclingText) return doclingText;
      throw new Error(`Impossibile estrarre tabelle/testo da ${targetName} tramite Docling`);
    }

    case '.doc': {
      try {
        const extractor = new WordExtractor();
        const extracted = await extractor.extract(fileBuffer);
        const bodyText = extracted.getBody();
        if (bodyText && bodyText.trim().length > 10) {
          return bodyText;
        }
      } catch (extractorErr) {
        console.warn(`[WordExtractor Warning] Falling back on officeparser for ${targetName}`);
      }

      try {
        const ast = await officeparser.parseOffice(fileBuffer);
        const opText = typeof ast === 'string' ? ast : (ast as any)?.toText?.() || '';
        if (opText && opText.trim().length > 10) return opText;
      } catch (opErr) {
        console.warn(`[officeparser Warning] Could not parse ${targetName}`);
      }

      throw new Error(`Impossibile estrarre testo valido dal file DOC binario.`);
    }

    case '.txt':
    case '.md':
    case '.markdown':
    case '.csv':
    case '.json':
    default: {
      if (isBinaryBuffer(fileBuffer)) {
        throw new Error(`File binario non supportato per l'estrazione testuale: ${ext}`);
      }
      return fileBuffer.toString('utf-8');
    }
  }
}

export async function ingestDocument(
  sourceName: string,
  fullText: string,
  collectionName = DEFAULT_COLLECTION
): Promise<{ chunks: number; pointIds: string[] }> {
  const rawChunks = chunkText(fullText);
  if (rawChunks.length === 0) {
    throw new Error('Nessun testo estratto valido da indicizzare.');
  }

  // Generate embeddings in batch via EmbeddingGemma-2 on GPU
  const vectors = await embeddingService.getBatchEmbeddings(rawChunks);

  const points = rawChunks.map((chunk, idx) => {
    return {
      id: crypto.randomUUID(),
      vector: vectors[idx],
      payload: {
        source: sourceName,
        text: chunk,
        mediaType: 'document',
        chunkIndex: idx,
        totalChunks: rawChunks.length,
        timestamp: Date.now()
      }
    };
  });

  await qdrant.upsertPoints(collectionName, points);
  return { chunks: points.length, pointIds: points.map(p => p.id) };
}

export async function ingestFile(
  filePath: string,
  originalName: string,
  collectionName = DEFAULT_COLLECTION
): Promise<{ chunks: number; mediaType: string }> {
  const ext = path.extname(originalName).toLowerCase();

  // 1. Image Files
  const imageExts = ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif'];
  if (imageExts.includes(ext)) {
    const vector = await embeddingService.embedImage(filePath, originalName);
    const point = {
      id: crypto.randomUUID(),
      vector,
      payload: {
        source: originalName,
        text: `[Immagine multimodale: ${originalName}]`,
        mediaType: 'image',
        chunkIndex: 0,
        totalChunks: 1,
        timestamp: Date.now()
      }
    };
    await qdrant.upsertPoints(collectionName, [point]);
    return { chunks: 1, mediaType: 'image' };
  }

  // 2. Audio Files
  const audioExts = ['.mp3', '.wav', '.m4a', '.ogg', '.flac', '.aac'];
  if (audioExts.includes(ext)) {
    const vector = await embeddingService.embedAudio(filePath, originalName);
    const point = {
      id: crypto.randomUUID(),
      vector,
      payload: {
        source: originalName,
        text: `[Registrazione audio multimodale: ${originalName}]`,
        mediaType: 'audio',
        chunkIndex: 0,
        totalChunks: 1,
        timestamp: Date.now()
      }
    };
    await qdrant.upsertPoints(collectionName, [point]);
    return { chunks: 1, mediaType: 'audio' };
  }

  // 3. Text and Document Files
  const text = await extractTextFromFile(filePath, undefined, originalName);
  const res = await ingestDocument(originalName, text, collectionName);
  return { chunks: res.chunks, mediaType: 'document' };
}

export async function scanAndIngestDirectory(
  dirPath: string,
  collectionName = DEFAULT_COLLECTION,
  recursive = true
): Promise<{ processedFiles: number; totalChunks: number; errors: string[] }> {
  const allowedExtensions = [
    '.txt',
    '.md',
    '.markdown',
    '.pdf',
    '.docx',
    '.doc',
    '.xlsx',
    '.xls',
    '.pptx',
    '.ppt',
    '.json',
    '.csv',
    '.png',
    '.jpg',
    '.jpeg',
    '.webp',
    '.mp3',
    '.wav',
    '.m4a'
  ];
  const errors: string[] = [];
  let processedFiles = 0;
  let totalChunks = 0;

  async function walk(currentDir: string) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (recursive && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
          await walk(fullPath);
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (allowedExtensions.includes(ext)) {
          try {
            const res = await ingestFile(fullPath, entry.name, collectionName);
            processedFiles++;
            totalChunks += res.chunks;
          } catch (err: any) {
            errors.push(`Error on ${entry.name}: ${err.message}`);
          }
        }
      }
    }
  }

  await walk(dirPath);
  return { processedFiles, totalChunks, errors };
}
