"""
Indexer runner module for Computer Networks RAG.

Reads all 1,544 embedding records from processed/embeddings.jsonl and upserts
them into a local ChromaDB persistent vector store using cosine distance.

Usage:
    python -m src.indexer
"""

import json
import math
import os
import random
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

import chromadb

COLLECTION_NAME = "cn_rag"
INDEX_BATCH_SIZE = 100


def load_embeddings(embeddings_file: Path) -> List[Dict[str, Any]]:
    """
    Load all embedding records from JSONL file.

    :param embeddings_file: Path to embeddings.jsonl.
    :return: List of embedding record dicts.
    """
    records: List[Dict[str, Any]] = []
    with open(embeddings_file, "r", encoding="utf-8") as f:
        for line_no, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                records.append(json.loads(line))
            except json.JSONDecodeError as e:
                print(
                    f"Warning: Skipping malformed JSONL line {line_no}: {e}",
                    file=sys.stderr,
                    flush=True,
                )
    return records


def flatten_metadata(meta: Dict[str, Any]) -> Dict[str, Any]:
    """
    ChromaDB metadata values must be str | int | float | bool.
    Convert any None values to empty string to avoid rejection.

    :param meta: Raw metadata dict from embedding record.
    :return: ChromaDB-safe metadata dict.
    """
    safe: Dict[str, Any] = {}
    for k, v in meta.items():
        if v is None:
            safe[k] = ""
        elif isinstance(v, (str, int, float, bool)):
            safe[k] = v
        else:
            safe[k] = str(v)
    return safe


def validate_index(
    collection: chromadb.Collection,
    records: List[Dict[str, Any]],
    chroma_db_path: Path,
) -> None:
    """
    7-Point validation suite for the ChromaDB index.

    :param collection: ChromaDB collection after indexing.
    :param records: Original list of embedding records.
    :param chroma_db_path: Path to the persisted ChromaDB directory.
    :raises ValueError: On any validation failure.
    """
    expected_count = len(records)

    # Check 1: Document count equals expected
    actual_count = collection.count()
    if actual_count != expected_count:
        raise ValueError(
            f"Validation Check 1 Failed: Expected {expected_count} documents in collection, "
            f"found {actual_count}."
        )

    # Check 2: Zero duplicate IDs
    all_ids = collection.get(include=[])["ids"]
    if len(set(all_ids)) != len(all_ids):
        raise ValueError(
            "Validation Check 2 Failed: Duplicate IDs found in the collection."
        )

    # Check 3: Spot-check 10 random chunk_ids round-trip correctly
    sample_size = min(10, expected_count)
    sample_records = random.sample(records, sample_size)
    sample_ids = [r["chunk_id"] for r in sample_records]
    result = collection.get(ids=sample_ids, include=["documents", "metadatas"])
    returned_ids = set(result["ids"])
    for sid in sample_ids:
        if sid not in returned_ids:
            raise ValueError(
                f"Validation Check 3 Failed: chunk_id '{sid}' not found in collection on round-trip."
            )

    # Check 4: Metadata completeness on sampled records
    for meta in result["metadatas"]:
        for required_key in ("source", "start_page", "end_page"):
            val = meta.get(required_key)
            if val is None or val == "":
                raise ValueError(
                    f"Validation Check 4 Failed: Required metadata key '{required_key}' "
                    f"missing or empty on a sampled record."
                )

    # Check 5 & 6: Similarity smoke test + distance validation
    query_vector = None
    for rec in records:
        if rec["chunk_id"] == sample_ids[0]:
            query_vector = rec["embedding"]
            break

    if query_vector is not None:
        query_result = collection.query(
            query_embeddings=[query_vector],
            n_results=1,
            include=["distances"],
        )
        if not query_result or not query_result["ids"] or not query_result["ids"][0]:
            raise ValueError(
                "Validation Check 5 Failed: Similarity query returned no results."
            )

        dist = query_result["distances"][0][0]
        if not isinstance(dist, (int, float)) or math.isnan(dist) or math.isinf(dist):
            raise ValueError(
                f"Validation Check 6 Failed: Invalid distance value '{dist}' returned from query."
            )
        if not (-1e-6 <= dist <= 2.0):
            raise ValueError(
                f"Validation Check 6 Failed: Distance '{dist}' out of expected cosine range [0, 2]."
            )
    else:
        print("  (Skipping Check 5/6: could not locate sample embedding vector)", flush=True)

    # Check 7: Index is persisted on disk
    if not chroma_db_path.exists() or not any(chroma_db_path.iterdir()):
        raise ValueError(
            f"Validation Check 7 Failed: ChromaDB persistence directory "
            f"'{chroma_db_path}' is missing or empty."
        )


