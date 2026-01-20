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
      path.join(process.cwd(), "knowledge_bank.json"),       // App root (if copied)
      "C:\\Users\\acnph\\Downloads\\liveavatar-web-sdk-master\\liveavatar-web-sdk-master\\knowledge_bank.json" // Absolute fallback
    ];

    for (const filePath of potentialPaths) {
      if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, "utf-8");
        const json = JSON.parse(data);
        return json.map((item: any) => `Title: ${item.title}\nURL: ${item.url}\nContent: ${item.content}`).join("\n\n");
      }
    }
    console.warn("Knowledge bank file not found.");
    return "";
  } catch (error) {
    console.error("Error loading knowledge bank:", error);
    return "";
  }
}

const KNOWLEDGE_BASE = getKnowledgeBankContext();

const SYSTEM_PROMPT = `
You are a knowledgeable representative of Pro Digital (Pro Digital Labs). 
Your KNOWLEDGE BASE is provided below. 
You must answer questions ONLY based on this KNOWLEDGE BASE. 
If the answer is not in the KNOWLEDGE BASE, you must politely refuse to answer and state that you can only answer questions about Pro Digital.
Do not make up information. Do not answer general knowledge questions (e.g. general history, math, code) unless they are directly related to the provided context.

*** KNOWLEDGE BASE ***
${KNOWLEDGE_BASE}
*** END KNOWLEDGE BASE ***

Answer courteously and professionally.
`;

import { checkRateLimit, isValidLanguage, sanitizeInput } from "../../../lib/security";
import { NextRequest } from "next/server";

export async function POST(request: Request) {
  // 1. Security: Rate Limiting
  // Cast to NextRequest to get headers for IP
  const req = request as unknown as NextRequest;
  if (!checkRateLimit(req, 20, 60 * 1000)) { // 20 requests per minute
    return new Response(JSON.stringify({ error: "Too many requests. Please slow down." }), { status: 429 });
  }

  try {
    const body = await request.json();
    let {
      message,
      model = "gpt-4o-mini",
      system_prompt,
      language,
    } = body;

    // 2. Security: Input Validation & Sanitization
    if (language && !isValidLanguage(language)) {
      console.warn(`SECURITY: Blocked invalid language injection attempt: "${language}"`);
      language = ""; // Fallback to safe default (English) or ignore
    }

    message = sanitizeInput(message || "");
    if (message.length > 1000) {
      return new Response(JSON.stringify({ error: "Message too long (max 1000 chars)" }), { status: 400 });
    }


    console.log(`DEBUG: API received language: "${language}"`);

    // Append language enforcement to the system prompt
    // This ensures the avatar speaks the selected language even if the user speaks something else.
    const languageInstruction = language ? `\n\nCRITICAL INSTRUCTION: The user has selected the language: "${language}". Regardless of the language the user speaks (even if they speak English), you MUST output your final response designated for the user ONLY in "${language}". Translate the information from the Knowledge Base into "${language}". Do NOT reply in English unless the selected language is explicitly "English".` : "";

    const effectiveSystemPrompt = SYSTEM_PROMPT + languageInstruction;

    // Merge strictly
    const finalSystemPrompt = system_prompt ? `${effectiveSystemPrompt}\n\nAdditional Instructions:\n${system_prompt}` : effectiveSystemPrompt;

    if (!message) {
      return new Response(JSON.stringify({ error: "message is required" }), {
        status: 400,
        headers: {
          "Content-Type": "application/json",
        },
      });
    }

    if (!OPENAI_API_KEY) {
      return new Response(
        JSON.stringify({ error: "OpenAI API key not configured" }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
          },
        },
      );
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
          { role: "user", content: message + (language ? `\n\n(Remember: Reply ONLY in ${language})` : "") },
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
          headers: {
            "Content-Type": "application/json",
          },
        },
      );
    }

    const data = await res.json();
    const response = data.choices[0].message.content;

    return new Response(JSON.stringify({ response }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    });
  } catch (error) {
    console.error("Error generating response:", error);
    return new Response(
      JSON.stringify({ error: "Failed to generate response" }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  }
}
