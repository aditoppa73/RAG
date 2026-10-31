import os
import io
import tempfile
from typing import List, Optional
import numpy as np
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import torch
from PIL import Image
import pypdf
import pandas as pd
import xlrd

app = FastAPI(title="EmbeddingGemma-2 & Docling Multimodal Service", version="2.3.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

device = "cuda" if torch.cuda.is_available() else "cpu"
print(f"[EmbeddingGemma-2] Hardware: {device.upper()}")
if device == "cuda":
    print(f"[EmbeddingGemma-2] Active GPU: {torch.cuda.get_device_name(0)}")

# Lazy loaders
_model = None
_docling_converter = None

def get_model():
    global _model
    if _model is None:
        print("[EmbeddingGemma-2] Loading google/embeddinggemma-2 on GPU...")
        from sentence_transformers import SentenceTransformer
        _model = SentenceTransformer("google/embeddinggemma-2", device=device)
        print("[EmbeddingGemma-2] Model initialized and ready.")
    return _model

def get_docling():
    global _docling_converter
    if _docling_converter is None:
        print("[Docling] Initializing IBM Docling DocumentConverter...")
        from docling.document_converter import DocumentConverter
        _docling_converter = DocumentConverter()
        print("[Docling] DocumentConverter ready.")
    return _docling_converter

def extract_excel_to_markdown(file_path: str) -> str:
    excel_file = pd.ExcelFile(file_path)
    sheets_markdown = []
    for sheet_name in excel_file.sheet_names:
        try:
            df = pd.read_excel(excel_file, sheet_name=sheet_name)
            df = df.dropna(how='all').dropna(axis=1, how='all')
            if not df.empty:
                # Format dataframe as Markdown table
                md_table = df.to_markdown(index=False)
                sheets_markdown.append(f"### Foglio: {sheet_name}\n\n{md_table}")
        except Exception as sheet_err:
            print(f"[Excel Parser Notice] Sheet {sheet_name}: {sheet_err}")
    return "\n\n".join(sheets_markdown)

class TextEmbedRequest(BaseModel):
    texts: List[str]

class QueryEmbedRequest(BaseModel):
    query: str

@app.get("/health")
def health():
    return {
        "status": "online",
        "model": "google/embeddinggemma-2",
        "device": device,
        "gpu": torch.cuda.get_device_name(0) if device == "cuda" else None,
        "dimensions": 768,
        "multimodal": True,
        "parser": "IBM Docling + Pandas/XLRD",
        "supported_modalities": ["text", "image", "audio", "video_keyframes", "pdf", "docx", "xlsx", "xls"]
    }

@app.post("/extract-docling")
async def extract_docling(file: UploadFile = File(...)):
    tmp_path = None
    try:
        suffix = os.path.splitext(file.filename or "temp.pdf")[1] or ".pdf"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(await file.read())
            tmp_path = tmp.name

        ext = suffix.lower()

        # 1. Spreadsheets (.xls and .xlsx): Use robust Pandas + XLRD / OpenPyXL
        if ext in ['.xls', '.xlsx']:
            try:
                excel_md = extract_excel_to_markdown(tmp_path)
                if excel_md and len(excel_md.strip()) > 5:
                    return {
                        "text": excel_md,
                        "filename": file.filename,
                        "status": "success",
                        "converter": "pandas_excel"
                    }
            except Exception as xl_err:
                print(f"[Excel Parser Notice] Direct excel extraction notice: {xl_err}")

        # 2. PDF, Word, Presentation: Use IBM Docling
        converter = get_docling()
        conv_result = converter.convert(tmp_path)
        markdown = conv_result.document.export_to_markdown()

        if markdown and len(markdown.strip()) > 10:
            return {
                "text": markdown,
                "filename": file.filename,
                "status": "success",
                "converter": "docling"
            }
        else:
            raise ValueError("Docling returned empty markdown output")

    except Exception as e:
        print(f"[Parser Notice] Fallback triggered for {file.filename}: {e}")
        # Fast fallback to pypdf for PDF
        try:
            if tmp_path and os.path.exists(tmp_path) and (file.filename or '').lower().endswith('.pdf'):
                reader = pypdf.PdfReader(tmp_path)
                pages_text = [p.extract_text() or "" for p in reader.pages]
                fallback_text = "\n\n".join([t.strip() for t in pages_text if t.strip()])
                if fallback_text:
                    return {
                        "text": fallback_text,
                        "filename": file.filename,
                        "status": "fallback",
                        "converter": "pypdf"
                    }
        except Exception as fb_err:
            print(f"[Fallback Error]: {fb_err}")

        raise HTTPException(status_code=500, detail=f"Errore estrazione documento: {str(e)}")
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except Exception:
                pass

@app.post("/extract-pdf")
async def extract_pdf(file: UploadFile = File(...)):
    try:
        contents = await file.read()
        reader = pypdf.PdfReader(io.BytesIO(contents))
        pages_text = []
        for page in reader.pages:
            t = page.extract_text() or ""
            if t.strip():
                pages_text.append(t.strip())
        full_text = "\n\n".join(pages_text)
        return {"text": full_text, "pages": len(reader.pages)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Errore estrazione PDF: {str(e)}")

@app.post("/embed/text")
def embed_text(req: TextEmbedRequest):
    if not req.texts:
        return {"embeddings": [], "dimensions": 768}
    model = get_model()
    embeddings = model.encode(req.texts, batch_size=16, convert_to_numpy=True, normalize_embeddings=True, show_progress_bar=False)
    return {
        "embeddings": embeddings.tolist(),
        "count": len(req.texts),
        "dimensions": int(embeddings.shape[1])
    }

@app.post("/embed/query")
def embed_query(req: QueryEmbedRequest):
    if not req.query:
        raise HTTPException(status_code=400, detail="Query cannot be empty")
    model = get_model()
    query_text = req.query.strip()
    embedding = model.encode([query_text], convert_to_numpy=True, normalize_embeddings=True, show_progress_bar=False)[0]
    return {
        "embedding": embedding.tolist(),
        "dimensions": len(embedding)
    }

@app.post("/embed/image")
async def embed_image(file: UploadFile = File(...)):
    try:
        contents = await file.read()
        image = Image.open(io.BytesIO(contents)).convert("RGB")
        model = get_model()
        embedding = model.encode([{"image": image}], convert_to_numpy=True, normalize_embeddings=True, show_progress_bar=False)[0]
        return {
            "filename": file.filename,
            "embedding": embedding.tolist(),
            "dimensions": len(embedding),
            "width": image.width,
            "height": image.height
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Errore embedding immagine: {str(e)}")

@app.post("/embed/audio")
async def embed_audio(file: UploadFile = File(...)):
    tmp_path = None
    try:
        suffix = os.path.splitext(file.filename or "temp.wav")[1] or ".wav"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(await file.read())
            tmp_path = tmp.name

        model = get_model()
        embedding = model.encode([{"audio": tmp_path}], convert_to_numpy=True, normalize_embeddings=True, show_progress_bar=False)[0]
        return {
            "filename": file.filename,
            "embedding": embedding.tolist(),
            "dimensions": len(embedding)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Errore embedding audio: {str(e)}")
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except Exception:
                pass

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=5002)
