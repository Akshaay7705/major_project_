"""
Retriever module for Computer Networks RAG.

Embeds a natural language query using Gemini (RETRIEVAL_QUERY task type)
and retrieves the top-k most semantically similar chunks from the ChromaDB
persistent vector store.

Standalone usage (smoke test):
    python -m src.retriever "What is the OSI model?"
    python -m src.retriever "Explain TCP three-way handshake" --top_k 3
    python -m src.retriever "IP addressing" --source CN2MOD.pdf
"""

from __future__ import annotations

import argparse
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

import chromadb
from dotenv import load_dotenv

from src.gemini_client import GeminiClient

load_dotenv()

COLLECTION_NAME = "cn_rag"
DEFAULT_TOP_K = 5
DEFAULT_CHROMA_PATH = "processed/chroma_db"


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------


@dataclass
class RetrievalResult:
    """A single ranked retrieval result from the vector store."""

    rank: int
    chunk_id: str
    text: str
    source: str
    start_page: int
    end_page: int
    distance: float       # cosine distance [0, 2]; lower = more similar
    similarity: float     # mapped to [0, 1]; higher = more similar

    def page_ref(self) -> str:
        """Return a human-readable page reference string."""
        if self.start_page == self.end_page:
            return f"p.{self.start_page}"
        return f"pp.{self.start_page}–{self.end_page}"

    def citation(self) -> str:
        """Return a formatted citation string."""
        return f"{self.source} ({self.page_ref()})"


# ---------------------------------------------------------------------------
# Retriever
# ---------------------------------------------------------------------------


class Retriever:
    """
    Semantic retriever backed by ChromaDB and Gemini query embeddings.

    :param top_k: Number of top results to retrieve (default 5).
    :param source_filter: Optional filename to restrict search to a single source PDF.
    :param chroma_path: Path to the ChromaDB persistence directory.
    :param embedding_model: Gemini embedding model name.
    """

    def __init__(
        self,
        top_k: int = DEFAULT_TOP_K,
        source_filter: Optional[str] = None,
        chroma_path: str = DEFAULT_CHROMA_PATH,
        embedding_model: Optional[str] = None,
    ) -> None:
        self.top_k = top_k
        self.source_filter = source_filter

        # Gemini client for query embedding
        self._gemini = GeminiClient(
            embedding_model=embedding_model or os.getenv("GEMINI_EMBEDDING_MODEL", "gemini-embedding-001"),
            max_retries=5,
            initial_backoff=60.0,
        )

        # ChromaDB persistent client
        chroma_db_path = Path(chroma_path)
        if not chroma_db_path.exists():
            raise FileNotFoundError(
                f"ChromaDB index not found at '{chroma_db_path}'. "
                "Run 'python -m src.indexer' first."
            )
        self._client = chromadb.PersistentClient(path=str(chroma_db_path))
        self._collection = self._client.get_collection(name=COLLECTION_NAME)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def retrieve(self, query: str) -> List[RetrievalResult]:
        """
        Embed the query and retrieve the top-k semantically similar chunks.

        :param query: Natural language query string.
        :return: Ranked list of RetrievalResult objects.
        :raises ValueError: If query is empty.
        """
        if not query or not query.strip():
            raise ValueError("Query must be a non-empty string.")

        query_vector = self._embed_query(query.strip())

        # Optional source filter
        where_filter: Optional[Dict[str, Any]] = None
        if self.source_filter:
            where_filter = {"source": {"$eq": self.source_filter}}

        query_kwargs: Dict[str, Any] = {
            "query_embeddings": [query_vector],
            "n_results": min(self.top_k, self._collection.count()),
            "include": ["documents", "metadatas", "distances"],
        }
        if where_filter:
            query_kwargs["where"] = where_filter

        response = self._collection.query(**query_kwargs)

        results: List[RetrievalResult] = []
        ids = response.get("ids", [[]])[0]
        docs = response.get("documents", [[]])[0]
        metas = response.get("metadatas", [[]])[0]
        dists = response.get("distances", [[]])[0]

        for rank, (cid, doc, meta, dist) in enumerate(zip(ids, docs, metas, dists), 1):
            # Clamp distance to [0, 2] to guard against float precision artifacts
            dist_clamped = max(0.0, min(2.0, dist))
            similarity = round(1.0 - dist_clamped / 2.0, 6)

            results.append(
                RetrievalResult(
                    rank=rank,
                    chunk_id=cid,
                    text=doc,
                    source=meta.get("source", ""),
                    start_page=int(meta.get("start_page", 0)),
                    end_page=int(meta.get("end_page", 0)),
                    distance=round(dist_clamped, 6),
                    similarity=similarity,
                )
            )

        return results

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _embed_query(self, query: str) -> List[float]:
        """
        Embed a single query string using Gemini RETRIEVAL_QUERY task type.

        :param query: Query string to embed.
        :return: Float embedding vector.
        """
        vectors = self._gemini.embed_texts([query], task_type="RETRIEVAL_QUERY")
        if not vectors or not vectors[0]:
            raise RuntimeError("Gemini returned an empty embedding for the query.")
        return vectors[0]


# ---------------------------------------------------------------------------
# Standalone smoke-test CLI
# ---------------------------------------------------------------------------


def _print_results(query: str, results: List[RetrievalResult]) -> None:
    print(f"\nQuery : \"{query}\"")
    print(f"Results: {len(results)} chunk(s) retrieved")
    print("=" * 70)
    for r in results:
        print(f"  #{r.rank}  [{r.similarity:.4f} similarity]  {r.citation()}")
        print(f"       chunk_id : {r.chunk_id}")
        preview = r.text[:200].replace("\n", " ")
        print(f"       preview  : {preview}...")
        print()


def _run_smoke_test() -> None:
    parser = argparse.ArgumentParser(description="CN-RAG Retriever smoke test")
    parser.add_argument("query", nargs="?", default="What is the OSI model?", help="Query string")
    parser.add_argument("--top_k", type=int, default=DEFAULT_TOP_K, help="Number of results")
    parser.add_argument("--source", type=str, default=None, help="Filter by source PDF filename")
    args = parser.parse_args()

    print("Initializing Retriever...", flush=True)
    retriever = Retriever(top_k=args.top_k, source_filter=args.source)
    print(f"Collection size: {retriever._collection.count():,} documents", flush=True)
    print("Embedding query...", flush=True)

    results = retriever.retrieve(args.query)
    _print_results(args.query, results)


if __name__ == "__main__":
    _run_smoke_test()
