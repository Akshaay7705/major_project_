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
  if (!checkRateLimit(nextReq, 5, 60 * 1000)) { // 5 sessions per minute per IP
    return new Response(JSON.stringify({ error: "Rate limit exceeded. Try again later." }), { status: 429 });
  }

  let session_token = "";
  let session_id = "";
  try {
    const body = await req.json().catch(() => ({}));
    let language = body.language || LANGUAGE;

    // 2. Security: Validate inputs before external API call
    if (language && !isValidLanguage(language)) {
      console.warn(`SECURITY: Blocked invalid language in start-session: "${language}"`);
      language = LANGUAGE; // Fallback
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
        avatar_persona: {
          voice_id: VOICE_ID,
          context_id: CONTEXT_ID,
          language: language,
        },
      }),
    });
    if (!res.ok) {
      const resp = await res.json();
      const errorMessage =
        resp.data[0].message ?? "Failed to retrieve session token";
      return new Response(JSON.stringify({ error: errorMessage }), {
        status: res.status,
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
