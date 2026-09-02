import {
  API_KEY,
  API_URL,
  AVATAR_ID,
  VOICE_ID,
  CONTEXT_ID,
  LANGUAGE,
} from "../secrets";

import { checkRateLimit, isValidLanguage } from "../../../lib/security";
import { NextRequest } from "next/server";

export async function POST(req: Request) {
  // 1. Security: Strict Rate Limit for Session Creation (Expensive)
  const nextReq = req as unknown as NextRequest;
  if (!checkRateLimit(nextReq, 5, 60 * 1000)) {
    // 5 sessions per minute per IP
    return new Response(
      JSON.stringify({ error: "Rate limit exceeded. Try again later." }),
      { status: 429 },
    );
  }

  let session_token = "";
  let session_id = "";
  try {
    if (
      !API_KEY ||
      API_KEY === "YOUR_API_KEY" ||
      API_KEY === "YOUR_HEYGEN_API_KEY"
    ) {
      return new Response(
        JSON.stringify({
          error:
            "HeyGen API Key is missing or invalid. Please update HEYGEN_API_KEY in apps/demo/.env.local",
        }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
    }

    const body = await req.json().catch(() => ({}));
    let language = body.language || LANGUAGE;

    // 2. Security: Validate inputs before external API call
    if (language && !isValidLanguage(language)) {
      console.warn(
        `SECURITY: Blocked invalid language in start-session: "${language}"`,
      );
      language = LANGUAGE; // Fallback
    }

    const persona: Record<string, any> = {
      language: language,
      instructions:
        "You are NIE-Bot, official virtual assistant for The National Institute of Engineering (NIE), Mysuru. Answer only about NIE Mysuru (courses, admissions, KCET, cutoffs, hostels, placements) or schedule meetings with the admissions office. Do not talk about general business consulting or unrelated topics.",
    };
    if (
      VOICE_ID &&
      VOICE_ID !== "YOUR_VOICE_ID" &&
      VOICE_ID !== "YOUR_HEYGEN_VOICE_ID"
    ) {
      persona.voice_id = VOICE_ID;
    }
    if (
      CONTEXT_ID &&
      CONTEXT_ID !== "YOUR_CONTEXT_ID" &&
      CONTEXT_ID !== "YOUR_HEYGEN_CONTEXT_ID"
    ) {
      persona.context_id = CONTEXT_ID;
    }

    const res = await fetch(`${API_URL}/v1/sessions/token`, {
      method: "POST",
      headers: {
        "X-API-KEY": API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        mode: "FULL",
        avatar_id: AVATAR_ID,
        avatar_persona: persona,
      }),
    });
    if (!res.ok) {
      const resp = await res.json().catch(() => ({}));
      console.error(
        "DEBUG: HeyGen API start-session error:",
        JSON.stringify(resp),
      );
      const errorMessage =
        resp?.data?.[0]?.message ||
        resp?.data?.message ||
        resp?.message ||
        resp?.error ||
        `Failed to retrieve session token (HTTP ${res.status})`;

      // Smart fallback: If custom avatar_id or voice_id was not found, retry with default public Avatar ID
      if (
        errorMessage.toLowerCase().includes("avatar not found") ||
        errorMessage.toLowerCase().includes("voice")
      ) {
        console.warn("DEBUG: Retrying with default public HeyGen avatar ID...");
        const fallbackRes = await fetch(`${API_URL}/v1/sessions/token`, {
          method: "POST",
          headers: {
            "X-API-KEY": API_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            mode: "FULL",
            avatar_id: "dd73ea75-1218-4ef3-92ce-606d5f7fbc0a",
            avatar_persona: {
              language: language,
            },
          }),
        });
        if (fallbackRes.ok) {
          const fallbackData = await fallbackRes.json();
          return new Response(
            JSON.stringify({
              session_token: fallbackData.data.session_token,
              session_id: fallbackData.data.session_id,
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
      }

      return new Response(JSON.stringify({ error: errorMessage }), {
        status: res.status,
        headers: { "Content-Type": "application/json" },
      });
    }
    const data = await res.json();

    session_token = data.data.session_token;
    session_id = data.data.session_id;
  } catch (error) {
    console.error("Error retrieving session token:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
    });
  }

  if (!session_token) {
    return new Response("Failed to retrieve session token", {
      status: 500,
    });
  }
  return new Response(JSON.stringify({ session_token, session_id }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
    },
  });
}
