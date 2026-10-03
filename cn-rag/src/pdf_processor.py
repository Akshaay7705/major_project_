"""
PDF Processor module using PyMuPDF (fitz) for Computer Networks RAG.

Provides functionality for inspecting, parsing, cleaning, and extracting metadata
from PDF documents in a safe, structured, and modular manner.
"""

from dataclasses import dataclass, field
import os
from pathlib import Path
from typing import List, Optional, Dict, Any
import fitz  # PyMuPDF

from src.text_cleaner import TextCleaner


@dataclass
class PageMetadata:
    """Metadata and extracted content for an individual PDF page."""
    source_filename: str
    page_number: int  # 1-based page index
    extracted_text: str
    char_count: int
    has_meaningful_text: bool
    error: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        """Convert page metadata to dictionary representation."""
        return {
            "source_filename": self.source_filename,
            "page_number": self.page_number,
            "extracted_text": self.extracted_text,
            "char_count": self.char_count,
            "has_meaningful_text": self.has_meaningful_text,
            "error": self.error,
        }


@dataclass
class PDFInspectionReport:
    """Aggregated inspection report for a single PDF document."""
    file_path: str
    filename: str
    total_pages: int
    pdf_type: str  # "Text-based" or "Scanned / Image-based"
    pages_with_text: int
    pages_without_text: int
    total_characters: int
    pages: List[PageMetadata] = field(default_factory=list)
    error: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        """Convert inspection report to dictionary representation."""
        return {
            "file_path": self.file_path,
            "filename": self.filename,
            "total_pages": self.total_pages,
            "pdf_type": self.pdf_type,
            "pages_with_text": self.pages_with_text,
            "pages_without_text": self.pages_without_text,
            "total_characters": self.total_characters,
            "pages": [p.to_dict() for p in self.pages],
            "error": self.error,
        }


class PDFProcessor:
    """PDF processing, text extraction, and inspection engine."""

    def __init__(
        self,
        min_char_threshold: int = 50,
        text_page_ratio_threshold: float = 0.3,
        cleaner: Optional[TextCleaner] = None,
    ):
        """
        Initialize PDFProcessor.

        :param min_char_threshold: Minimum characters on a page to consider as meaningful text.
        :param text_page_ratio_threshold: Fraction of pages with meaningful text required for Text-based classification.
        :param cleaner: TextCleaner instance (optional).
        """
        self.min_char_threshold = min_char_threshold
        self.text_page_ratio_threshold = text_page_ratio_threshold
        self.cleaner = cleaner or TextCleaner(min_char_threshold=min_char_threshold)

    def process_pdf(self, file_path: str) -> PDFInspectionReport:
        """
        Safely open and inspect a single PDF file, extracting page-level metadata.

        :param file_path: Path to the PDF file.
        :return: PDFInspectionReport containing document summary and page metadata.
        """
        filename = os.path.basename(file_path)
        pages_metadata: List[PageMetadata] = []

        try:
            doc = fitz.open(file_path)
        except Exception as e:
            return PDFInspectionReport(
                file_path=file_path,
                filename=filename,
                total_pages=0,
                pdf_type="Unreadable / Corrupted",
                pages_with_text=0,
                pages_without_text=0,
                total_characters=0,
                pages=[],
                error=f"Failed to open PDF: {str(e)}",
            )

        try:
            total_pages = len(doc)
            pages_with_text = 0
            pages_without_text = 0
            total_characters = 0

            for page_index in range(total_pages):
                page_number = page_index + 1  # 1-based page number
                try:
                    page = doc.load_page(page_index)
                    raw_text = page.get_text("text")
                    cleaned_text = self.cleaner.clean_text(raw_text)
                    char_count = len(cleaned_text)
                    has_meaningful_text = self.cleaner.is_meaningful_text(
                        cleaned_text, min_chars=self.min_char_threshold
                    )

                    if has_meaningful_text:
                        pages_with_text += 1
                    else:
                        pages_without_text += 1

                    total_characters += char_count

                    pages_metadata.append(
                        PageMetadata(
                            source_filename=filename,
                            page_number=page_number,
                            extracted_text=cleaned_text,
                            char_count=char_count,
                            has_meaningful_text=has_meaningful_text,
                        )
                    )
                except Exception as page_err:
                    pages_without_text += 1
                    pages_metadata.append(
                        PageMetadata(
                            source_filename=filename,
                            page_number=page_number,
                            extracted_text="",
                            char_count=0,
                            has_meaningful_text=False,
                            error=f"Failed to extract page {page_number}: {str(page_err)}",
                        )
                    )

            # Determine PDF classification type
            if total_pages == 0:
                pdf_type = "Empty PDF"
            else:
                text_ratio = pages_with_text / total_pages
                if text_ratio >= self.text_page_ratio_threshold:
                    pdf_type = "Text-based"
                else:
                    pdf_type = "Scanned / Image-based"

            return PDFInspectionReport(
                file_path=file_path,
                filename=filename,
                total_pages=total_pages,
                pdf_type=pdf_type,
                pages_with_text=pages_with_text,
                pages_without_text=pages_without_text,
                total_characters=total_characters,
                pages=pages_metadata,
            )

        finally:
            doc.close()

    def extract_page_documents(self, file_path: str) -> List[Dict[str, Any]]:
        """
        Extract page documents formatted as JSON-compatible dicts for documents.jsonl.

        :param file_path: Path to the PDF file.
        :return: List of document dicts with 'text' and 'metadata'.
        """
        report = self.process_pdf(file_path)
        filename = report.filename
        documents: List[Dict[str, Any]] = []

        is_scanned = (report.pdf_type == "Scanned / Image-based")

        for page_meta in report.pages:
            if is_scanned:
                doc_record = {
                    "text": "",
                    "metadata": {
                        "source": filename,
                        "page": page_meta.page_number,
                        "has_meaningful_text": False,
                        "document_type": "scanned",
                        "requires_ocr": True,
                    },
                }
            else:
                doc_record = {
                    "text": page_meta.extracted_text,
                    "metadata": {
                        "source": filename,
                        "page": page_meta.page_number,
                        "has_meaningful_text": page_meta.has_meaningful_text,
                        "document_type": "text",
                    },
                }
            documents.append(doc_record)

        return documents

    def inspect_all_pdfs(self, data_dir: str = "data") -> List[PDFInspectionReport]:
        """
        Scan directory for PDF files automatically and process each one.

        :param data_dir: Path to directory containing PDF files.
        :return: List of PDFInspectionReport objects.
        """
        dir_path = Path(data_dir)
        if not dir_path.exists() or not dir_path.is_dir():
            raise FileNotFoundError(f"Data directory '{data_dir}' does not exist or is not a directory.")

        pdf_files = sorted(
            [str(p) for p in dir_path.iterdir() if p.suffix.lower() == ".pdf"]
        )

        reports: List[PDFInspectionReport] = []
        for pdf_path in pdf_files:
            report = self.process_pdf(pdf_path)
            reports.append(report)

        return reports
