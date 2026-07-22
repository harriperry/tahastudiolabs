import { json } from "../_utils.js";

/* Relay for downloading the finished video bytes. Beyond the CORS-interference reason
   shared with format.js and the other video-*.js relays, this specifically also solves
   the Grok Imagine CDN issue found during pilot testing: vidgen.x.ai blocks JS fetch()
   from arbitrary origins, so a direct browser download never worked for Grok even though
   generation itself did. Routing the download through our own domain sidesteps that
   entirely, since the provider fetch happens server-to-server (no CORS applies there).
   DATA HANDLING: apiKey is used only to authenticate this one upstream request, in memory,
   then discarded. The video bytes are streamed straight through — never written to disk,
   Supabase, KV, or any log. */
export async function onRequestPost(context) {
  const { request } = context;
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: { message: "Bad request." } }, 400); }

  const { provider, apiKey, uri } = body || {};
  if (!apiKey || typeof apiKey !== "string") return json({ error: { message: "Missing API key." } }, 400);
  if (!uri || typeof uri !== "string") return json({ error: { message: "Missing video URI." } }, 400);

  const headers = {};
  if (provider === "veo") headers["x-goog-api-key"] = apiKey;
  else if (provider === "grok") headers["Authorization"] = `Bearer ${apiKey}`;
  else if (provider === "heygen") headers["X-Api-Key"] = apiKey;

  let upstream;
  try {
    upstream = await fetch(uri, Object.keys(headers).length ? { headers } : undefined);
    if (!upstream.ok && Object.keys(headers).length) {
      // Some hosts (e.g. signed CDN links) reject an unnecessary auth header on an
      // already-authorized URL — retry with no header before giving up.
      upstream = await fetch(uri);
    }
  } catch (e) {
    return json({ error: { message: "Our server couldn't reach the video host just now. Please try again in a moment." } }, 502);
  }
  if (!upstream.ok) return json({ error: { message: `Video host returned HTTP ${upstream.status}` } }, upstream.status);

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": upstream.headers.get("Content-Type") || "video/mp4",
      "Cache-Control": "no-store"
    }
  });
}
