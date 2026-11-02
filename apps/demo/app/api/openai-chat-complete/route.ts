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
import {
  chatCache,
  CHAT_CACHE_TTL_MS,
  chatCacheKey,
  ragCache,
  RAG_CACHE_TTL_MS,
  ragCacheKey,
} from "../../../lib/cache";

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
 * Retrieve semantically relevant context.
 * - Prioritizes NIE institutional Knowledge Bank for questions about NIE, leadership, admissions, etc.
 * - Uses CN-RAG vector database for academic Computer Networks textbook questions.
 */
async function getRAGContext(
  query: string,
  topK: number = 5,
): Promise<{ context: string; source: "rag" | "knowledge_bank" | "none" }> {
  // ── RAG cache lookup ──────────────────────────────────────────
  const rKey = ragCacheKey(query);
  const cachedCtx = ragCache.get(rKey);
  if (cachedCtx !== undefined) {
    console.log(`⚡ RAG cache HIT for: "${query.substring(0, 60)}"`);
    // Determine original source from cached prefix tag
    const source = cachedCtx.startsWith("[KB]") ? "knowledge_bank" : "rag";
    const ctx = cachedCtx.startsWith("[KB]")
      ? cachedCtx.slice(4)
      : cachedCtx.startsWith("[RAG]")
        ? cachedCtx.slice(5)
        : cachedCtx;
    return { context: ctx, source };
  }

  // 1. Search NIE institutional Knowledge Bank
  const kbResult = searchKnowledgeBank(query);

  const isInstitutionalQuery =
    kbResult.topScore >= 1.2 ||
    /\b(nie|mysuru|mysore|dean|deans|principal|vice\s*principal|iqac|admission|admissions|fee|fees|placement|placements|hostel|scholarship|ranking|nirf|naac|nba|campus|library|sports|gym|canteen|registrar|controller|coe|founder|history|governing|management\s*quota|comedk|cet)\b/i.test(
      query,
    );

  if (isInstitutionalQuery && kbResult.context.trim().length > 0) {
    console.log(
      `🏛️ Knowledge Bank match (score: ${kbResult.topScore.toFixed(2)}) for institutional query: "${query}"`,
    );
    ragCache.set(rKey, `[KB]${kbResult.context}`, RAG_CACHE_TTL_MS);
    return { context: kbResult.context, source: "knowledge_bank" };
  }

  // 2. Query CN-RAG vector database for academic/technical questions
  try {
    const res = await fetch(`${RAG_API_URL}/retrieve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: query,
        top_k: topK,
        answer_type: "general",
      }),
      signal: AbortSignal.timeout(10000), // 10s timeout
    });

    if (res.ok) {
      const data: RAGRetrieveResponse = await res.json();
      if (data.context_text && data.context_text.trim().length > 0) {
        console.log(
          `✅ RAG retrieval: ${data.chunks.length} chunks in ${data.latency_seconds}s`,
        );
        ragCache.set(rKey, `[RAG]${data.context_text}`, RAG_CACHE_TTL_MS);
        return { context: data.context_text, source: "rag" };
      }
    } else {
      console.warn(
        `⚠️ RAG API returned ${res.status}, checking knowledge bank fallback`,
      );
    }
  } catch (error: any) {
    console.warn(
      `⚠️ RAG API unavailable (${error.message}), checking knowledge bank fallback`,
    );
  }

  // 3. Fallback to knowledge bank if RAG has nothing
  if (kbResult.context.trim().length > 0) {
    ragCache.set(rKey, `[KB]${kbResult.context}`, RAG_CACHE_TTL_MS);
    return { context: kbResult.context, source: "knowledge_bank" };
  }

  ragCache.set(rKey, "", RAG_CACHE_TTL_MS);
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

function searchKnowledgeBank(query: string): {
  context: string;
  topScore: number;
} {
  try {
    const potentialPaths = [
      path.join(process.cwd(), "../../knowledge_bank.json"),
      path.join(process.cwd(), "knowledge_bank.json"),
      path.join(
        process.cwd(),
        "app/api/openai-chat-complete/knowledge_bank.json",
      ),
    ];
    let items: any[] = [];
    for (const filePath of potentialPaths) {
      if (fs.existsSync(filePath)) {
        items = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        break;
      }
    }

    if (!items.length) {
      return {
        context:
          "The National Institute of Engineering (NIE), Mysuru, established in 1946, offers UG, PG, and Ph.D. engineering programs. Visit https://nie.ac.in for details.",
        topScore: 0,
      };
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
      "is",
      "of",
      "in",
      "at",
      "on",
      "by",
      "an",
      "as",
      "be",
      "it",
      "or",
      "to",
      "a",
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
        "dean",
        "deans",
        "director",
        "iqac",
        "chairperson",
        "secretary",
        "coe",
        "registrar",
        "administration",
        "leadership",
        "office",
      ],
      Home: [],
    };

    const q = query.toLowerCase();
    const queryTokens = q
      .replace(/[^\w\s]/g, "")
      .split(/\s+/)
      .filter((t) => t.length > 1 && !STOP_WORDS.has(t));

    if (!queryTokens.length) {
      return {
        context:
          "The National Institute of Engineering (NIE), Mysuru, established in 1946, is a premier autonomous institution. Visit https://nie.ac.in for details.",
        topScore: 0,
      };
    }

    const N = items.length;
    // Count how many pages contain each token (for BM25 IDF)
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

    // Score each knowledge bank page using BM25 IDF
    const scored: { item: any; score: number }[] = [];

    for (const item of items) {
      const text =
        `${item.title || ""} ${item.content || ""} ${item.category || ""}`.toLowerCase();
      let score = 0;

      for (const token of queryTokens) {
        const wordRegex = new RegExp(`\\b${token}\\b`, "g");
        const matches = text.match(wordRegex);
        if (matches) {
          const freq = tokenDocFreq[token] || 1;
          const idf = Math.max(
            0.05,
            Math.log((N - freq + 0.5) / (freq + 0.5) + 1),
          );
          const tf = Math.min(matches.length, 5);
          score += tf * idf;
        }
      }

      // Category boost
      const itemCategory = item.category || "";
      for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
        if (itemCategory === category) {
          for (const token of queryTokens) {
            if (keywords.includes(token)) {
              score += 2;
            }
          }
        }
      }

      // Title match boost
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

    scored.sort((a, b) => b.score - a.score);
    const topResults = scored.slice(0, 3);
    const topScore = topResults[0]?.score ?? 0;

    if (!topResults.length) {
      return {
        context:
          "The National Institute of Engineering (NIE), Mysuru, established in 1946, is a premier autonomous institution in Karnataka. NIE offers undergraduate, postgraduate, and research programs across Civil, Mechanical, Electrical, Computer Science, and Electronics engineering departments.",
        topScore: 0,
      };
    }

    // Build context from top results, including structured table data
    const contextParts: string[] = [];
    let totalLength = 0;
    const MAX_CONTEXT_LENGTH = 8000;

    for (const { item } of topResults) {
      if (totalLength >= MAX_CONTEXT_LENGTH) break;

      let part = `[Page: ${item.title || "NIE"}]\n`;
      if (item.category) {
        part += `Category: ${item.category}\n`;
      }

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

    return {
      context: contextParts.join("\n\n---\n\n"),
      topScore,
    };
  } catch (e) {
    console.error("Error searching knowledge bank:", e);
  }
  return {
    context:
      "The National Institute of Engineering (NIE), Mysuru, established in 1946, is a premier autonomous institution in Karnataka. NIE offers undergraduate, postgraduate, and research programs across Civil, Mechanical, Electrical, Computer Science, and Electronics engineering departments.",
    topScore: 0,
  };
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

import { buildTimetablePromptContext } from "../../../lib/timetable/store";

const TIMETABLE_SYSTEM_PROMPT = `
You are NIE-Bot, the official virtual assistant for The National Institute of Engineering (NIE), Mysuru.

You assist students, faculty, and guests with faculty locations, class schedules, and the college timetable.

OPERATING RULES FOR TIMETABLES & TEACHERS:
1. Use the authoritative timetable and faculty mapping data provided below.
2. When asked at what time a teacher will be in which class, or where they are at a specific time:
   - Understand time ranges: periods span start to end times (e.g. "09:00 AM to 10:00 AM" covers 09:30 AM). If the requested time falls within a period, confirm that the teacher is taking that class!
   - Clearly state:
     * The teacher's full name
     * The subject taught
     * The exact day and period (e.g. "Tuesday from 9:00 AM to 10:00 AM")
     * The class / section (e.g. "5th Semester CSE Section A")
     * The classroom or laboratory venue (e.g. "Room 101" or "CS Lab-1").
3. If asked about a teacher's current location or "where is the teacher right now", use the current Mysore/IST time and day provided in the timetable context to state whether they are currently teaching a class or when their next scheduled class is.
4. Keep answers concise, accurate, friendly, and natural for spoken voice output (2 to 4 sentences). Avoid markdown syntax like asterisks, bullet dots, or hashtags.
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
    let {
      message,
      model = "gpt-4o-mini",
      system_prompt,
      language,
      clearCache,
    } = body;

    if (clearCache) {
      chatCache.clear();
      ragCache.clear();
    }

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
    // Retrieve Timetable & Teacher Schedule Context
    // ---------------------------------------------------------------------------
    const { context: timetableContext, isRelevant: isTimetableQuery } =
      buildTimetablePromptContext(message);
    if (isTimetableQuery) {
      console.log(`📅 Timetable context activated for query: "${message}"`);
    }

    // ---------------------------------------------------------------------------
    // Chat response cache (skip for timetable / time-sensitive queries)
    // ---------------------------------------------------------------------------
    const cKey = chatCacheKey(message, language || "en");
    if (!isTimetableQuery) {
      const cachedReply = chatCache.get(cKey);
      if (cachedReply) {
        console.log(`⚡ Chat cache HIT for: "${message.substring(0, 60)}"`);
        return new Response(
          JSON.stringify({ response: cachedReply, cached: true }),
          {
            status: 200,
            headers: { "Content-Type": "application/json", "X-Cache": "HIT" },
          },
        );
      }
    }

    // ---------------------------------------------------------------------------
    // Retrieve context: try RAG API first, fall back to knowledge bank
    // ---------------------------------------------------------------------------
    const { context: ragContext, source: contextSource } =
      await getRAGContext(message);
    console.log(
      `📚 Context source: ${contextSource} (${ragContext.length} chars)`,
    );

    // Select base system prompt:
    // Timetable prompt takes precedence if the user asks about teachers, schedules, or classes
    let basePrompt = NIE_SYSTEM_PROMPT;
    if (isTimetableQuery) {
      basePrompt = TIMETABLE_SYSTEM_PROMPT;
    } else if (contextSource === "rag") {
      basePrompt = ACADEMIC_SYSTEM_PROMPT;
    }

    const effectiveSystemPrompt = isTimetableQuery
      ? `${TIMETABLE_SYSTEM_PROMPT}

AUTHORITATIVE TIMETABLE & TEACHER SCHEDULE DATA:
${timetableContext}`
      : `
    ${basePrompt}

    ${timetableContext ? `\nAUTHORITATIVE TIMETABLE & TEACHER SCHEDULE DATA:\n${timetableContext}\n` : ""}

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
          signal: AbortSignal.timeout(12000), // 12s timeout to prevent hanging
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
            // Cache Gemini response (skip timetable queries)
            if (!isTimetableQuery) {
              chatCache.set(cKey, response, CHAT_CACHE_TTL_MS);
            }
            return new Response(JSON.stringify({ response }), {
              status: 200,
              headers: {
                "Content-Type": "application/json",
                "X-Cache": "MISS",
              },
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
        // Cache OpenAI response (skip timetable queries)
        if (!isTimetableQuery && response) {
          chatCache.set(cKey, response, CHAT_CACHE_TTL_MS);
        }
        return new Response(JSON.stringify({ response }), {
          status: 200,
          headers: { "Content-Type": "application/json", "X-Cache": "MISS" },
        });
      }
      const errorData = await res.text();
      console.error("OpenAI API error:", errorData);
    }

    // 3. Fallback to Local LLM (e.g., Ollama) if configured
    // if (LOCAL_LLM_URL && LOCAL_LLM_URL !== "") {
    //   try {
    //     const userPrompt =
    //       message +
    //       (language ? `\n\n(Remember: Reply ONLY in ${language})` : "");

    //     const res = await fetch(LOCAL_LLM_URL, {
    //       method: "POST",
    //       headers: { "Content-Type": "application/json" },
    //       body: JSON.stringify({
    //         model: LOCAL_LLM_MODEL,
    //         messages: [
    //           { role: "system", content: finalSystemPrompt },
    //           { role: "user", content: userPrompt },
    //         ],
    //         stream: false,
    //       }),
    //     });

    //     if (!res.ok) {
    //       const errorData = await res.text();
    //       console.error("Local LLM API error (will try fallback):", errorData);
    //     } else {
    //       const data = await res.json();
    //       const response = data.choices?.[0]?.message?.content?.trim() || "";

    //       if (response) {
    //         console.log(
    //           `✅ LLM USED: Local LLM (${LOCAL_LLM_MODEL}) — response length: ${response.length}`,
    //         );
    //         return new Response(JSON.stringify({ response }), {
    //           status: 200,
    //           headers: { "Content-Type": "application/json" },
    //         });
    //       }
    //     }
    //   } catch (localError) {
    //     console.error("Error calling Local LLM:", localError);
    //   }
    // }

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
            // Cache Groq response (skip timetable queries)
            if (!isTimetableQuery) {
              chatCache.set(cKey, response, CHAT_CACHE_TTL_MS);
            }
            return new Response(JSON.stringify({ response }), {
              status: 200,
              headers: {
                "Content-Type": "application/json",
                "X-Cache": "MISS",
              },
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
    const fallbackResponse = searchKnowledgeBank(message).context;
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

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get("clearCache") === "true") {
    chatCache.clear();
    ragCache.clear();
    return new Response(JSON.stringify({ status: "cleared" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response(
    JSON.stringify({
      chatCacheSize: chatCache.size,
      ragCacheSize: ragCache.size,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
}
