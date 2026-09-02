import { OPENAI_API_KEY } from "../secrets";
import fs from "fs";
import path from "path";

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
      // Extract informative sentences (> 25 characters, actual descriptive content)
      const sentences = bestItem.content
        .split(/(?<=[.!?])\s+|\|/)
        .map((s: string) => s.replace(/\s+/g, " ").trim())
        .filter(
          (s: string) =>
            s.length > 25 &&
            !s.toLowerCase().startsWith("home") &&
            !s.toLowerCase().startsWith("copyright"),
        );

      const matchingSentences = sentences.filter((s: string) =>
        queryTokens.some((t) => s.toLowerCase().includes(t)),
      );

      const chosenSentences =
        matchingSentences.length >= 2
          ? matchingSentences.slice(0, 3)
          : matchingSentences.concat(sentences).slice(0, 3);

      let cleanText = Array.from(new Set(chosenSentences))
        .join(" ")
        .replace(/https?:\/\/\S+/g, "")
        .replace(/\s+/g, " ")
        .trim();
      if (cleanText.length < 50 && bestItem.content.length > 50) {
        cleanText = bestItem.content
          .substring(0, 450)
          .replace(/https?:\/\/\S+/g, "")
          .trim();
      }
      return cleanText.substring(0, 500);
    }
  } catch (e) {
    console.error("Error searching knowledge bank:", e);
  }
  return "The National Institute of Engineering (NIE), Mysuru, established in 1946, is a premier autonomous institution in Karnataka. NIE offers undergraduate, postgraduate, and research programs across Civil, Mechanical, Electrical, Computer Science, and Electronics engineering departments.";
}

const KNOWLEDGE_BASE = getKnowledgeBankContext();

const SYSTEM_PROMPT = `
You are NIE-Bot, the official virtual assistant for The National Institute of Engineering (NIE), Mysuru.

STRICT OPERATING RULES:
1. Exclusively NIE Mysuru Context: You MUST ONLY answer questions related to NIE Mysuru (admissions, courses, fees, cutoffs, hostels, placements, campus facilities, research, alumni, contact).
2. NO Business or External Topics: DO NOT answer questions about external digital agencies, general business consulting, or unrelated companies.
3. Detailed Answers: Provide complete, clear, and informative responses (2 to 4 sentences). Give full context including dates, departments, or details where applicable.
4. Use Scraped Knowledge Base Exclusively:
${KNOWLEDGE_BASE}
*** END KNOWLEDGE BASE ***

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

    console.log(`DEBUG: API received language: "${language}"`);

    // Append language enforcement to the system prompt
    const languageInstruction = language
      ? `\n\nCRITICAL INSTRUCTION: The user has selected the language: "${language}". Regardless of the language the user speaks (even if they speak English), you MUST output your final response designated for the user ONLY in "${language}". Translate the information from the Knowledge Base into "${language}". Do NOT reply in English unless the selected language is explicitly "English".`
      : "";

    const effectiveSystemPrompt = SYSTEM_PROMPT + languageInstruction;
    const finalSystemPrompt = system_prompt
      ? `${effectiveSystemPrompt}\n\nAdditional Instructions:\n${system_prompt}`
      : effectiveSystemPrompt;

    if (!message) {
      return new Response(JSON.stringify({ error: "message is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (
      !OPENAI_API_KEY ||
      OPENAI_API_KEY === "YOUR_OPENAI_API_KEY" ||
      OPENAI_API_KEY === "YOUR_API_KEY"
    ) {
      const fallbackResponse = searchKnowledgeBank(message);
      return new Response(JSON.stringify({ response: fallbackResponse }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Call OpenAI API
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

    if (!res.ok) {
      const errorData = await res.text();
      console.error("OpenAI API error:", errorData);
      return new Response(
        JSON.stringify({
          error: "Failed to generate response",
          details: errorData,
        }),
        {
          status: res.status,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const data = await res.json();
    const response = data.choices[0].message.content;

    return new Response(JSON.stringify({ response }), {
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
