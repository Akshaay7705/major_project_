"""
QA Engine module for Computer Networks RAG.

Ties together Retriever, PromptBuilder, and Gemini LLM into a single
end-to-end question answering pipeline with an interactive CLI.

Non-interactive (single query) usage:
    python -m src.qa_engine --query "What is the OSI model?" --type 5mark

Interactive REPL usage:
    python -m src.qa_engine

Interactive commands:
    /type <2mark|5mark|10mark|mcq|viva|general>  — switch answer type
    /source <filename.pdf>                        — restrict to one source module
    /sources                                      — clear source filter
    /top <N>                                      — set top-k retrieval count
    /help                                         — show this help
    /quit                                         — exit
"""

from __future__ import annotations

import argparse
import sys
import time
from dataclasses import dataclass, field
from typing import List, Optional

from dotenv import load_dotenv

from src.gemini_client import GeminiClient
from src.retriever import Retriever, RetrievalResult
from src.prompt_builder import PromptBuilder, VALID_ANSWER_TYPES

load_dotenv()

# ---------------------------------------------------------------------------
# ANSI colour helpers (gracefully disabled on non-TTY terminals)
# ---------------------------------------------------------------------------

_USE_COLOR = sys.stdout.isatty()


def _c(code: str, text: str) -> str:
    if not _USE_COLOR:
        return text
    return f"\033[{code}m{text}\033[0m"


def bold(t: str) -> str:    return _c("1", t)
def cyan(t: str) -> str:    return _c("36", t)
def green(t: str) -> str:   return _c("32", t)
def yellow(t: str) -> str:  return _c("33", t)
def red(t: str) -> str:     return _c("31", t)
def dim(t: str) -> str:     return _c("2", t)
def magenta(t: str) -> str: return _c("35", t)


# ---------------------------------------------------------------------------
# Data structure
# ---------------------------------------------------------------------------


@dataclass
class QAResult:
    """Complete result from a single QA pipeline run."""

    query: str
    answer: str
    answer_type: str
    sources: List[RetrievalResult]
    llm_model: str
    latency_seconds: float

    def top_citations(self, n: int = 5) -> List[str]:
        """Return top-n formatted citation strings."""
        return [r.citation() for r in self.sources[:n]]


# ---------------------------------------------------------------------------
# QA Engine
# ---------------------------------------------------------------------------


class QAEngine:
    """
    End-to-end question answering pipeline.

    :param top_k: Number of chunks to retrieve per query (default 5).
    :param answer_type: Default answer type (default 'general').
    :param source_filter: Optional filename to restrict retrieval to one module.
    """

    def __init__(
        self,
        top_k: int = 5,
        answer_type: str = "general",
        source_filter: Optional[str] = None,
    ) -> None:
        if answer_type not in VALID_ANSWER_TYPES:
            raise ValueError(
                f"Invalid answer_type '{answer_type}'. Valid: {VALID_ANSWER_TYPES}"
            )
        self.answer_type = answer_type
        self.source_filter = source_filter

        self._retriever = Retriever(top_k=top_k, source_filter=source_filter)
        self._builder = PromptBuilder()
        self._gemini = GeminiClient()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def ask(self, query: str, answer_type: Optional[str] = None) -> QAResult:
        """
        Run the full RAG pipeline for a single query.

        :param query: Natural language question.
        :param answer_type: Override the engine's default answer type for this call.
        :return: QAResult with answer, sources, and metadata.
        """
        if not query or not query.strip():
            raise ValueError("Query must be a non-empty string.")

        atype = (answer_type or self.answer_type).lower().strip()
        if atype not in VALID_ANSWER_TYPES:
            raise ValueError(f"Invalid answer_type '{atype}'. Valid: {VALID_ANSWER_TYPES}")

        t_start = time.perf_counter()

        # Stage 6a: Retrieve relevant chunks
        results = self._retriever.retrieve(query)

        # Stage 6b: Build prompt
        if results:
            prompt = self._builder.build(query=query, results=results, answer_type=atype)
        else:
            prompt = self._builder.build_no_context(query=query, answer_type=atype)

        # Stage 7: Generate answer via Gemini LLM
        answer = self._gemini.generate_answer(prompt)

        latency = round(time.perf_counter() - t_start, 2)

        return QAResult(
            query=query,
            answer=answer,
            answer_type=atype,
            sources=results,
            llm_model=self._gemini.llm_model,
            latency_seconds=latency,
        )

    def set_top_k(self, top_k: int) -> None:
        """Update the retrieval top-k and rebuild the retriever."""
        self._retriever = Retriever(
            top_k=top_k,
            source_filter=self.source_filter,
        )

    def set_source_filter(self, source_filter: Optional[str]) -> None:
        """Update the source filter and rebuild the retriever."""
        self.source_filter = source_filter
        current_top_k = self._retriever.top_k
        self._retriever = Retriever(
            top_k=current_top_k,
            source_filter=source_filter,
        )


# ---------------------------------------------------------------------------
# Output formatting
# ---------------------------------------------------------------------------


