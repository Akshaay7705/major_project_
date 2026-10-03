import { API_KEY, API_URL, AVATAR_ID } from "../secrets";

export async function POST() {
  let session_token = "";
  let session_id = "";
  try {
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
          }
        }
      } catch (err) {}
    }

    if (!finalAvatarId || !isUuid(finalAvatarId)) {
      finalAvatarId = "e66d4380-fb12-4fa0-862a-4c5058afc783"; // Fallback to Chandana
    }

    const res = await fetch(`${API_URL}/v1/sessions/token`, {
      method: "POST",
      headers: {
        "X-API-KEY": API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        mode: "CUSTOM",
        avatar_id: finalAvatarId,
      }),
    });

    if (!res.ok) {
      const resp = await res.json().catch(() => ({}));
      console.error(
        "DEBUG: HeyGen API start-custom-session error:",
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
          status: res.status,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const data = await res.json();
    console.log(data);

    session_token = data.data.session_token;
    session_id = data.data.session_id;
  } catch (error: unknown) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
    });
  }

  if (!session_token) {
    return new Response(
      JSON.stringify({ error: "Failed to retrieve session token" }),
      {
        status: 500,
      },
    );
  }
  return new Response(JSON.stringify({ session_token, session_id }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
    },
  });
}
