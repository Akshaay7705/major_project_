import {
  OPENAI_API_KEY,
  GEMINI_API_KEY,
  GEMINI_MODEL,
  GROQ_API_KEY,
  GROQ_MODEL,
  LOCAL_LLM_URL,
  LOCAL_LLM_MODEL,
} from "../secrets";
import fs from "fs";
import path from "path";
import Groq from "groq-sdk";

const groq = new Groq({
  apiKey: GROQ_API_KEY,
});

// ---------------------------------------------------------------------------
// RAG API Integration
// ---------------------------------------------------------------------------

const RAG_API_URL = process.env.RAG_API_URL || "http://localhost:8100";

interface RAGSourceChunk {
  rank: number;
  chunk_id: string;
  text: string;
  source: string;
  start_page: number;
  end_page: number;
  similarity: number;
  citation: string;
}

interface RAGRetrieveResponse {
  query: string;
  chunks: RAGSourceChunk[];
  context_text: string;
  latency_seconds: number;
}

/**
 * Retrieve semantically relevant context from the CN-RAG vector database.
 * Falls back to the local knowledge bank keyword search if the RAG API is unavailable.
 */
async function getRAGContext(
  query: string,
  topK: number = 5,
): Promise<{ context: string; source: "rag" | "knowledge_bank" | "none" }> {
  try {
    const res = await fetch(`${RAG_API_URL}/retrieve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: query,
        top_k: topK,
        answer_type: "general",
      }),
      signal: AbortSignal.timeout(15000), // 15s timeout
    });

    if (res.ok) {
      const data: RAGRetrieveResponse = await res.json();
      if (data.context_text && data.context_text.trim().length > 0) {
        console.log(
          `✅ RAG retrieval: ${data.chunks.length} chunks in ${data.latency_seconds}s`,
        );
        return { context: data.context_text, source: "rag" };
      }
    } else {
      console.warn(
        `⚠️ RAG API returned ${res.status}, falling back to knowledge bank`,
      );
    }
  } catch (error: any) {
    console.warn(
      `⚠️ RAG API unavailable (${error.message}), falling back to knowledge bank`,
    );
  }

  // Fallback: local knowledge bank keyword search
  const kbContext = searchKnowledgeBank(query);
  if (kbContext && kbContext.trim().length > 0) {
    return { context: kbContext, source: "knowledge_bank" };
  }

  return { context: "", source: "none" };
}

// ---------------------------------------------------------------------------
// Legacy: Knowledge Bank (fallback when RAG API is unavailable)
// ---------------------------------------------------------------------------

// Function to load the knowledge bank
function getKnowledgeBankContext() {
  try {
    // Attempt to locate knowledge_bank.json from the project root (relative to apps/demo)
    // We assume the app is running in apps/demo, so the file is two levels up
    const potentialPaths = [
      path.join(process.cwd(), "../../knowledge_bank.json"), // Monorepo root
      path.join(process.cwd(), "knowledge_bank.json"), // App root (if copied)
      "C:\\Users\\acnph\\Downloads\\liveavatar-web-sdk-master\\liveavatar-web-sdk-master\\knowledge_bank.json", // Absolute fallback
    ];

    for (const filePath of potentialPaths) {
      if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, "utf-8");
        const json = JSON.parse(data);
        return json
          .map(
            (item: any) =>
              `Title: ${item.title}\nURL: ${item.url}\nContent: ${item.content}`,
          )
          .join("\n\n");
      }
    }
    console.warn("Knowledge bank file not found.");
    return "";
  } catch (error) {
    console.error("Error loading knowledge bank:", error);
    return "";
  }
}

function searchKnowledgeBank(query: string): string {
  try {
    const potentialPaths = [
      path.join(process.cwd(), "../../knowledge_bank.json"),
      path.join(process.cwd(), "knowledge_bank.json"),
    ];
    let items: any[] = [];
    for (const filePath of potentialPaths) {
      if (fs.existsSync(filePath)) {
        items = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        break;
      }
    }

    if (!items.length) {
      return "The National Institute of Engineering (NIE), Mysuru, established in 1946, offers UG, PG, and Ph.D. engineering programs. Visit https://nie.ac.in for details.";
    }

    const q = query.toLowerCase();
    const queryTokens = q
      .replace(/[^\w\s]/g, "")
      .split(/\s+/)
      .filter(
        (t) =>
          t.length > 2 &&
          ![
            "what",
            "how",
            "tell",
            "show",
            "give",
            "the",
            "can",
            "you",
            "about",
            "for",
            "with",
            "and",
            "is",
            "are",
            "do",
          ].includes(t),
      );

    let bestItem: any = null;
    let maxScore = -1;

    for (const item of items) {
      const text = `${item.title || ""} ${item.content || ""}`.toLowerCase();
      let score = 0;
      for (const token of queryTokens) {
        if (text.includes(token)) {
          score += 1;
        }
      }
      if (score > maxScore) {
        maxScore = score;
        bestItem = item;
      }
    }

    if (bestItem && maxScore > 0) {
      let cleanText = bestItem.content
        .replace(/https?:\/\/\S+/g, "")
        .replace(/\s+/g, " ")
        .trim();

      // Return up to 4000 chars of the most relevant page
      return cleanText.substring(0, 4000);
    }
  } catch (e) {
    console.error("Error searching knowledge bank:", e);
  }
  return "The National Institute of Engineering (NIE), Mysuru, established in 1946, is a premier autonomous institution in Karnataka. NIE offers undergraduate, postgraduate, and research programs across Civil, Mechanical, Electrical, Computer Science, and Electronics engineering departments.";
}

const KNOWLEDGE_BASE = getKnowledgeBankContext();

const NIE_SYSTEM_PROMPT = `
You are NIE-Bot, the official virtual assistant for The National Institute of Engineering (NIE), Mysuru.



STRICT OPERATING RULES:
1. Exclusively NIE Mysuru Context: You MUST ONLY answer questions related to NIE Mysuru.
2. NO Business or External Topics: DO NOT answer unrelated questions.
3. Detailed Answers: Provide complete, clear, and informative responses in 2 to 4 sentences.
4. Use ONLY the relevant information provided in the knowledge context or the core facts above.
5. If the knowledge context does not contain the answer, clearly say that you do not have that information.

Keep responses well-structured, clear, friendly, and natural for spoken voice output.
`;

const ACADEMIC_SYSTEM_PROMPT = `
You are NIE-Bot, the intelligent academic assistant for The National Institute of Engineering (NIE), Mysuru.

You serve two roles:
1. **NIE Information Assistant**: Answer questions about NIE Mysuru — admissions, programs, facilities, faculty, events, etc.
2. **Academic Study Assistant**: Answer academic questions related to subjects taught at NIE (such as Computer Networks, Data Structures, Operating Systems, etc.) using the provided knowledge context retrieved from textbooks and course materials.

OPERATING RULES:
1. If the question is about NIE Mysuru (admissions, campus, departments, etc.), answer using the NIE knowledge context.
2. If the question is academic/technical (e.g., "What is the network layer?", "Explain TCP"), answer it thoroughly using the provided textbook context.
3. Provide complete, clear, and informative responses in 2 to 5 sentences.
4. Use ONLY the relevant information provided in the knowledge context.
5. If the knowledge context does not contain the answer, clearly say that you do not have that information.
6. When answering academic questions, cite the source (textbook/module name and page) if available in the context.

Keep responses well-structured, clear, friendly, and natural for spoken voice output.
`;

import {
  checkRateLimit,
  isValidLanguage,
  sanitizeInput,
} from "../../../lib/security";
import { NextRequest } from "next/server";

export async function POST(request: Request) {
  // 1. Security: Rate Limiting
  // Cast to NextRequest to get headers for IP
  const req = request as unknown as NextRequest;
  if (!checkRateLimit(req, 20, 60 * 1000)) {
    // 20 requests per minute
    return new Response(
      JSON.stringify({ error: "Too many requests. Please slow down." }),
      { status: 429 },
    );
  }

  try {
    const body = await request.json();
    let { message, model = "gpt-4o-mini", system_prompt, language } = body;

    // 2. Security: Input Validation & Sanitization
    if (language && !isValidLanguage(language)) {
      console.warn(
        `SECURITY: Blocked invalid language injection attempt: "${language}"`,
      );
      language = ""; // Fallback to safe default (English) or ignore
    }

    // Check RAW length first to prevent payload attacks
    if (message && message.length > 1000) {
      return new Response(
        JSON.stringify({ error: "Message too long (max 1000 chars)" }),
        { status: 400 },
      );
    }

    message = sanitizeInput(message || "");
    console.log(message);
    if (!message) {
      return new Response(JSON.stringify({ error: "message is required" }), {
        status: 400,
        headers: {
          "Content-Type": "application/json",
        },
      });
    }

    // ---------------------------------------------------------------------------
    // Retrieve context: try RAG API first, fall back to knowledge bank
    // ---------------------------------------------------------------------------
    const { context: ragContext, source: contextSource } =
      await getRAGContext(message);
    console.log(
      `📚 Context source: ${contextSource} (${ragContext.length} chars)`,
    );

    // Use the academic prompt when RAG provides textbook context,
    // otherwise use the strict NIE-only prompt
    const basePrompt =
      contextSource === "rag" ? ACADEMIC_SYSTEM_PROMPT : NIE_SYSTEM_PROMPT;

    const effectiveSystemPrompt = `
    ${basePrompt}

    RELEVANT KNOWLEDGE (retrieved via ${contextSource === "rag" ? "semantic vector search from textbooks" : "keyword search"}):
    ${ragContext}
    `;

    const finalSystemPrompt = system_prompt
      ? `${effectiveSystemPrompt}\n\nAdditional Instructions:\n${system_prompt}`
      : effectiveSystemPrompt;

    console.log(finalSystemPrompt);
    if (!message) {
      return new Response(JSON.stringify({ error: "message is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 1. Prefer Gemini API if configured
    if (
      GEMINI_API_KEY &&
      GEMINI_API_KEY !== "YOUR_GEMINI_API_KEY" &&
      GEMINI_API_KEY !== "YOUR_API_KEY"
    ) {
      try {
        const geminiModel = GEMINI_MODEL;
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${GEMINI_API_KEY}`;
        const userPrompt =
          message +
          (language ? `\n\n(Remember: Reply ONLY in ${language})` : "");

        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: {
              parts: [{ text: finalSystemPrompt }],
            },
            contents: [
              {
                role: "user",
                parts: [{ text: userPrompt }],
              },
            ],
          }),
        });

        if (!res.ok) {
          const errorData = await res.text();
          console.error("Gemini API error (will try fallback):", errorData);
          // Don't return error — fall through to OpenAI/Groq fallback
        } else {
          const data = await res.json();
          const response =
            data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";

          if (response) {
            console.log(
              `✅ LLM USED: Gemini (${GEMINI_MODEL}) — response length: ${response.length}`,
            );
            return new Response(JSON.stringify({ response }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }
        }
      } catch (geminiError) {
        console.error("Error calling Gemini API:", geminiError);
      }
    }

    // 2. Fallback to OpenAI if configured
    if (
      OPENAI_API_KEY &&
      OPENAI_API_KEY !== "YOUR_OPENAI_API_KEY" &&
      OPENAI_API_KEY !== "YOUR_API_KEY"
    ) {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: finalSystemPrompt },
            {
              role: "user",
              content:
                message +
                (language ? `\n\n(Remember: Reply ONLY in ${language})` : ""),
            },
          ],
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const response = data.choices[0]?.message?.content;
        console.log(
          `✅ LLM USED: OpenAI (${model}) — response length: ${response?.length || 0}`,
        );
        return new Response(JSON.stringify({ response }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      const errorData = await res.text();
      console.error("OpenAI API error:", errorData);
    }

    // 3. Fallback to Local LLM (e.g., Ollama) if configured
    if (LOCAL_LLM_URL && LOCAL_LLM_URL !== "") {
      try {
        const userPrompt =
          message +
          (language ? `\n\n(Remember: Reply ONLY in ${language})` : "");

        const res = await fetch(LOCAL_LLM_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: LOCAL_LLM_MODEL,
            messages: [
              { role: "system", content: finalSystemPrompt },
              { role: "user", content: userPrompt },
            ],
            stream: false,
          }),
        });

        if (!res.ok) {
          const errorData = await res.text();
          console.error("Local LLM API error (will try fallback):", errorData);
        } else {
          const data = await res.json();
          const response = data.choices?.[0]?.message?.content?.trim() || "";

          if (response) {
            console.log(
              `✅ LLM USED: Local LLM (${LOCAL_LLM_MODEL}) — response length: ${response.length}`,
            );
            return new Response(JSON.stringify({ response }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }
        }
      } catch (localError) {
        console.error("Error calling Local LLM:", localError);
      }
    }

    // 4. Fallback to groq
    if (
      GROQ_API_KEY &&
      GROQ_API_KEY !== "YOUR_GROQ_API_KEY" &&
      GROQ_API_KEY !== "YOUR_API_KEY"
    ) {
      try {
        const groqModel = GROQ_MODEL;

        const url = "https://api.groq.com/openai/v1/chat/completions";

        const userPrompt =
          message +
          (language ? `\n\n(Remember: Reply ONLY in ${language})` : "");

        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${GROQ_API_KEY}`,
          },
          body: JSON.stringify({
            model: groqModel,
            messages: [
              {
                role: "system",
                content: finalSystemPrompt,
              },
              {
                role: "user",
                content: userPrompt,
              },
            ],
          }),
        });

        if (!res.ok) {
          const errorData = await res.text();
          console.error("Groq API error (will try fallback):", errorData);
          // Don't return error — fall through to knowledge bank fallback
        } else {
          const data = await res.json();
          const response = data.choices?.[0]?.message?.content?.trim() || "";

          if (response) {
            console.log(
              `✅ LLM USED: Groq (${GROQ_MODEL}) — response length: ${response.length}`,
            );
            return new Response(JSON.stringify({ response }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }
        }
      } catch (groqError) {
        console.error("Error calling Groq API:", groqError);
      }
    }

    // 4. Fallback to local Knowledge Bank search
    console.log(
      `⚠️ LLM USED: Local Knowledge Bank fallback (all LLM providers failed or unconfigured)`,
    );
    const fallbackResponse = searchKnowledgeBank(message);
    return new Response(JSON.stringify({ response: fallbackResponse }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error generating response:", error);
    return new Response(
      JSON.stringify({ error: "Failed to generate response" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}
