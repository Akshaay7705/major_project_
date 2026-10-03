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

    // 3. Avatar ID resolution: UUID validation & automatic discovery fallback
    let finalAvatarId = AVATAR_ID;
    const isUuid = (str: string) =>
      /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
        str,
      );

    if (
      !finalAvatarId ||
      finalAvatarId === "YOUR_AVATAR_ID" ||
      !isUuid(finalAvatarId)
    ) {
      console.log(
        "DEBUG: Invalid or missing avatar_id UUID. Attempting to discover an available avatar...",
      );
      try {
        const avatarsRes = await fetch(`${API_URL}/v1/avatars`, {
          headers: { "X-API-KEY": API_KEY },
        });
        if (avatarsRes.ok) {
          const avatarsData = await avatarsRes.json();
          const activeAvatars = avatarsData?.data?.results?.filter(
            (a: any) => a.status === "ACTIVE",
          );
          if (activeAvatars && activeAvatars.length > 0) {
            finalAvatarId = activeAvatars[0].id;
            console.log(
              `DEBUG: Discovered and using active avatar: ${finalAvatarId} (${activeAvatars[0].name})`,
            );

            // Try to use the default voice if we don't have one configured
            if (!persona.voice_id && activeAvatars[0].default_voice?.id) {
              persona.voice_id = activeAvatars[0].default_voice.id;
            }
          }
        } else {
          console.error(
            "DEBUG: Failed to fetch avatars list:",
            await avatarsRes.text(),
          );
        }
      } catch (err) {
        console.error("DEBUG: Error discovering avatars:", err);
      }
    }

    if (!finalAvatarId || !isUuid(finalAvatarId)) {
      // Ultimate fallback if discovery fails
      finalAvatarId = "e66d4380-fb12-4fa0-862a-4c5058afc783"; // Chandana
    }

    const res = await fetch(`${API_URL}/v1/sessions/token`, {
      method: "POST",
      headers: {
        "X-API-KEY": API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        mode: "FULL",
        avatar_id: finalAvatarId,
        avatar_persona: persona,
      }),
    });

    if (!res.ok) {
      const resp = await res.json().catch(() => ({}));
      console.error(
        "DEBUG: HeyGen API start-session error:",
        JSON.stringify(resp, null, 2),
      );

      const errorMessage =
        resp?.error ||
        resp?.message ||
        resp?.data?.message ||
        resp?.data?.[0]?.message ||
        `HeyGen API Error: HTTP ${res.status}`;

      return new Response(
        JSON.stringify({ error: errorMessage, details: resp }),
        {
          status: res.status, // Often 422 if invalid
          headers: { "Content-Type": "application/json" },
        },
      );
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
