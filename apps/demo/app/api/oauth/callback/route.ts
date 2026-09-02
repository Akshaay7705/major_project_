import { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");

  if (!code) {
    return new Response("No authorization code found in callback.", {
      status: 400,
    });
  }

  const CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
  const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
  const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI!;

  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: "authorization_code",
      }),
    });

    const tokenData = await tokenRes.json();

    if (!tokenRes.ok || !tokenData.refresh_token) {
      return new Response(
        `<html><body style="font-family:sans-serif;padding:40px;">
          <h2 style="color:red">❌ Token Exchange Failed</h2>
          <pre>${JSON.stringify(tokenData, null, 2)}</pre>
          <p>Make sure you authorized with the correct Google account.</p>
        </body></html>`,
        { status: 400, headers: { "Content-Type": "text/html" } },
      );
    }

    return new Response(
      `<html><body style="font-family:sans-serif;padding:40px;background:#f0fdf4;">
        <h2 style="color:green">✅ Google OAuth Success!</h2>
        <p>Copy this <strong>Refresh Token</strong> and paste it into your <code>.env.local</code> as <code>GOOGLE_REFRESH_TOKEN</code>:</p>
        <textarea rows="5" cols="80" style="font-family:monospace;font-size:13px;padding:10px;">${tokenData.refresh_token}</textarea>
        <br/><br/>
        <p style="color:#555">Also make sure <code>NIE_OFFICE_EMAIL</code> is set in <code>.env.local</code> to the Google account email you used.</p>
        <p>Then restart the dev server with <code>pnpm demo</code>.</p>
      </body></html>`,
      { status: 200, headers: { "Content-Type": "text/html" } },
    );
  } catch (e: any) {
    return new Response(`Error: ${e.message}`, { status: 500 });
  }
}
