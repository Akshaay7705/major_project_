"""
Gemini Client module for Computer Networks RAG.

Provides an isolated, reusable interface for Google's Gemini API SDK (google-genai)
supporting embedding generation and LLM text operations with built-in retry logic.
"""

import os
import time
from typing import List, Optional
from dotenv import load_dotenv
from google import genai
from google.genai import types

load_dotenv()


class GeminiClient:
    """Isolated client wrapper for Google Gemini API."""

    def __init__(
        self,
        api_key: Optional[str] = None,
        embedding_model: Optional[str] = None,
        max_retries: int = 10,
        initial_backoff: float = 60.0,
    ):
        """
        Initialize GeminiClient.

        :param api_key: Gemini API Key (defaults to GEMINI_API_KEY or GOOGLE_API_KEY env var).
        :param embedding_model: Embedding model name (defaults to GEMINI_EMBEDDING_MODEL env var or 'gemini-embedding-001').
        :param max_retries: Maximum number of exponential backoff retry attempts.
        :param initial_backoff: Initial sleep duration in seconds for exponential backoff (default 60s for quota reset).
        """
        self.api_key = (
            api_key
            or os.getenv("GEMINI_API_KEY")
            or os.getenv("GOOGLE_API_KEY")
        )
        if not self.api_key:
            raise ValueError(
                "Missing Gemini API Key. Please set GEMINI_API_KEY in your .env file or environment variables."
            )

        self.embedding_model = (
            embedding_model
            or os.getenv("GEMINI_EMBEDDING_MODEL")
            or "gemini-embedding-001"
        )
        self.llm_model = (
            os.getenv("GEMINI_LLM_MODEL")
            or "gemini-3.6-flash"
        )
        self.max_retries = max_retries
        self.initial_backoff = initial_backoff

        # Initialize official google-genai Client
        self.client = genai.Client(api_key=self.api_key)

    def embed_texts(
        self, texts: List[str], task_type: str = "RETRIEVAL_DOCUMENT"
    ) -> List[List[float]]:
        """
        Generate vector embeddings for a list of text strings with exponential backoff retry.

        :param texts: List of text strings to embed.
        :param task_type: Task type for embedding ('RETRIEVAL_DOCUMENT' or 'RETRIEVAL_QUERY').
        :return: List of float vector embeddings.
        """
        if not texts:
            return []

        backoff = self.initial_backoff

        for attempt in range(1, self.max_retries + 1):
            try:
                response = self.client.models.embed_content(
                    model=self.embedding_model,
                    contents=texts,
                    config=types.EmbedContentConfig(
                        task_type=task_type,
                    ),
                )

                if not response or not response.embeddings:
                    raise RuntimeError("Gemini API returned an empty or invalid embedding response.")

                embeddings = [e.values for e in response.embeddings]
                if len(embeddings) != len(texts):
                    raise RuntimeError(
                        f"Expected {len(texts)} embeddings, but received {len(embeddings)} from API."
                    )

                return embeddings

            except Exception as err:
                err_msg = str(err)
                is_rate_limit = (
                    "429" in err_msg
                    or "RESOURCE_EXHAUSTED" in err_msg
                    or "quota" in err_msg.lower()
                    or "limit" in err_msg.lower()
                )

                if attempt == self.max_retries:
                    raise RuntimeError(
                        f"Failed to generate embeddings after {self.max_retries} attempts. Last error: {err_msg}"
                    ) from err

                sleep_time = 60.0 if is_rate_limit else min(60.0, backoff)
                reason = "Quota limit reached (429). Waiting 60s for minute window reset" if is_rate_limit else f"API error ({err_msg[:60]}...)"
                print(f"\n  [Attempt {attempt}/{self.max_retries}] {reason}... ", end="", flush=True)
                time.sleep(sleep_time)
                backoff *= 1.5

        return []

    def generate_answer(self, prompt: str) -> str:
        """
        Generate a text answer from the LLM for the given prompt.

        :param prompt: Fully assembled prompt string.
        :return: Generated answer text.
        """
        if not prompt or not prompt.strip():
            raise ValueError("Prompt must be a non-empty string.")

        backoff = self.initial_backoff

        for attempt in range(1, self.max_retries + 1):
            try:
                response = self.client.models.generate_content(
                    model=self.llm_model,
                    contents=prompt,
                )
                if not response or not response.text:
                    raise RuntimeError("Gemini LLM returned an empty response.")
                return response.text

            except Exception as err:
                err_msg = str(err)
                is_rate_limit = (
                    "429" in err_msg
                    or "RESOURCE_EXHAUSTED" in err_msg
                    or "quota" in err_msg.lower()
                    or "limit" in err_msg.lower()
                )

                if attempt == self.max_retries:
                    raise RuntimeError(
                        f"Failed to generate answer after {self.max_retries} attempts. Last error: {err_msg}"
                    ) from err

                sleep_time = 60.0 if is_rate_limit else min(30.0, backoff)
                reason = (
                    "Quota limit reached (429). Waiting 60s"
                    if is_rate_limit
                    else f"API error ({err_msg[:60]}...)"
                )
                print(f"\n  [Attempt {attempt}/{self.max_retries}] {reason}... ", end="", flush=True)
                time.sleep(sleep_time)
                backoff *= 1.5

        return ""
