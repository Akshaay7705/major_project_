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
 * Classify whether the query is about NIE (institutional) or academic (textbook).
 * Returns "nie", "academic", or "both" if it could be either.
 */
function classifyQueryIntent(query: string): "nie" | "academic" | "both" {
  const q = query.toLowerCase();

  // NIE-specific keywords
  const nieKeywords = [
    "nie",
    "mysuru",
    "mysore",
    "admission",
    "admissions",
    "placement",
    "placements",
    "fee",
    "fees",
    "hostel",
    "campus",
    "department",
    "departments",
    "club",
    "clubs",
    "fest",
    "festival",
    "sports",
    "gym",
    "library",
    "canteen",
    "faculty",
    "principal",
    "naac",
    "nba",
    "ranking",
    "accreditation",
    "seat",
    "seats",
    "cutoff",
    "cut-off",
    "cet",
    "comedk",
    "jee",
    "quota",
    "management quota",
    "scholarship",
    "recruit",
    "recruiter",
    "recruiters",
    "package",
    "lpa",
    "salary",
    "company",
    "companies",
    "hiring",
    "career",
    "apply",
    "application",
    "eligibility",
    "branch",
    "programme",
    "mtech",
    "mca",
    "btech",
    "intake",
    "institute",
    "college",
    "founded",
    "established",
    "alumni",
    "narayana murthy",
    "infosys",
    "autonomous",
    "vtu",
    "aicte",
    "ugc",
    "endowment",
    "convocation",
    "graduation day",
    "training",
    "internship",
  ];

  // Academic/textbook keywords (Computer Networks and general engineering)
  const academicKeywords = [
    "tcp",
    "udp",
    "ip",
    "osi",
    "protocol",
    "routing",
    "subnet",
    "dns",
    "dhcp",
    "http",
    "https",
    "ftp",
    "smtp",
    "socket",
    "packet",
    "frame",
    "ethernet",
    "bandwidth",
    "latency",
    "throughput",
    "congestion",
    "arp",
    "icmp",
    "nat",
    "firewall",
    "vpn",
    "ssl",
    "tls",
    "encryption",
    "decryption",
    "cipher",
    "modulation",
    "multiplexing",
    "switching",
    "topology",
    "lan",
    "wan",
    "man",
    "router",
    "switch",
    "hub",
    "bridge",
    "gateway",
    "osi model",
    "layer",
    "transport layer",
    "network layer",
    "data link",
    "physical layer",
    "application layer",
    "session layer",
    "presentation layer",
    "algorithm",
    "data structure",
    "binary tree",
    "graph",
    "sorting",
    "operating system",
    "process",
    "thread",
    "semaphore",
    "deadlock",
    "virtual memory",
    "paging",
    "scheduling",
    "file system",
    "database",
    "sql",
    "normalization",
    "transaction",
    "acid",
    "explain",
    "define",
    "difference between",
    "what is the",
    "how does",
  ];

  let nieScore = 0;
  let academicScore = 0;

  for (const kw of nieKeywords) {
    if (q.includes(kw)) nieScore++;
  }
  for (const kw of academicKeywords) {
    if (q.includes(kw)) academicScore++;
  }

  if (nieScore > 0 && academicScore > 0) return "both";
  if (nieScore > 0) return "nie";
  if (academicScore > 0) return "academic";

  // Default: if we can't tell, try both
  return "both";
}

/**
 * Retrieve semantically relevant context from the CN-RAG vector database.
 * Falls back to the local knowledge bank keyword search if the RAG API is unavailable.
 * Routes queries intelligently: NIE questions → knowledge bank, academic → RAG, mixed → both.
 */
