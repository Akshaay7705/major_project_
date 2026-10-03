"""
Build Documents script for Computer Networks RAG.

Extracts, cleans, validates, and outputs page-level JSONL records into processed/documents.jsonl.

Usage:
    python -m src.build_documents
"""

import json
import os
from pathlib import Path
import sys
from typing import List, Dict, Any, Set, Tuple

from src.pdf_processor import PDFProcessor


def validate_document_record(
    record: Dict[str, Any], seen_pages: Set[Tuple[str, int]], line_number: int
) -> None:
    """
    Validate an individual page document record according to pipeline rules.

    :param record: Dictionary representation of a document record.
    :param seen_pages: Set tracking (source, page) pairs to catch duplicates.
    :param line_number: 1-based index of record for error reporting.
    :raises ValueError: If validation fails.
    """
    if "text" not in record or "metadata" not in record:
        raise ValueError(f"Record {line_number}: Missing 'text' or 'metadata' key.")

    metadata = record["metadata"]
    source = metadata.get("source")
    page = metadata.get("page")
    has_meaningful_text = metadata.get("has_meaningful_text")
    document_type = metadata.get("document_type")

    if not source or not isinstance(source, str):
        raise ValueError(f"Record {line_number}: Invalid or missing 'source' filename.")

    if not isinstance(page, int) or page <= 0:
        raise ValueError(f"Record {line_number}: Invalid or missing 'page' number: {page}.")

    page_key = (source, page)
    if page_key in seen_pages:
        raise ValueError(f"Record {line_number}: Duplicate page entry for source '{source}' page {page}.")
    seen_pages.add(page_key)

    text = record["text"]
    if text == "" and has_meaningful_text is True:
        raise ValueError(f"Record {line_number} ({source} p.{page}): Empty text is not allowed when has_meaningful_text=True.")

    if document_type not in ("text", "scanned"):
        raise ValueError(f"Record {line_number} ({source} p.{page}): Invalid document_type '{document_type}'.")


def main() -> None:
    data_dir = "data"
    output_dir = Path("processed")
    output_file = output_dir / "documents.jsonl"

    output_dir.mkdir(parents=True, exist_ok=True)

    processor = PDFProcessor()

    data_path = Path(data_dir)
    if not data_path.exists() or not data_path.is_dir():
        print(f"Error: Data directory '{data_dir}' does not exist.", file=sys.stderr)
        sys.exit(1)

    pdf_files = sorted([str(p) for p in data_path.iterdir() if p.suffix.lower() == ".pdf"])
    if not pdf_files:
        print(f"No PDF files found in directory '{data_dir}'.")
        return

    print("=" * 50)
    print("COMPUTER NETWORKS DOCUMENT BUILD")
    print("=" * 50)
    print()

    all_records: List[Dict[str, Any]] = []
    seen_pages: Set[Tuple[str, int]] = set()

    total_pdfs = len(pdf_files)
    total_pages_sum = 0
    meaningful_pages_sum = 0
    low_text_pages_sum = 0
    ocr_required_pages_sum = 0
    total_characters_sum = 0

    for pdf_path in pdf_files:
        filename = os.path.basename(pdf_path)
        report = processor.process_pdf(pdf_path)
        page_docs = processor.extract_page_documents(pdf_path)

        meaningful_count = report.pages_with_text
        low_text_count = report.pages_without_text
        is_scanned = (report.pdf_type == "Scanned / Image-based")

        print(f"File: {filename}")
        print(f"Pages processed: {report.total_pages}")
        if is_scanned:
            print(f"Meaningful text pages: 0")
            print(f"OCR required: YES")
            ocr_required_pages_sum += report.total_pages
        else:
            print(f"Meaningful text pages: {meaningful_count}")
            print(f"Low/no text pages: {low_text_count}")
            meaningful_pages_sum += meaningful_count
            low_text_pages_sum += low_text_count

        total_pages_sum += report.total_pages
        total_characters_sum += report.total_characters

        # Validate records
        for doc_record in page_docs:
            record_idx = len(all_records) + 1
            validate_document_record(doc_record, seen_pages, record_idx)
            all_records.append(doc_record)

        print("-" * 50)
        print()

    # Write validated records to processed/documents.jsonl with UTF-8 encoding
    try:
        with open(output_file, "w", encoding="utf-8") as f:
            for record in all_records:
                json_line = json.dumps(record, ensure_ascii=False)
                f.write(json_line + "\n")
    except Exception as err:
        print(f"Failed to write documents to '{output_file}': {err}", file=sys.stderr)
        sys.exit(1)

    print("=" * 50)
    print("FINAL SUMMARY")
    print("=" * 50)
    print(f"Total PDFs                 : {total_pdfs}")
    print(f"Total pages                : {total_pages_sum:,}")
    print(f"Pages with meaningful text : {meaningful_pages_sum:,}")
    print(f"Pages with little/no text  : {low_text_pages_sum:,}")
    print(f"Pages requiring OCR        : {ocr_required_pages_sum:,}")
    print(f"Total characters           : {total_characters_sum:,}")
    print(f"Output file                : {output_file.as_posix()}")
    print("=" * 50)


if __name__ == "__main__":
    main()
