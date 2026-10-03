"""
Structure-Aware Chunker module with Conservative Content Classification for Computer Networks RAG.

Converts page-level document records in processed/documents.jsonl into
semantically cohesive, metadata-rich chunks stored in processed/chunks.jsonl.
Classifies each chunk conservatively by content role (content, table_of_contents, index, etc.)
and assigns a retrieval_eligible boolean flag without discarding data.

Usage:
    python -m src.chunker
"""

from dataclasses import dataclass
import json
import os
from pathlib import Path
import re
import sys
from typing import List, Dict, Any, Optional, Set, Tuple


@dataclass
class StructuralUnit:
    """Represents a discrete structural unit (paragraph, heading, list item) from a document."""
    text: str
    page_number: int
    source: str
    content_type: str
    retrieval_eligible: bool
    chapter: Optional[str] = None
    section: Optional[str] = None


class ContentClassifier:
    """Conservative classifier for page content roles and retrieval eligibility."""

    TOC_EXACT_TITLE = [
        "BRIEF CONTENTS",
        "TABLE OF CONTENTS",
        "CONTENTS AT A GLANCE",
        "MODULE OUTLINE",
        "COURSE OUTLINE",
        "LIST OF FIGURES",
        "LIST OF TABLES",
    ]

    @classmethod
    def classify_page(
        cls, text: str, filename: str, page_num: int, has_meaningful_text: bool, doc_type: str
    ) -> Tuple[str, bool]:
        """
        Conservatively classify page content role and determine retrieval eligibility.
        Default to ('content', True) if uncertain.

        :param text: Page text.
        :param filename: Source PDF filename.
        :param page_num: 1-based page number.
        :param has_meaningful_text: Bool flag from document ingestion.
        :param doc_type: 'text' or 'scanned'.
        :return: Tuple of (content_type, retrieval_eligible).
        """
        # 1. Scanned or low text pages
        if doc_type == "scanned":
            return "low_value", False
        if not has_meaningful_text or len(text.strip()) < 50:
            return "low_value", False

        lines = [l.strip() for l in text.split("\n") if l.strip()]
        if not lines:
            return "low_value", False

        top_3_lines = lines[:3]
        top_3_upper = [l.upper() for l in top_3_lines]
        full_upper = text.upper()

        # 2. Low Value (copyright, disclaimers, dedications, blank pages)
        if "THIS PAGE INTENTIONALLY LEFT BLANK" in full_upper:
            return "low_value", False
        if "ALL RIGHTS RESERVED" in full_upper and ("PUBLISHED BY" in full_upper or "COPYRIGHT" in full_upper):
            return "low_value", False
        if len(text.strip()) < 120 and ("DEDICATED TO" in full_upper or "TO MY" in full_upper):
            return "low_value", False

        # 3. Table of Contents (Strict Header or Outline Density)
        for l_upper in top_3_upper:
            if any(l_upper == kw or l_upper.startswith(kw + " ") for kw in cls.TOC_EXACT_TITLE):
                return "table_of_contents", False
            if l_upper in ("CONTENTS", "C O N T E N T S"):
                return "table_of_contents", False

        # Outline density heuristic (e.g., CN2MOD.pdf page 2)
        sec_outline_matches = re.findall(r"^\s*\d+\.\d+(?:\.\d+)?[\.\:\s]", text, re.MULTILINE)
        dot_leaders = re.findall(r"\.{3,}\s*\d+", text)
        avg_line_len = sum(len(l) for l in lines) / max(len(lines), 1)

        if (len(sec_outline_matches) >= 4 or len(dot_leaders) >= 3) and avg_line_len < 55:
            long_prose_sentences = re.findall(r"[A-Z][^.!?]{60,}[.!?]", text)
            if len(long_prose_sentences) <= 1:
                return "table_of_contents", False

        # 4. Index (Strict Standalone Header or Dense Term-Page Pattern)
        index_header_matched = False
        for l_upper in top_3_upper:
            if l_upper in ("INDEX", "SUBJECT INDEX", "AUTHOR INDEX", "KEYWORD INDEX", "I N D E X"):
                index_header_matched = True
                break
            if re.match(r"^(?:SUBJECT\s+|AUTHOR\s+|KEYWORD\s+)?INDEX$", l_upper):
                index_header_matched = True
                break

        index_term_lines = re.findall(
            r"^[A-Za-z0-9\s\-_–\(\)]+,\s*\d+(?:\s*[,\-\–]\s*\d+)*$", text, re.MULTILINE
        )

        if index_header_matched or len(index_term_lines) >= 6:
            if len(lines) > 5 and not re.search(r"\b(we|our|this chapter|in this section|figure|table)\b", text, re.IGNORECASE):
                return "index", False

        # 5. Glossary (Strict Standalone Header ONLY)
        glossary_header_matched = False
        for l_upper in top_3_upper:
            if l_upper in ("GLOSSARY", "GLOSSARY OF TERMS") or re.match(r"^GLOSSARY(?:\s+OF\s+TERMS)?$", l_upper):
                glossary_header_matched = True
                break

        if glossary_header_matched:
            return "glossary", True

        # 6. References / Bibliography (Strict Standalone Header ONLY)
        for l_upper in top_3_upper:
            if l_upper in ("REFERENCES", "BIBLIOGRAPHY", "WORKS CITED") or re.match(r"^(?:REFERENCES|BIBLIOGRAPHY)$", l_upper):
                if "BIBLIOGRAPHY" in l_upper:
                    return "bibliography", False
                return "references", False

        # DEFAULT: Conservative -> Content, Retrieval Eligible
        return "content", True


