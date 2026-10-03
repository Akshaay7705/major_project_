"""
Text Cleaner module for Computer Networks RAG.

Provides utilities for cleaning raw text extracted from technical PDFs
while preserving structural elements such as headings, lists, bullet points,
equations, and domain-specific technical terminology.
"""

import re


class TextCleaner:
    """Cleaner for extracted text from technical PDF documents."""

    def __init__(self, min_char_threshold: int = 50):
        """
        Initialize TextCleaner.

        :param min_char_threshold: Minimum characters on a page to count as meaningful text.
        """
        self.min_char_threshold = min_char_threshold

    def clean_text(self, text: str) -> str:
        """
        Clean raw text extracted from PDF page while preserving formatting, headings,
        bullet points, list items, and equations.

        :param text: Raw extracted string from PyMuPDF.
        :return: Cleaned string.
        """
        if not text:
            return ""

        # 1. Remove null bytes and non-printable control characters (except \n, \t, \r)
        cleaned = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", text)

        # 2. Normalize line endings (\r\n -> \n, \r -> \n)
        cleaned = cleaned.replace("\r\n", "\n").replace("\r", "\n")

        # 3. Strip trailing spaces/tabs on each line while preserving leading indent/bullet indentation
        lines = [line.rstrip() for line in cleaned.split("\n")]
        cleaned = "\n".join(lines)

        # 4. Collapse multiple spaces and horizontal tabs within lines (without stripping newlines)
        # Replaces multiple horizontal spaces/tabs with a single space, but avoids removing indentation completely if needed
        lines = [re.sub(r"[ \t]+", " ", line) for line in cleaned.split("\n")]
        cleaned = "\n".join(lines)

        # 5. Normalize repeated blank lines: collapse 3+ newlines into max 2 newlines (one blank line between paragraphs)
        cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)

        # 6. Final strip of leading/trailing whitespace around the entire page string
        cleaned = cleaned.strip()

        return cleaned

    def is_meaningful_text(self, text: str, min_chars: int = 50) -> bool:
        """
        Determine whether extracted cleaned text contains meaningful content.

        :param text: Cleaned text string.
        :param min_chars: Character threshold (default: 50).
        :return: True if character count excluding whitespace >= min_chars, False otherwise.
        """
        if not text:
            return False
        # Count non-whitespace characters
        non_ws_count = len(re.sub(r"\s+", "", text))
        return non_ws_count >= min_chars
