"""Small local embedding service for CTFVault.

Run with:
  uvicorn scripts.embedding_service:app --host 127.0.0.1 --port 8000
"""
import os
from functools import lru_cache

from fastapi import FastAPI
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer

app = FastAPI()


class EmbedRequest(BaseModel):
    texts: list[str]
    model: str | None = None


@lru_cache(maxsize=1)
def model() -> SentenceTransformer:
    return SentenceTransformer(
        os.getenv("EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2")
    )


@app.post("/embed")
def embed(request: EmbedRequest):
    if not request.texts or len(request.texts) > 128:
        return {"embeddings": []}
    vectors = model().encode(request.texts, normalize_embeddings=True)
    return {"embeddings": vectors.tolist()}