class StructureAwareChunker:
    """Structure-aware chunker with minimum chunk size optimization."""

    def __init__(
        self,
        target_tokens: int = 650,
        min_tokens: int = 100,
        max_tokens: int = 1050,
        overlap_tokens: int = 120,
    ):
        """
        Initialize StructureAwareChunker.

        :param target_tokens: Target tokens per chunk (~650 tokens ≈ 2,600 chars).
        :param min_tokens: Minimum tokens for normal chunks (~100 tokens ≈ 400 chars).
        :param max_tokens: Maximum tokens for a chunk (~1050 tokens ≈ 4,200 chars).
        :param overlap_tokens: Overlap tokens between consecutive chunks (~120 tokens ≈ 480 chars).
        """
        self.target_tokens = target_tokens
        self.min_tokens = min_tokens
        self.max_tokens = max_tokens
        self.overlap_tokens = overlap_tokens

        self.chapter_regex = re.compile(
            r"^(?:CHAPTER|Chapter)\s+(\d+|[IVXLCDM]+)[:.\s\n]+([^\n]+)", re.MULTILINE
        )
        self.section_regex = re.compile(
            r"^(\d+\.\d+(?:\.\d+)?)\s+([A-Z0-9\s\-_:]{3,60})$", re.MULTILINE
        )

    def estimate_tokens(self, text: str) -> int:
        """Estimate token count from character length (~4 characters per token)."""
        if not text:
            return 0
        return max(1, int(len(text) / 4.0))

    def detect_headers(self, text: str) -> Tuple[Optional[str], Optional[str]]:
        """Detect chapter and section titles in text."""
        ch_match = self.chapter_regex.search(text)
        sec_match = self.section_regex.search(text)

        chapter = None
        section = None

        if ch_match:
            ch_num = ch_match.group(1).strip()
            ch_title = ch_match.group(2).strip()
            chapter = f"Chapter {ch_num}: {ch_title}"

        if sec_match:
            sec_num = sec_match.group(1).strip()
            sec_title = sec_match.group(2).strip()
            section = f"{sec_num} {sec_title}"

        return chapter, section

    def build_structural_units(
        self, records: List[Dict[str, Any]]
    ) -> List[StructuralUnit]:
        """
        Parse document records into structural units with conservative content classification.

        :param records: List of page records for a single PDF.
        :return: List of StructuralUnit objects.
        """
        units: List[StructuralUnit] = []
        current_chapter: Optional[str] = None
        current_section: Optional[str] = None

        for rec in records:
            meta = rec["metadata"]
            page_num = meta["page"]
            source = meta["source"]
            text = rec["text"]
            has_text = meta.get("has_meaningful_text", False)
            doc_type = meta.get("document_type", "text")

            content_type, retrieval_eligible = ContentClassifier.classify_page(
                text=text,
                filename=source,
                page_num=page_num,
                has_meaningful_text=has_text,
                doc_type=doc_type,
            )

            if not text and content_type == "low_value":
                continue

            page_ch, page_sec = self.detect_headers(text)
            if page_ch:
                current_chapter = page_ch
            if page_sec:
                current_section = page_sec

            paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
            if not paragraphs and text.strip():
                paragraphs = [text.strip()]

            for para in paragraphs:
                para_ch, para_sec = self.detect_headers(para)
                unit_ch = para_ch or current_chapter
                unit_sec = para_sec or current_section

                units.append(
                    StructuralUnit(
                        text=para,
                        page_number=page_num,
                        source=source,
                        content_type=content_type,
                        retrieval_eligible=retrieval_eligible,
                        chapter=unit_ch,
                        section=unit_sec,
                    )
                )

        return units

    def chunk_units(self, units: List[StructuralUnit]) -> List[Dict[str, Any]]:
        """
        Assemble structural units into chunks, merging small units to satisfy minimum size targets.

        :param units: List of StructuralUnit objects for a PDF.
        :return: List of chunk dictionaries.
        """
        if not units:
            return []

        chunks: List[Dict[str, Any]] = []
        source = units[0].source
        source_slug = re.sub(r"[^a-zA-Z0-9]", "_", os.path.splitext(source)[0]).lower().strip("_")

        # Group contiguous units that share the same content_type
        grouped_unit_batches: List[List[StructuralUnit]] = []
        current_batch: List[StructuralUnit] = []

        for unit in units:
            if not current_batch:
                current_batch.append(unit)
            elif current_batch[0].content_type == unit.content_type:
                current_batch.append(unit)
            else:
                grouped_unit_batches.append(current_batch)
                current_batch = [unit]

        if current_batch:
            grouped_unit_batches.append(current_batch)

        seq_num = 1

        for batch in grouped_unit_batches:
            batch_content_type = batch[0].content_type
            batch_retrieval_eligible = batch[0].retrieval_eligible

            i = 0
            n = len(batch)

            while i < n:
                accumulated_units: List[StructuralUnit] = []
                accumulated_tokens = 0
                start_page = batch[i].page_number
                end_page = batch[i].page_number
                current_ch = batch[i].chapter
                current_sec = batch[i].section

                j = i
                while j < n:
                    unit = batch[j]
                    unit_tokens = self.estimate_tokens(unit.text)

                    # Sub-split oversized single unit
                    if unit_tokens > self.max_tokens and not accumulated_units:
                        sentences = re.split(r"(?<=[.!?])\s+", unit.text)
                        sent_buffer: List[str] = []
                        sent_tokens = 0
                        for sent in sentences:
                            st = self.estimate_tokens(sent)
                            if sent_tokens + st > self.target_tokens and sent_buffer:
                                sub_text = " ".join(sent_buffer).strip()
                                chunk_id = f"{source_slug}_p{start_page:03d}_{seq_num:04d}"
                                meta = {
                                    "source": source,
                                    "start_page": unit.page_number,
                                    "end_page": unit.page_number,
                                    "document_type": "text",
                                    "content_type": batch_content_type,
                                    "retrieval_eligible": batch_retrieval_eligible,
                                }
                                if unit.chapter:
                                    meta["chapter"] = unit.chapter
                                if unit.section:
                                    meta["section"] = unit.section

                                chunks.append({"chunk_id": chunk_id, "text": sub_text, "metadata": meta})
                                seq_num += 1
                                sent_buffer = []
                                sent_tokens = 0

                            sent_buffer.append(sent)
                            sent_tokens += st

                        if sent_buffer:
                            sub_text = " ".join(sent_buffer).strip()
                            chunk_id = f"{source_slug}_p{start_page:03d}_{seq_num:04d}"
                            meta = {
                                "source": source,
                                "start_page": unit.page_number,
                                "end_page": unit.page_number,
                                "document_type": "text",
                                "content_type": batch_content_type,
                                "retrieval_eligible": batch_retrieval_eligible,
                            }
                            if unit.chapter:
                                meta["chapter"] = unit.chapter
                            if unit.section:
                                meta["section"] = unit.section

                            chunks.append({"chunk_id": chunk_id, "text": sub_text, "metadata": meta})
                            seq_num += 1

                        j += 1
                        i = j
                        break

                    # Stop accumulating if adding unit exceeds max_tokens and we already have minimum tokens
                    if accumulated_tokens + unit_tokens > self.max_tokens and accumulated_tokens >= self.min_tokens:
                        break

                    accumulated_units.append(unit)
                    accumulated_tokens += unit_tokens
                    end_page = unit.page_number

                    if not current_ch and unit.chapter:
                        current_ch = unit.chapter
                    if not current_sec and unit.section:
                        current_sec = unit.section

                    j += 1

                    if accumulated_tokens >= self.target_tokens:
                        break

                if not accumulated_units:
                    if j == i:
                        i += 1
                    continue

                # If accumulated chunk is below min_tokens and there are more units in the batch, attempt to merge forward
                if accumulated_tokens < self.min_tokens and j < n:
                    next_unit = batch[j]
                    next_tokens = self.estimate_tokens(next_unit.text)
                    if accumulated_tokens + next_tokens <= self.max_tokens:
                        accumulated_units.append(next_unit)
                        accumulated_tokens += next_tokens
                        end_page = next_unit.page_number
                        j += 1

                chunk_text = "\n\n".join([u.text for u in accumulated_units]).strip()
                chunk_id = f"{source_slug}_p{start_page:03d}_{seq_num:04d}"

                metadata: Dict[str, Any] = {
                    "source": source,
                    "start_page": start_page,
                    "end_page": end_page,
                    "document_type": "text",
                    "content_type": batch_content_type,
                    "retrieval_eligible": batch_retrieval_eligible,
                }
                if current_ch:
                    metadata["chapter"] = current_ch
                if current_sec:
                    metadata["section"] = current_sec

                chunks.append({"chunk_id": chunk_id, "text": chunk_text, "metadata": metadata})
                seq_num += 1

                # Calculate overlap for next chunk
                overlap_accum = 0
                step_back = 0
                while j - 1 - step_back > i:
                    u = batch[j - 1 - step_back]
                    ut = self.estimate_tokens(u.text)
                    if overlap_accum + ut > self.overlap_tokens:
                        break
                    overlap_accum += ut
                    step_back += 1

                i = max(i + 1, j - step_back)

        return chunks


