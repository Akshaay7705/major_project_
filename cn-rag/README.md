# Computer Networks RAG

A Retrieval-Augmented Generation (RAG) based study assistant for Computer Networks.

## Objective

The system uses Computer Networks textbooks and module PDFs as its knowledge base and provides context-aware answers to questions using retrieval and large language models.

## Features

- Textbook-based question answering
- Semantic search
- Source and page references
- 2-mark, 5-mark and 10-mark answers
- MCQ generation
- Viva preparation
- Module-wise learning

## Project Architecture & Stages

1. **Stage 1: PDF Ingestion & Inspection (Completed)**
   - Automatic discovery of PDFs in `data/` directory.
   - Safe parsing using PyMuPDF (`fitz`).
   - Page-by-page text extraction with 1-based page index preservation.
   - Character count tracking and page quality analysis.
   - Automatic document classification (`Text-based` vs. `Scanned / Image-based`).

2. **Stage 2: Text Extraction & Cleaning (Completed)**
   - Custom `TextCleaner` pipeline preserving headings, lists, bullet points, technical terms, and formulas.
   - Normalization of excessive whitespace and blank lines.
   - Creation of structured intermediate dataset at `processed/documents.jsonl`.
   - Retention of low-text pages (`has_meaningful_text: false`) and tracking scanned documents (`document_type: "scanned"`).

3. **Stage 3: Structure-Aware Chunking & Conservative Classification (Completed)**
   - Converts page-level records in `processed/documents.jsonl` into semantically cohesive, metadata-rich chunks in `processed/chunks.jsonl`.
   - Conservative content role classification (`content`, `table_of_contents`, `index`, `references`, `bibliography`, `glossary`, `low_value`).
   - Minimum ~100 token chunk size optimization and small chunk merging.

4. **Stage 4: Vector Embedding Generation using Google Gemini API (In Progress / Completed)**
   - Converts retrieval-eligible chunks (`metadata.retrieval_eligible == true`, 1,544 chunks) into vector embeddings using Google's Gemini API (`google-genai` SDK).
   - **Embedding Model**: Configurable via `GEMINI_EMBEDDING_MODEL` (default: `gemini-embedding-001`, 3,072 dimensions).
   - **Environment Credentials**: Uses `GEMINI_API_KEY` loaded dynamically via `python-dotenv`. Zero OpenAI dependency.
   - **Batching & Rate Control**: Processed in configurable batches (`EMBEDDING_BATCH_SIZE=25`) with exponential backoff handling for `429` rate limits.
   - **Resumability**: `processed/embeddings.jsonl` saves completed chunk embeddings per batch. Re-executing `python -m src.embedder` loads existing vector records and embeds only remaining chunks.
   - **Mandatory 9-Point Validation**:
     1. Every retrieval-eligible chunk has an embedding vector.
     2. Zero non-retrieval-eligible chunks embedded (TOC and index chunks excluded).
     3. Uniform vector dimension (3,072 dimensions).
     4. Unique `chunk_id` for every record.
     5. Valid numeric float vectors (no `NaN`/`Inf`/`null`).
     6. Source metadata present.
     7. Page range metadata present (`start_page`, `end_page`).
     8. Valid JSONL syntax on read-back.
     9. Embeddings count equals eligible chunks count (1,544).

5. **Stage 5: Vector Database Indexing (Completed)**
   - Upserts all 1,544 embedding vectors into a local **ChromaDB** persistent collection (`cn_rag`) with cosine distance metric.
   - **Persistence**: Index stored at `processed/chroma_db/` — zero cloud dependency.
   - **Resumability**: ChromaDB `upsert()` is idempotent; re-running `python -m src.indexer` is always safe.
   - **Mandatory 7-Point Validation**:
     1. Collection document count equals 1,544.
     2. Zero duplicate IDs in the collection.
     3. Random sample of 10 chunk_ids round-trip correctly.
     4. Metadata completeness (`source`, `start_page`, `end_page`) on sampled records.
     5. Similarity query returns ≥ 1 result.
     6. Returned distance scores are valid floats in [0, 2] (cosine distance range).
     7. Index is persisted on disk.
6. **Stage 6: Retrieval & Prompt Construction (Completed)**
   - `Retriever` class embeds queries using Gemini `RETRIEVAL_QUERY` task type and retrieves top-k chunks from ChromaDB via cosine similarity.
   - `PromptBuilder` assembles structured LLM-ready prompts with 6 configurable answer-type templates.
   - **Answer Types**: `general`, `2mark`, `5mark`, `10mark`, `mcq`, `viva`.
   - **Source Filtering**: Optional `source_filter` parameter restricts retrieval to a single PDF module.
   - **Similarity Scoring**: Cosine distance mapped to an intuitive `[0, 1]` similarity score.