def _print_result(result: QAResult) -> None:
    """Print a QAResult with structured, colour-coded terminal output."""
    width = 70

    print()
    print(bold(cyan("=" * width)))
    print(bold(cyan(f"  ANSWER  [{result.answer_type.upper()}]")))
    print(bold(cyan("=" * width)))
    print()
    print(result.answer.strip())
    print()

    if result.sources:
        print(bold(yellow("-" * width)))
        print(bold(yellow("  SOURCES")))
        print(bold(yellow("-" * width)))
        for r in result.sources:
            sim_bar = "█" * int(r.similarity * 10)
            print(
                f"  {green(f'#{r.rank}')}  {bold(r.source)}  "
                f"{dim(r.page_ref())}  "
                f"{magenta(f'[{r.similarity:.4f}]')} {dim(sim_bar)}"
            )
        print()

    print(
        dim(
            f"  model: {result.llm_model}  |  "
            f"latency: {result.latency_seconds}s  |  "
            f"chunks retrieved: {len(result.sources)}"
        )
    )
    print(bold(cyan("=" * width)))
    print()


def _print_help() -> None:
    print()
    print(bold("  Commands:"))
    print(f"  {cyan('/type <type>')}      Switch answer type: {', '.join(VALID_ANSWER_TYPES)}")
    print(f"  {cyan('/source <file>')}    Restrict retrieval to one source PDF")
    print(f"  {cyan('/sources')}          Clear source filter (search all)")
    print(f"  {cyan('/top <N>')}          Set number of chunks to retrieve (default 5)")
    print(f"  {cyan('/help')}             Show this help")
    print(f"  {cyan('/quit')}             Exit")
    print()


def _print_banner(engine: QAEngine) -> None:
    width = 70
    print()
    print(bold(green("=" * width)))
    print(bold(green("  CN-RAG  —  Computer Networks Study Assistant")))
    print(bold(green("=" * width)))
    print(f"  Model      : {bold(engine._gemini.llm_model)}")
    print(f"  Answer type: {bold(engine.answer_type)}")
    print(f"  Top-k      : {bold(str(engine._retriever.top_k))}")
    src = engine.source_filter or dim("all modules")
    print(f"  Source     : {bold(src)}")
    print(f"  Index size : {bold(f'{engine._retriever._collection.count():,}')} chunks")
    print(bold(green("=" * width)))
    print(f"  {dim('Type your question and press Enter. Type /help for commands.')}")
    print()


# ---------------------------------------------------------------------------
# Interactive REPL
# ---------------------------------------------------------------------------


def _run_interactive(engine: QAEngine) -> None:
    _print_banner(engine)

    while True:
        try:
            raw = input(bold(cyan("You > "))).strip()
        except (KeyboardInterrupt, EOFError):
            print(f"\n{dim('Goodbye!')}")
            break

        if not raw:
            continue

        # --- Commands ---
        if raw.startswith("/"):
            parts = raw.split(maxsplit=1)
            cmd = parts[0].lower()
            arg = parts[1].strip() if len(parts) > 1 else ""

            if cmd == "/quit":
                print(dim("Goodbye!"))
                break

            elif cmd == "/help":
                _print_help()

            elif cmd == "/type":
                if arg not in VALID_ANSWER_TYPES:
                    print(red(f"  Unknown type '{arg}'. Valid: {', '.join(VALID_ANSWER_TYPES)}"))
                else:
                    engine.answer_type = arg
                    print(green(f"  ✓ Answer type set to '{arg}'"))

            elif cmd == "/source":
                if not arg:
                    print(red("  Usage: /source <filename.pdf>"))
                else:
                    engine.set_source_filter(arg)
                    print(green(f"  ✓ Source filter set to '{arg}'"))

            elif cmd == "/sources":
                engine.set_source_filter(None)
                print(green("  ✓ Source filter cleared — searching all modules"))

            elif cmd == "/top":
                try:
                    n = int(arg)
                    if n < 1 or n > 20:
                        raise ValueError
                    engine.set_top_k(n)
                    print(green(f"  ✓ Top-k set to {n}"))
                except ValueError:
                    print(red("  Usage: /top <number between 1 and 20>"))

            else:
                print(red(f"  Unknown command '{cmd}'. Type /help for help."))

            continue

        # --- Regular query ---
        print(dim("  Retrieving & generating answer..."), flush=True)
        try:
            result = engine.ask(raw)
            _print_result(result)
        except Exception as e:
            print(red(f"  Error: {e}"))


# ---------------------------------------------------------------------------
# Non-interactive single-query mode
# ---------------------------------------------------------------------------


def _run_single(engine: QAEngine, query: str) -> None:
    print(dim(f"Query: {query}"), flush=True)
    print(dim("Retrieving & generating answer..."), flush=True)
    result = engine.ask(query)
    _print_result(result)

    # Smoke-test assertions
    assert result.answer, "Answer must be non-empty"
    assert result.latency_seconds > 0, "Latency must be positive"
    assert result.llm_model, "LLM model must be set"
    print(green("  ✓ Smoke test passed: answer non-empty, latency positive, model set"))


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(
        description="CN-RAG — Computer Networks Study Assistant"
    )
    parser.add_argument("--query", "-q", type=str, default=None, help="Single query (non-interactive)")
    parser.add_argument("--type", "-t", type=str, default="general",
                        choices=VALID_ANSWER_TYPES, help="Answer type")
    parser.add_argument("--source", "-s", type=str, default=None, help="Filter by source PDF")
    parser.add_argument("--top_k", "-k", type=int, default=5, help="Number of chunks to retrieve")
    parser.add_argument("--no-interactive", action="store_true",
                        help="Exit after answering a single query (use with --query)")
    args = parser.parse_args()

    engine = QAEngine(
        top_k=args.top_k,
        answer_type=getattr(args, "type"),
        source_filter=args.source,
    )

    if args.query or args.no_interactive:
        query = args.query or "What is the OSI model?"
        _run_single(engine, query)
    else:
        _run_interactive(engine)


if __name__ == "__main__":
    main()
