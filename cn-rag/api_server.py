"""
FastAPI server exposing the CN-RAG pipeline as an HTTP API.

Endpoints:
    POST /query          — Full RAG pipeline (retrieve + LLM answer)
    POST /retrieve       — Retrieval only (returns context chunks, no LLM call)
    GET  /health         — Health check

Usage:
    cd cn-rag
    python -m uvicorn api_server:app --host 0.0.0.0 --port 8100 --reload
"""

from __future__ import annotations

import os
import time
import traceback
from contextlib import asynccontextmanager
from typing import List, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

load_dotenv()

# ---------------------------------------------------------------------------
# Request / Response schemas
# ---------------------------------------------------------------------------


class QueryRequest(BaseModel):
    """Request body for /query and /retrieve endpoints."""
    query: str = Field(..., min_length=1, max_length=2000, description="The user question")
    answer_type: str = Field(
        default="general",
        description="Answer type: general, 2mark, 5mark, 10mark, mcq, viva",
    )
    top_k: int = Field(default=5, ge=1, le=20, description="Number of chunks to retrieve")
    source_filter: Optional[str] = Field(
        default=None, description="Optional PDF filename to restrict search"
    )


class SourceChunk(BaseModel):
    """A single retrieved source chunk."""
    rank: int
    chunk_id: str
    text: str
    source: str
    start_page: int
    end_page: int
    similarity: float
    citation: str


class RetrieveResponse(BaseModel):
    """Response body for /retrieve (retrieval only, no LLM)."""
    query: str
    chunks: List[SourceChunk]
    context_text: str  # Combined text of all chunks (ready to inject into a prompt)
    latency_seconds: float


class QueryResponse(BaseModel):
    """Response body for /query (full RAG pipeline)."""
    query: str
    answer: str
    answer_type: str
    sources: List[SourceChunk]
    llm_model: str
    latency_seconds: float


class HealthResponse(BaseModel):
    status: str
    index_size: int
    embedding_model: str
    llm_model: str


# ---------------------------------------------------------------------------
# App lifespan — initialize heavy components once at startup
# ---------------------------------------------------------------------------

# Global references populated at startup
_retriever = None
_builder = None
_qa_engine = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load the RAG pipeline components once at startup."""
    global _retriever, _builder, _qa_engine

    from src.retriever import Retriever
    from src.prompt_builder import PromptBuilder
    from src.qa_engine import QAEngine

    print("🔄 Initializing CN-RAG pipeline...", flush=True)
    chroma_path = os.getenv("CHROMA_DB_PATH", "processed/chroma_db")
    _retriever = Retriever(top_k=5, chroma_path=chroma_path)
    _builder = PromptBuilder()

    try:
        _qa_engine = QAEngine(top_k=5)
        print(f"✅ QAEngine ready — index: {_retriever._collection.count():,} chunks", flush=True)
    except Exception as e:
        print(f"⚠️ QAEngine init failed (retrieval-only mode): {e}", flush=True)
        _qa_engine = None

    yield  # App is running

    print("🛑 Shutting down CN-RAG API server.", flush=True)


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(
    title="CN-RAG API",
    description="Computer Networks Retrieval-Augmented Generation API",
    version="1.0.0",
    lifespan=lifespan,
)

# Allow the Next.js app to call this API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@app.get("/health", response_model=HealthResponse)
async def health():
    """Health check — confirms the RAG pipeline is loaded."""
    if _retriever is None:
        raise HTTPException(status_code=503, detail="RAG pipeline not initialized")

    from src.gemini_client import GeminiClient
    client = GeminiClient()

    return HealthResponse(
        status="ok",
        index_size=_retriever._collection.count(),
        embedding_model=client.embedding_model,
        llm_model=client.llm_model,
    )


@app.post("/retrieve", response_model=RetrieveResponse)
async def retrieve(req: QueryRequest):
    """
    Retrieval-only endpoint — returns the top-k matching chunks
    without making an LLM call. The chatbot's own LLM can use the
    returned `context_text` directly.
    """
    if _retriever is None:
        raise HTTPException(status_code=503, detail="RAG pipeline not initialized")

    try:
        t_start = time.perf_counter()

        # Rebuild retriever with request-specific params if needed
        from src.retriever import Retriever
        retriever = Retriever(
            top_k=req.top_k,
            source_filter=req.source_filter,
            chroma_path=os.getenv("CHROMA_DB_PATH", "processed/chroma_db"),
        )
        results = retriever.retrieve(req.query)

        chunks = [
            SourceChunk(
                rank=r.rank,
                chunk_id=r.chunk_id,
                text=r.text,
                source=r.source,
                start_page=r.start_page,
                end_page=r.end_page,
                similarity=r.similarity,
                citation=r.citation(),
            )
            for r in results
        ]

        # Build a combined context string for the chatbot to use
        context_parts = []
        for r in results:
            context_parts.append(
                f"[Source: {r.source}, {r.page_ref()}, similarity: {r.similarity:.4f}]\n{r.text.strip()}"
            )
        context_text = "\n\n---\n\n".join(context_parts)

        latency = round(time.perf_counter() - t_start, 3)

        return RetrieveResponse(
            query=req.query,
            chunks=chunks,
            context_text=context_text,
            latency_seconds=latency,
        )

    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Retrieval error: {str(e)}")


@app.post("/query", response_model=QueryResponse)
async def query(req: QueryRequest):
    """
    Full RAG pipeline — retrieve relevant chunks AND generate an LLM answer.
    Use this if you want the RAG system to generate the answer itself.
    """
    if _qa_engine is None:
        raise HTTPException(
            status_code=503,
            detail="QAEngine not available. Use /retrieve for retrieval-only mode.",
        )

    try:
        # Update engine settings per request
        _qa_engine.answer_type = req.answer_type
        if req.top_k != _qa_engine._retriever.top_k:
            _qa_engine.set_top_k(req.top_k)
        if req.source_filter != _qa_engine.source_filter:
            _qa_engine.set_source_filter(req.source_filter)

        result = _qa_engine.ask(req.query, answer_type=req.answer_type)

        sources = [
            SourceChunk(
                rank=r.rank,
                chunk_id=r.chunk_id,
                text=r.text,
                source=r.source,
                start_page=r.start_page,
                end_page=r.end_page,
                similarity=r.similarity,
                citation=r.citation(),
            )
            for r in result.sources
        ]

        return QueryResponse(
            query=result.query,
            answer=result.answer,
            answer_type=result.answer_type,
            sources=sources,
            llm_model=result.llm_model,
            latency_seconds=result.latency_seconds,
        )

    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"QA error: {str(e)}")


# ---------------------------------------------------------------------------
# Direct run support
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("RAG_API_PORT", "8100"))
    print(f"Starting CN-RAG API server on port {port}...")
    uvicorn.run("api_server:app", host="0.0.0.0", port=port, reload=True)