7. **Stage 7: LLM Question Answering Interface (Completed)**
   - `QAEngine` ties together `Retriever` + `PromptBuilder` + Gemini LLM (`gemini-3.6-flash`) into a single end-to-end pipeline.
   - **Interactive REPL CLI**: `python -m src.qa_engine` — persistent session with slash commands.
   - **Single-query mode**: `python -m src.qa_engine --query "..." --type 5mark --no-interactive`
   - **CLI Commands**: `/type`, `/source`, `/sources`, `/top <N>`, `/help`, `/quit`
   - **LLM Model**: Configurable via `GEMINI_LLM_MODEL` (default: `gemini-3.6-flash`).

## Directory Structure

```text
computer-networks-rag/
├── data/                                # PDF documents and textbooks
│   ├── CN2MOD.pdf
│   ├── CN3MOD (1).pdf
│   ├── CN4MOD (2).pdf
│   ├── CNmod5.pdf                       # Scanned module PDF
│   ├── Data-Communications-and-Networking-5th-Ed-By-Behrouz-A.Forouzan.pdf
│   ├── _CN1MOD.pdf
│   └── network.pdf
├── processed/
│   ├── documents.jsonl                  # Page-level cleaned dataset (2,464 records)
│   ├── chunks.jsonl                     # Classified chunks dataset (1,668 records)
│   ├── embeddings.jsonl                 # Gemini vector embeddings dataset (1,544 records)
│   └── chroma_db/                       # ChromaDB persistent vector index
├── src/
│   ├── __init__.py                      # Package initializer
│   ├── pdf_processor.py                 # PDF processing engine
│   ├── text_cleaner.py                  # Technical text cleaner
│   ├── inspect_pdfs.py                  # Step 1: Inspection runner script
│   ├── build_documents.py              # Step 2: Document builder script
│   ├── chunker.py                       # Step 3: Structure-aware chunking & classifier
│   ├── gemini_client.py                 # Step 4: Reusable Gemini API client
│   ├── embedder.py                      # Step 4: Resumable vector embedding runner
│   ├── indexer.py                       # Step 5: ChromaDB vector indexer
│   ├── retriever.py                     # Step 6: Semantic retriever & RetrievalResult
│   ├── prompt_builder.py               # Step 6: LLM prompt assembler (6 answer types)
│   └── requirements.txt                 # Dependency requirements
├── .env.example                         # Environment variable template
├── .gitignore                           # Git security rules
├── requirements.txt                     # Project root requirements
└── README.md                            # Documentation
```

## Tech Stack

- Python 3.x
- PyMuPDF (`fitz`)
- Google Gemini API (`google-genai` SDK)
- ChromaDB (local persistent vector database)
- LangChain
- python-dotenv

## Answer Types

| Type      | Description                  | Target Length   |
| --------- | ---------------------------- | --------------- |
| `general` | Comprehensive explanation    | Unlimited       |
| `2mark`   | Short exam answer            | ~50 words       |
| `5mark`   | Medium exam answer           | ~150 words      |
| `10mark`  | Detailed exam answer         | ~400 words      |
| `mcq`     | 4-option MCQ with answer key | Fixed format    |
| `viva`    | 5-question viva Q&A          | Concise bullets |

## Setup & Execution Instructions

### 1. Environment Setup

Create `.env` from `.env.example` and set your Gemini API key:

```bash
cp .env.example .env
```

Edit `.env`:

```env
GEMINI_API_KEY=AIzaSy...
GEMINI_EMBEDDING_MODEL=gemini-embedding-001
EMBEDDING_BATCH_SIZE=25
```

### 2. Run Pipeline Stages

- **Step 1: Inspect PDFs**

  ```bash
  python -m src.inspect_pdfs
  ```

- **Step 2: Build Cleaned Documents Dataset**

  ```bash
  python -m src.build_documents
  ```

- **Step 3: Structure-Aware Chunking**

  ```bash
  python -m src.chunker
  ```

- **Step 4: Generate Gemini Vector Embeddings**

  ```bash
  python -m src.embedder
  ```

- **Step 5: Index Vectors into ChromaDB**
  ```bash
  python -m src.indexer
  ```

### Vector Record Schema (`processed/embeddings.jsonl`)

Each line in `processed/embeddings.jsonl` is a JSON object.

```json
{
  "chunk_id": "cn2mod_p003_0003",
  "embedding": [0.01234, -0.04567, 0.08901, ...],
  "text": "The identifier used in the IP layer of the TCP/IP protocol suite to identify the connection...",
  "metadata": {
    "source": "CN2MOD.pdf",
    "start_page": 3,
    "end_page": 6,
    "document_type": "text",
    "content_type": "content",
    "retrieval_eligible": true,
    "chapter": "Chapter 2: Network Layer Protocols",
    "section": "2.1. IPv4 Addresses"
  }
}
```