def validate_chunks(chunks: List[Dict[str, Any]]) -> None:
    """
    Perform 4 mandatory automated quality tests and sanity checks.

    :param chunks: List of chunk dictionary objects.
    :raises ValueError: If validation fails.
    """
    seen_ids: Set[str] = set()
    valid_content_types = {
        "content",
        "table_of_contents",
        "index",
        "references",
        "bibliography",
        "glossary",
        "low_value",
    }

    test1_passed = False
    test2_passed = False
    test3_passed = False
    test4_passed = False

    for idx, chunk in enumerate(chunks, 1):
        text = chunk.get("text", "")
        if not text or not text.strip():
            raise ValueError(f"Chunk #{idx} ({chunk.get('chunk_id')}): Empty text is not allowed.")

        chunk_id = chunk.get("chunk_id")
        if not chunk_id:
            raise ValueError(f"Chunk #{idx}: Missing 'chunk_id'.")
        if chunk_id in seen_ids:
            raise ValueError(f"Chunk #{idx}: Duplicate chunk_id '{chunk_id}'.")
        seen_ids.add(chunk_id)

        meta = chunk.get("metadata", {})
        source = meta.get("source")
        if not source:
            raise ValueError(f"Chunk #{idx} ({chunk_id}): Missing 'source' in metadata.")

        start_page = meta.get("start_page")
        end_page = meta.get("end_page")
        if not isinstance(start_page, int) or not isinstance(end_page, int):
            raise ValueError(f"Chunk #{idx} ({chunk_id}): Invalid start_page or end_page.")
        if start_page > end_page:
            raise ValueError(f"Chunk #{idx} ({chunk_id}): Invalid page range: start_page ({start_page}) > end_page ({end_page}).")

        content_type = meta.get("content_type")
        retrieval_eligible = meta.get("retrieval_eligible")

        if content_type not in valid_content_types:
            raise ValueError(f"Chunk #{idx} ({chunk_id}): Invalid content_type '{content_type}'.")
        if not isinstance(retrieval_eligible, bool):
            raise ValueError(f"Chunk #{idx} ({chunk_id}): retrieval_eligible must be boolean.")

        # TEST 1: CN2MOD.pdf page 2 -> table_of_contents, retrieval_eligible=False
        if source == "CN2MOD.pdf" and start_page <= 2 <= end_page:
            if content_type == "table_of_contents" and retrieval_eligible is False:
                test1_passed = True

        # TEST 2: network.pdf page 916 -> index, retrieval_eligible=False
        if source == "network.pdf" and start_page <= 916 <= end_page:
            if content_type == "index" and retrieval_eligible is False:
                test2_passed = True

        # TEST 3: Forouzan page 233 containing 'step-index' -> content, retrieval_eligible=True
        if source == "Data-Communications-and-Networking-5th-Ed-By-Behrouz-A.Forouzan.pdf" and start_page <= 233 <= end_page:
            if "step-index" in text.lower() or start_page == 233:
                if content_type == "content" and retrieval_eligible is True:
                    test3_passed = True

        # TEST 4: Forouzan page 169 containing 'digital-to-digital' -> content, retrieval_eligible=True
        if source == "Data-Communications-and-Networking-5th-Ed-By-Behrouz-A.Forouzan.pdf" and start_page <= 169 <= end_page:
            if "digital-to-digital" in text.lower() or start_page == 169:
                if content_type == "content" and retrieval_eligible is True:
                    test4_passed = True

    if not test1_passed:
        raise ValueError("TEST 1 FAILED: CN2MOD.pdf page 2 was not classified as table_of_contents with retrieval_eligible=False.")

    if not test2_passed:
        raise ValueError("TEST 2 FAILED: network.pdf page 916 was not classified as index with retrieval_eligible=False.")

    if not test3_passed:
        raise ValueError("TEST 3 FAILED: Forouzan page 233 (step-index) was not classified as content with retrieval_eligible=True.")

    if not test4_passed:
        raise ValueError("TEST 4 FAILED: Forouzan page 169 (Digital-to-digital) was not classified as content with retrieval_eligible=True.")