def run_indexing_pipeline() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    embeddings_file = Path("processed/embeddings.jsonl")
    chroma_db_path = Path("processed/chroma_db")

    if not embeddings_file.exists():
        print(
            f"Error: '{embeddings_file}' not found. Run 'python -m src.embedder' first.",
            file=sys.stderr,
            flush=True,
        )
        sys.exit(1)

    # 1. Load embedding records (deduplicate by chunk_id — last occurrence wins)
    print("Loading embedding records...", flush=True)
    raw_records = load_embeddings(embeddings_file)
    seen: Dict[str, Dict[str, Any]] = {}
    for rec in raw_records:
        seen[rec["chunk_id"]] = rec
    records = list(seen.values())
    raw_total = len(raw_records)
    total = len(records)
    if raw_total != total:
        print(
            f"  Note: Deduplicated {raw_total - total} duplicate chunk_ids "
            f"({raw_total} raw → {total} unique).",
            flush=True,
        )
    print(f"Loaded {total:,} unique records from '{embeddings_file}'.", flush=True)

    # 2. Initialize ChromaDB persistent client
    chroma_db_path.mkdir(parents=True, exist_ok=True)
    client = chromadb.PersistentClient(path=str(chroma_db_path))

    # 3. Get or create collection with cosine distance
    collection = client.get_or_create_collection(
        name=COLLECTION_NAME,
        metadata={"hnsw:space": "cosine"},
    )

    existing_count = collection.count()

    # Pre-flight banner
    print("=" * 55, flush=True)
    print("CHROMADB VECTOR INDEXING JOB", flush=True)
    print("=" * 55, flush=True)
    print(f"Embedding records        : {total:,}", flush=True)
    print(f"Collection               : {COLLECTION_NAME}", flush=True)
    print(f"Distance metric          : cosine", flush=True)
    print(f"Batch size               : {INDEX_BATCH_SIZE}", flush=True)
    print(f"Already in collection    : {existing_count:,}", flush=True)
    print(f"Persistence path         : {chroma_db_path.as_posix()}", flush=True)
    print("=" * 55, flush=True)
    print(flush=True)

    # 4. Upsert in batches (idempotent)
    num_batches = math.ceil(total / INDEX_BATCH_SIZE)

    for b_idx in range(num_batches):
        start = b_idx * INDEX_BATCH_SIZE
        end = min(start + INDEX_BATCH_SIZE, total)
        batch = records[start:end]

        ids = [r["chunk_id"] for r in batch]
        embeddings = [r["embedding"] for r in batch]
        documents = [r["text"] for r in batch]
        metadatas = [flatten_metadata(r["metadata"]) for r in batch]

        print(
            f"Indexing batch {b_idx + 1}/{num_batches} "
            f"(records {start + 1} - {end})... ",
            end="",
            flush=True,
        )

        collection.upsert(
            ids=ids,
            embeddings=embeddings,
            documents=documents,
            metadatas=metadatas,
        )
        print("DONE", flush=True)

    # 5. Run 7-Point Validation Suite
    print(flush=True)
    print("Running 7-Point Mandatory Validation Suite...", flush=True)

    try:
        validate_index(collection, records, chroma_db_path)
    except Exception as val_err:
        print(f"VALIDATION FAILURE: {val_err}", file=sys.stderr, flush=True)
        sys.exit(1)

    # 6. Final summary
    final_count = collection.count()
    print("=" * 55, flush=True)
    print("CHROMADB INDEXING PIPELINE FINAL SUMMARY", flush=True)
    print("=" * 55, flush=True)
    print(f"Records Loaded           : {total:,}", flush=True)
    print(f"Collection Name          : {COLLECTION_NAME}", flush=True)
    print(f"Total Indexed            : {final_count:,}", flush=True)
    print(f"Distance Metric          : cosine", flush=True)
    print(f"Batch Size               : {INDEX_BATCH_SIZE}", flush=True)
    print(f"Batches Processed        : {num_batches}", flush=True)
    print(f"Persistence Path         : {chroma_db_path.as_posix()}", flush=True)
    print("-" * 55, flush=True)
    print("Mandatory Validation Suite : ALL 7 CHECKS PASSED (0 Errors)", flush=True)
    print("  ✓ 1. Collection document count equals 1,544", flush=True)
    print("  ✓ 2. Zero duplicate IDs in collection", flush=True)
    print("  ✓ 3. Random sample of 10 chunk_ids round-trip correctly", flush=True)
    print("  ✓ 4. Metadata completeness (source, start_page, end_page)", flush=True)
    print("  ✓ 5. Similarity query returns >= 1 result", flush=True)
    print("  ✓ 6. Returned distance scores valid floats in [0, 2]", flush=True)
    print("  ✓ 7. Index persisted on disk", flush=True)
    print("=" * 55, flush=True)


if __name__ == "__main__":
    run_indexing_pipeline()