async function getRAGContext(
  query: string,
  topK: number = 5,
): Promise<{
  context: string;
  source: "rag" | "knowledge_bank" | "both" | "none";
}> {
  const intent = classifyQueryIntent(query);
  console.log(`🔍 Query intent classified as: ${intent}`);

  let ragContext = "";
  let kbContext = "";

  // Only call RAG API for academic or mixed queries
  if (intent === "academic" || intent === "both") {
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
          ragContext = data.context_text;
        }
      } else {
        console.warn(`⚠️ RAG API returned ${res.status}`);
      }
    } catch (error: any) {
      console.warn(`⚠️ RAG API unavailable (${error.message})`);
    }
  }

  // Use knowledge bank for NIE or mixed queries, or as fallback
  if (intent === "nie" || intent === "both" || !ragContext) {
    kbContext = searchKnowledgeBank(query);
  }

  // Combine contexts based on what we got
  if (ragContext && kbContext && intent === "both") {
    const combined = `--- NIE INSTITUTIONAL INFORMATION ---\n${kbContext}\n\n--- ACADEMIC/TEXTBOOK INFORMATION ---\n${ragContext}`;
    return { context: combined, source: "both" };
  }
  if (kbContext && (intent === "nie" || !ragContext)) {
    return { context: kbContext, source: "knowledge_bank" };
  }
  if (ragContext) {
    return { context: ragContext, source: "rag" };
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

    const STOP_WORDS = new Set([
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
      "are",
      "does",
      "did",
      "has",
      "have",
      "been",
      "this",
      "that",
      "from",
      "they",
      "them",
      "their",
      "there",
      "here",
      "which",
      "where",
      "when",
      "who",
      "whom",
      "will",
      "would",
      "could",
      "should",
      "may",
      "might",
      "shall",
      "not",
      "also",
      "than",
      "then",
      "its",
      "any",
      "all",
      "each",
      "every",
      "both",
      "few",
      "more",
      "most",
      "some",
      "such",
      "into",
      "over",
      "after",
      "before",
      "between",
      "under",
      "above",
      "out",
      "off",
      "down",
      "only",
      "own",
      "same",
      "too",
      "very",
      "just",
      "but",
      "nor",
      "yet",
      "was",
      "were",
      "being",
      "had",
      "having",
      "doing",
      "please",
      "know",
      "want",
      "need",
      "like",
      "get",
      "got",
      "let",
      "make",
      "made",
    ]);

    // Category keywords: boost pages whose category matches the query intent
    const CATEGORY_KEYWORDS: Record<string, string[]> = {
      Admissions: [
        "admission",
        "admissions",
        "apply",
        "eligibility",
        "fee",
        "fees",
        "seat",
        "seats",
        "cutoff",
        "cut-off",
        "rank",
        "cet",
        "comedk",
        "jee",
        "quota",
        "management",
        "scholarship",
        "intake",
      ],
      Placements: [
        "placement",
        "placements",
        "package",
        "salary",
        "recruiter",
        "recruiters",
        "company",
        "companies",
        "hiring",
        "job",
        "jobs",
        "career",
        "careers",
        "lpa",
        "ctc",
        "offer",
      ],
      "Research & Innovation": [
        "research",
        "innovation",
        "phd",
        "doctoral",
        "publication",
        "publications",
        "patent",
        "lab",
        "laboratory",
        "centre",
        "center",
      ],
      Academics: [
        "department",
        "departments",
        "programme",
        "program",
        "course",
        "courses",
        "branch",
        "branches",
        "syllabus",
        "curriculum",
        "btech",
        "mtech",
        "mca",
      ],
      "Campus Life": [
        "hostel",
        "hostels",
        "campus",
        "club",
        "clubs",
        "fest",
        "festival",
        "sports",
        "gym",
        "library",
        "canteen",
        "food",
      ],
      About: [
        "history",
        "founded",
        "established",
        "legacy",
        "vision",
        "mission",
        "principal",
        "naac",
        "nba",
        "ranking",
        "accreditation",
      ],
      Home: [],
    };

    const q = query.toLowerCase();
    const queryTokens = q
      .replace(/[^\w\s]/g, "")
      .split(/\s+/)
      .filter((t) => t.length > 1 && !STOP_WORDS.has(t));

    if (!queryTokens.length) {
      // If the query is all stop-words, return a generic response
      return "The National Institute of Engineering (NIE), Mysuru, established in 1946, is a premier autonomous institution. Visit https://nie.ac.in for details.";
    }

    // Count how many pages contain each token (for IDF-like weighting)
    const tokenDocFreq: Record<string, number> = {};
    for (const token of queryTokens) {
      const wordRegex = new RegExp(`\\b${token}\\b`, "i");
      let count = 0;
      for (const item of items) {
        const text = `${item.title || ""} ${item.content || ""} ${item.category || ""}`;
        if (wordRegex.test(text)) count++;
      }
      tokenDocFreq[token] = count || 1;
    }

    // Score each knowledge bank page
    const scored: { item: any; score: number }[] = [];

    for (const item of items) {
      // Include table data in searchable text
      let tableText = "";
      if (item.tables && Array.isArray(item.tables)) {
        for (const table of item.tables) {
          for (const row of table.rows || []) {
            tableText += " " + Object.values(row).join(" ");
          }
        }
      }

      const text =
        `${item.title || ""} ${item.content || ""} ${item.category || ""} ${tableText}`.toLowerCase();
      let score = 0;

      // Multi-word phrase matching: check if the full query (minus stop-words) appears as a phrase
      const phraseQuery = queryTokens.join(" ");
      if (phraseQuery.length > 3 && text.includes(phraseQuery)) {
        score += 10; // big boost for exact phrase match
      }
      // Also check 2-word sliding window phrases
      for (let i = 0; i < queryTokens.length - 1; i++) {
        const bigram = `${queryTokens[i]} ${queryTokens[i + 1]}`;
        if (text.includes(bigram)) {
          score += 5; // significant boost for bigram match
        }
      }

      for (const token of queryTokens) {
        // Use word-boundary regex for accurate matching
        const wordRegex = new RegExp(`\\b${token}\\b`, "g");
        const matches = text.match(wordRegex);
        if (matches) {
          // IDF-like weight: tokens appearing in fewer pages are more important
          const idf = Math.log(items.length / tokenDocFreq[token]) + 1;
          // Count occurrences (TF), but cap at 5 to avoid long pages dominating
          const tf = Math.min(matches.length, 5);
          score += tf * idf;
        }
      }

      // Category boost: if query tokens match a category's keywords, boost that page
      const itemCategory = item.category || "";
      for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
        if (itemCategory === category) {
          for (const token of queryTokens) {
            if (keywords.includes(token)) {
              score += 3; // significant boost for category match
            }
          }
        }
      }

      // Title match boost: tokens in the title are more relevant
      const titleText = (item.title || "").toLowerCase();
      for (const token of queryTokens) {
        const titleRegex = new RegExp(`\\b${token}\\b`, "g");
        if (titleRegex.test(titleText)) {
          score += 2;
        }
      }

      if (score > 0) {
        scored.push({ item, score });
      }
    }

    // Sort by score descending and take top 3 results
    scored.sort((a, b) => b.score - a.score);
    const topResults = scored.slice(0, 3);

    if (!topResults.length) {
      return "The National Institute of Engineering (NIE), Mysuru, established in 1946, is a premier autonomous institution in Karnataka. NIE offers undergraduate, postgraduate, and research programs across Civil, Mechanical, Electrical, Computer Science, and Electronics engineering departments.";
    }

    // Build context from top results, including table data
    const contextParts: string[] = [];
    let totalLength = 0;
    const MAX_CONTEXT_LENGTH = 8000;

    for (const { item } of topResults) {
      if (totalLength >= MAX_CONTEXT_LENGTH) break;

      let part = `[Page: ${item.title || "NIE"}]\n`;
      if (item.category) {
        part += `Category: ${item.category}\n`;
      }

      // Clean and add main content
      let cleanContent = (item.content || "")
        .replace(/https?:\/\/\S+/g, "")
        .replace(/\s+/g, " ")
        .trim();

      const remaining = MAX_CONTEXT_LENGTH - totalLength - part.length;
      if (cleanContent.length > remaining - 500) {
        cleanContent = cleanContent.substring(
          0,
          Math.max(remaining - 500, 1000),
        );
      }
      part += cleanContent;

      // Include structured table data if available
      if (item.tables && Array.isArray(item.tables)) {
        for (const table of item.tables) {
          if (totalLength + part.length > MAX_CONTEXT_LENGTH) break;
          const headers = table.headers || [];
          let tableText = `\n\n[Table: ${headers.join(" | ")}]\n`;
          for (const row of table.rows || []) {
            const rowValues = headers.map(
              (h: string) => `${h}: ${row[h] || "—"}`,
            );
            tableText += rowValues.join(", ") + "\n";
          }
          part += tableText;
        }
      }

      contextParts.push(part);
      totalLength += part.length;
    }

    return contextParts.join("\n\n---\n\n");
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
      contextSource === "rag" || contextSource === "both"
        ? ACADEMIC_SYSTEM_PROMPT
        : NIE_SYSTEM_PROMPT;

    const contextLabel =
      contextSource === "rag"
        ? "semantic vector search from textbooks"
        : contextSource === "both"
          ? "NIE website knowledge bank + textbook vector search"
          : "NIE website knowledge bank keyword search";

    const effectiveSystemPrompt = `
    ${basePrompt}

    RELEVANT KNOWLEDGE (retrieved via ${contextLabel}):
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
