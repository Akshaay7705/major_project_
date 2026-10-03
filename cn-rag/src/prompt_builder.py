"""
Prompt Builder module for Computer Networks RAG.

Assembles a structured, LLM-ready prompt from retrieved chunks and a user query,
with support for 6 answer-type templates tailored for exam and study scenarios.

Answer types:
    general  - Comprehensive explanation (default)
    2mark    - Short ~50-word exam answer
    5mark    - Medium ~150-word exam answer
    10mark   - Detailed ~400-word exam answer
    mcq      - 4-option multiple choice question with answer key
    viva     - Concise viva-style bullet Q&A

Usage:
    from src.retriever import Retriever
    from src.prompt_builder import PromptBuilder

    retriever = Retriever(top_k=5)
    results = retriever.retrieve("Explain TCP congestion control")

    builder = PromptBuilder()
    prompt = builder.build(query="Explain TCP congestion control",
                           results=results,
                           answer_type="5mark")
    print(prompt)
"""

from __future__ import annotations

from typing import List, Optional

from src.retriever import RetrievalResult

# ---------------------------------------------------------------------------
# Answer-type instruction templates
# ---------------------------------------------------------------------------

_ANSWER_TYPE_INSTRUCTIONS: dict[str, str] = {
    "general": (
        "Provide a comprehensive, well-structured explanation. "
        "Use clear headings and bullet points where appropriate. "
        "Cite the sources provided above wherever relevant."
    ),
    "2mark": (
        "Write a concise 2-mark exam answer in approximately 50 words. "
        "Be precise and direct. No unnecessary elaboration."
    ),
    "5mark": (
        "Write a 5-mark exam answer in approximately 150 words. "
        "Cover the key concepts clearly with brief examples where relevant. "
        "Use numbered or bulleted points for clarity."
    ),
    "10mark": (
        "Write a detailed 10-mark exam answer in approximately 400 words. "
        "Include: definition, working mechanism, types/categories (if any), "
        "advantages/disadvantages, and a real-world example. "
        "Use clear headings and structured bullet points."
    ),
    "mcq": (
        "Generate a 4-option multiple choice question based on the topic in the query. "
        "Format exactly as:\n"
        "Q: <question>\n"
        "A) <option>\n"
        "B) <option>\n"
        "C) <option>\n"
        "D) <option>\n"
        "Answer: <correct letter>) <correct option>\n"
        "Explanation: <brief explanation>"
    ),
    "viva": (
        "Generate a viva-style Q&A for the topic. "
        "Format as a numbered list of 5 expected viva questions, each followed by a concise answer. "
        "Keep each answer under 3 sentences. Focus on conceptual understanding."
    ),
}

VALID_ANSWER_TYPES = list(_ANSWER_TYPE_INSTRUCTIONS.keys())

# ---------------------------------------------------------------------------
# System role
# ---------------------------------------------------------------------------

_SYSTEM_ROLE = (
    "You are an expert Computer Networks tutor with deep knowledge of networking "
    "protocols, architectures, and concepts. You answer questions strictly based on "
    "the provided context passages. If the context does not contain enough information "
    "to answer the question fully, state what is available and note the limitation. "
    "Always maintain academic accuracy and cite sources when possible."
)


# ---------------------------------------------------------------------------
# PromptBuilder
# ---------------------------------------------------------------------------


