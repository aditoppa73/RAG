# Local RAG Studio - Unified Enterprise Container
FROM python:3.11-slim-bookworm

# Install system utilities, graphics libraries for Docling/OpenCV, and Node.js 20 LTS
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    build-essential \
    libgl1 \
    libglib2.0-0 \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install Node dependencies
COPY package*.json ./
RUN npm install --no-audit --no-fund

# Copy application source code
COPY . .

# Pre-build Vite frontend into dist/
RUN npm run build

# Expose API gateway on 3001 and Python service on 5002
EXPOSE 3001 5002

# Set runtime environment defaults
ENV PORT=3001 \
    EMBEDDING_SERVICE_URL=http://127.0.0.1:5002 \
    OLLAMA_URL=http://ollama:11434 \
    QDRANT_URL=http://qdrant:6333 \
    DEFAULT_LLM_MODEL=gemma2:2b

# Start Python Embedding Service and Node.js Express Gateway concurrently
CMD ["npm", "run", "start"]

