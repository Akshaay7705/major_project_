"""
Executable script for inspecting Computer Networks PDFs in data/ directory.

Usage:
    python -m src.inspect_pdfs
"""

import sys
from pathlib import Path
from src.pdf_processor import PDFProcessor


def main() -> None:
    data_directory = "data"
    
    processor = PDFProcessor()

    try:
        reports = processor.inspect_all_pdfs(data_dir=data_directory)
    except Exception as e:
        print(f"Error accessing directory '{data_directory}': {e}", file=sys.stderr)
        sys.exit(1)

    if not reports:
        print(f"No PDF files found in directory '{data_directory}'.")
        return

    print("=" * 50)
    print("COMPUTER NETWORKS PDF INSPECTION")
    print("=" * 50)
    print()

    total_pdfs = len(reports)
    text_based_count = 0
    scanned_count = 0
    unreadable_count = 0
    total_pages_sum = 0
    total_chars_sum = 0

    for report in reports:
        print(f"File: {report.filename}")
        if report.error and report.total_pages == 0:
            print(f"Status: ERROR ({report.error})")
            unreadable_count += 1
            print("-" * 50)
            print()
            continue

        print(f"Pages: {report.total_pages}")
        print(f"Type: {report.pdf_type}")
        print(f"Pages with text: {report.pages_with_text}")
        print(f"Pages with little/no text: {report.pages_without_text}")
        print(f"Total characters: {report.total_characters:,}")

        if report.pdf_type == "Text-based":
            text_based_count += 1
        elif report.pdf_type == "Scanned / Image-based":
            scanned_count += 1
            print("Note: This file contains mostly scanned/image pages with no direct text.")
        else:
            unreadable_count += 1

        total_pages_sum += report.total_pages
        total_chars_sum += report.total_characters
        print("-" * 50)
        print()

    print("=" * 50)
    print("SUMMARY REPORT")
    print("=" * 50)
    print(f"Total PDFs Processed    : {total_pdfs}")
    print(f"Text-based PDFs         : {text_based_count}")
    print(f"Scanned/Image-based PDFs: {scanned_count}")
    if unreadable_count > 0:
        print(f"Unreadable/Error PDFs   : {unreadable_count}")
    print(f"Total Pages Analyzed    : {total_pages_sum:,}")
    print(f"Total Characters        : {total_chars_sum:,}")
    print("=" * 50)


if __name__ == "__main__":
    main()