class PromptBuilder:
    """
    Assembles a structured LLM prompt from retrieved chunks and a user query.

    :param max_context_chars: Maximum total characters to include from context
                               passages (default 8,000 ~= ~2,000 tokens).
    """

    def __init__(self, max_context_chars: int = 8_000) -> None:
        self.max_context_chars = max_context_chars

    def build(
        self,
        query: str,
        results: List[RetrievalResult],
        answer_type: str = "general",
    ) -> str:
        """
        Build a complete LLM prompt from query and retrieved results.

        :param query: The original user question.
        :param results: Ranked RetrievalResult list from Retriever.retrieve().
        :param answer_type: One of: general, 2mark, 5mark, 10mark, mcq, viva.
        :return: Fully assembled prompt string.
        :raises ValueError: If answer_type is not recognized.
        """
        answer_type = answer_type.lower().strip()
        if answer_type not in _ANSWER_TYPE_INSTRUCTIONS:
            raise ValueError(
                f"Unknown answer_type '{answer_type}'. "
                f"Valid options: {VALID_ANSWER_TYPES}"
            )

        context_block = self._build_context_block(results)
        instruction = _ANSWER_TYPE_INSTRUCTIONS[answer_type]
        answer_label = self._answer_type_label(answer_type)

        prompt = (
            f"### SYSTEM\n"
            f"{_SYSTEM_ROLE}\n\n"
            f"{'=' * 60}\n"
            f"### CONTEXT — Retrieved Passages\n"
            f"{'=' * 60}\n"
            f"{context_block}\n"
            f"{'=' * 60}\n"
            f"### QUESTION\n"
            f"{query.strip()}\n\n"
            f"### INSTRUCTION\n"
            f"Answer type: **{answer_label}**\n"
            f"{instruction}\n"
            f"{'=' * 60}\n"
            f"### ANSWER\n"
        )
        return prompt

    def build_no_context(self, query: str, answer_type: str = "general") -> str:
        """
        Build a fallback prompt when no retrieval results are available.

        :param query: The original user question.
        :param answer_type: One of the valid answer types.
        :return: Fallback prompt string.
        """
        answer_type = answer_type.lower().strip()
        if answer_type not in _ANSWER_TYPE_INSTRUCTIONS:
            raise ValueError(
                f"Unknown answer_type '{answer_type}'. "
                f"Valid options: {VALID_ANSWER_TYPES}"
            )
        instruction = _ANSWER_TYPE_INSTRUCTIONS[answer_type]
        answer_label = self._answer_type_label(answer_type)

        prompt = (
            f"### SYSTEM\n"
            f"{_SYSTEM_ROLE}\n\n"
            f"{'=' * 60}\n"
            f"### CONTEXT\n"
            f"No relevant passages were retrieved from the knowledge base for this query.\n"
            f"Answer using your general knowledge of Computer Networks.\n"
            f"{'=' * 60}\n"
            f"### QUESTION\n"
            f"{query.strip()}\n\n"
            f"### INSTRUCTION\n"
            f"Answer type: **{answer_label}**\n"
            f"{instruction}\n"
            f"{'=' * 60}\n"
            f"### ANSWER\n"
        )
        return prompt

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _build_context_block(self, results: List[RetrievalResult]) -> str:
        """
        Assemble a formatted context block from results, respecting char limit.

        :param results: Ranked retrieval results.
        :return: Formatted multi-source context string.
        """
        if not results:
            return "(No context passages retrieved.)\n"

        sections: List[str] = []
        total_chars = 0

        for r in results:
            header = f"--- Source {r.rank}: {r.source} ({r.page_ref()}) | similarity: {r.similarity:.4f} ---"
            body = r.text.strip()

            # Truncate body if adding it would exceed the limit
            remaining = self.max_context_chars - total_chars - len(header) - 4
            if remaining <= 0:
                break
            if len(body) > remaining:
                body = body[:remaining] + "…"

            section = f"{header}\n{body}\n"
            sections.append(section)
            total_chars += len(section)

            if total_chars >= self.max_context_chars:
                break

        return "\n".join(sections)

    @staticmethod
    def _answer_type_label(answer_type: str) -> str:
        """Return a human-readable label for the answer type."""
        labels = {
            "general": "Comprehensive Explanation",
            "2mark": "2-Mark Exam Answer",
            "5mark": "5-Mark Exam Answer",
            "10mark": "10-Mark Exam Answer",
            "mcq": "Multiple Choice Question",
            "viva": "Viva Q&A",
        }
        return labels.get(answer_type, answer_type)