def run_chunking_pipeline() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    input_file = Path("processed/documents.jsonl")
    output_dir = Path("processed")
    output_file = output_dir / "chunks.jsonl"

    if not input_file.exists():
        print(f"Error: Input file '{input_file}' does not exist. Run 'python -m src.build_documents' first.", file=sys.stderr)
        sys.exit(1)

    print("=" * 50)
    print("COMPUTER NETWORKS STRUCTURE-AWARE CHUNKING & CLASSIFICATION")
    print("=" * 50)
    print()

    with open(input_file, "r", encoding="utf-8") as f:
        records = [json.loads(line) for line in f]

    total_input_pages = len(records)
    scanned_pages_skipped = sum(1 for r in records if r["metadata"].get("document_type") == "scanned")
    low_text_pages_count = sum(
        1 for r in records
        if not r["metadata"].get("has_meaningful_text", False) and r["metadata"].get("document_type") != "scanned"
    )

    by_source: Dict[str, List[Dict[str, Any]]] = {}
    for r in records:
        src = r["metadata"]["source"]
        by_source.setdefault(src, []).append(r)

    chunker = StructureAwareChunker()
    all_chunks: List[Dict[str, Any]] = []
    chunks_per_source: Dict[str, int] = {}

    for src, src_records in sorted(by_source.items()):
        units = chunker.build_structural_units(src_records)
        src_chunks = chunker.chunk_units(units)
        all_chunks.extend(src_chunks)
        chunks_per_source[src] = len(src_chunks)

    # Perform Quality & Classification Sanity Validation
    validate_chunks(all_chunks)

    # Write output to processed/chunks.jsonl
    output_dir.mkdir(parents=True, exist_ok=True)
    with open(output_file, "w", encoding="utf-8") as f:
        for chunk in all_chunks:
            f.write(json.dumps(chunk, ensure_ascii=False) + "\n")

    # Calculate statistics
    total_chunks = len(all_chunks)
    content_chunks = sum(1 for c in all_chunks if c["metadata"]["content_type"] == "content")
    toc_chunks = sum(1 for c in all_chunks if c["metadata"]["content_type"] == "table_of_contents")
    index_chunks = sum(1 for c in all_chunks if c["metadata"]["content_type"] == "index")
    ref_chunks = sum(1 for c in all_chunks if c["metadata"]["content_type"] == "references")
    bib_chunks = sum(1 for c in all_chunks if c["metadata"]["content_type"] == "bibliography")
    glossary_chunks = sum(1 for c in all_chunks if c["metadata"]["content_type"] == "glossary")
    low_val_chunks = sum(1 for c in all_chunks if c["metadata"]["content_type"] == "low_value")

    eligible_chunks = sum(1 for c in all_chunks if c["metadata"]["retrieval_eligible"])
    non_eligible_chunks = sum(1 for c in all_chunks if not c["metadata"]["retrieval_eligible"])

    char_sizes = [len(c["text"]) for c in all_chunks]
    token_sizes = [chunker.estimate_tokens(c["text"]) for c in all_chunks]

    avg_chars = int(sum(char_sizes) / max(total_chunks, 1))
    avg_tokens = int(sum(token_sizes) / max(total_chunks, 1))
    min_tokens = min(token_sizes) if token_sizes else 0
    max_tokens = max(token_sizes) if token_sizes else 0

    chunks_under_100 = sum(1 for t in token_sizes if t < 100)
    chunks_under_50 = sum(1 for t in token_sizes if t < 50)
    chunks_under_20 = sum(1 for t in token_sizes if t < 20)

    # Print 5 Representative Examples
    print("=" * 50)
    print("REPRESENTATIVE CLASSIFIED CHUNK EXAMPLES (5 SAMPLES)")
    print("=" * 50)

    # Select specific representative samples
    content_sample = next(c for c in all_chunks if c["metadata"]["content_type"] == "content")
    toc_sample = next(c for c in all_chunks if c["metadata"]["content_type"] == "table_of_contents")
    index_sample = next(c for c in all_chunks if c["metadata"]["content_type"] == "index")
    glossary_sample = next(
        (c for c in all_chunks if c["metadata"]["content_type"] == "glossary"),
        next(c for c in all_chunks if c["metadata"]["content_type"] == "references")
    )
    # Find a short chunk near minimum size threshold (~100 tokens)
    short_chunk_sample = min(all_chunks, key=lambda c: abs(chunker.estimate_tokens(c["text"]) - 100))

    sample_chunks = [content_sample, toc_sample, index_sample, glossary_sample, short_chunk_sample]

    for sample in sample_chunks:
        meta = sample["metadata"]
        page_str = (
            f"Page {meta['start_page']}"
            if meta["start_page"] == meta["end_page"]
            else f"Pages {meta['start_page']} - {meta['end_page']}"
        )
        approx_tokens = chunker.estimate_tokens(sample["text"])

        print("-" * 50)
        print(f"Source             : {meta['source']}")
        print(f"Pages              : {page_str}")
        print(f"Content Type       : {meta['content_type']}")
        print(f"Retrieval Eligible : {meta['retrieval_eligible']}")
        print(f"Approximate Size   : ~{approx_tokens} tokens ({len(sample['text']):,} chars)")
        if meta.get("chapter"):
            print(f"Chapter            : {meta['chapter']}")
        if meta.get("section"):
            print(f"Section            : {meta['section']}")
        print("-" * 50)
        print("TEXT PREVIEW:")
        preview_text = sample["text"][:300] + ("..." if len(sample["text"]) > 300 else "")
        safe_preview = preview_text.encode(sys.stdout.encoding or "utf-8", errors="replace").decode(sys.stdout.encoding or "utf-8")
        print(safe_preview)
        print()

    # Print Final Summary Statistics
    print("=" * 50)
    print("CHUNKING & CONSERVATIVE CLASSIFICATION FINAL STATISTICS")
    print("=" * 50)
    print(f"Total Input Pages          : {total_input_pages:,}")
    print(f"Scanned Pages Skipped      : {scanned_pages_skipped:,}")
    print(f"Low/No-Text Pages Tracked  : {low_text_pages_count:,}")
    print("-" * 50)
    print(f"Total Chunks Generated     : {total_chunks:,}")
    print(f"  - Content Chunks         : {content_chunks:,}")
    print(f"  - Table of Contents      : {toc_chunks:,}")
    print(f"  - Index Chunks           : {index_chunks:,}")
    print(f"  - Reference Chunks       : {ref_chunks:,}")
    print(f"  - Bibliography Chunks    : {bib_chunks:,}")
    print(f"  - Glossary Chunks        : {glossary_chunks:,}")
    print(f"  - Low-Value Chunks       : {low_val_chunks:,}")
    print("-" * 50)
    print(f"Retrieval Eligible Chunks  : {eligible_chunks:,}  (Included in RAG database)")
    print(f"Non-Retrieval Eligible     : {non_eligible_chunks:,}  (Preserved, excluded from vector embedding)")
    print("-" * 50)
    print(f"Average Chunk Size         : ~{avg_tokens} tokens ({avg_chars:,} chars)")
    print(f"Minimum Chunk Size         : ~{min_tokens} tokens")
    print(f"Maximum Chunk Size         : ~{max_tokens} tokens")
    print("-" * 50)
    print(f"Chunks below 100 tokens    : {chunks_under_100:,}")
    print(f"Chunks below 50 tokens     : {chunks_under_50:,}")
    print(f"Chunks below 20 tokens     : {chunks_under_20:,}")
    print("-" * 50)
    print("Chunks Per Source PDF:")
    for src, count in chunks_per_source.items():
        print(f"  - {src}: {count:,} chunks")
    print("-" * 50)
    print(f"Output Saved To            : {output_file.as_posix()}")
    print("Quality Tests (4/4)        : ALL PASSED (0 Errors)")
    print("  ✓ TEST 1: CN2MOD.pdf p. 2 -> table_of_contents (retrieval_eligible=False)")
    print("  ✓ TEST 2: network.pdf p. 916 -> index (retrieval_eligible=False)")
    print("  ✓ TEST 3: Forouzan p. 233 ('step-index fiber') -> content (retrieval_eligible=True)")
    print("  ✓ TEST 4: Forouzan p. 169 ('Digital-to-digital') -> content (retrieval_eligible=True)")
    print("=" * 50)


if __name__ == "__main__":
    run_chunking_pipeline()
