import { json } from "../_utils.js";

/* Relay for polling a video generation job — see video-start.js for why this is a relay
   rather than a direct browser→provider call. The server holds no state between calls:
   the client sends back whatever jobRef it was last given, and gets an updated jobRef
   (if relevant, e.g. HeyGen's videoId being assigned mid-flight) plus a done/uri result.
   Nothing here is written to Supabase, KV, or any log. */
export async function onRequestPost(context) {
  const { request } = context;
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: { message: "Bad request." } }, 400); }

  const { provider, apiKey, jobRef } = body || {};
  if (!apiKey || typeof apiKey !== "string") return json({ error: { message: "Missing API key." } }, 400);
  if (!jobRef) return json({ error: { message: "Missing jobRef." } }, 400);

  try {
    if (provider === "veo") return await pollVeo(apiKey, jobRef);
    if (provider === "grok") return await pollGrok(apiKey, jobRef);
    if (provider === "heygen") return await pollHeyGen(apiKey, jobRef);
    return json({ error: { message: "Unknown provider." } }, 400);
  } catch (e) {
    return json({ error: { message: "Our server couldn't reach the provider just now. Please try again in a moment." } }, 502);
  }
}

async function pollVeo(apiKey, jobRef) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/${jobRef.opName}`, {
    headers: { "x-goog-api-key": apiKey }
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) return json({ error: data?.error || { message: `HTTP ${res.status}` } }, res.status);
  if (!data.done) return json({ done: false, jobRef });
  if (data.error) return json({ error: data.error }, 500);
  const uri = findUriDeep(data.response);
  if (!uri) return json({ error: { message: "Job finished but no video URI was found." } }, 500);
  return json({ done: true, uri, jobRef });
}

async function pollGrok(apiKey, jobRef) {
  const res = await fetch(`https://api.x.ai/v1/videos/${jobRef.requestId}`, {
    headers: { "Authorization": `Bearer ${apiKey}` }
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) return json({ error: data?.error || { message: `HTTP ${res.status}` } }, res.status);
  if (data.status === "failed") return json({ error: { message: "Grok reported the job failed." } }, 500);
  if (data.status === "done" || data?.video?.url) return json({ done: true, uri: data.video.url, jobRef });
  return json({ done: false, jobRef });
}

async function pollHeyGen(apiKey, jobRef) {
  let { sessionId, videoId } = jobRef;
  if (!videoId) {
    const res = await fetch(`https://api.heygen.com/v3/video-agents/${sessionId}`, { headers: { "X-Api-Key": apiKey } });
    const data = await res.json().catch(() => null);
    if (!res.ok) return json({ error: data?.error || { message: `HTTP ${res.status}` } }, res.status);
    videoId = data?.data?.video_id || null;
    if (!videoId) return json({ done: false, jobRef: { sessionId, videoId: null } });
  }
  const res = await fetch(`https://api.heygen.com/v3/videos/${videoId}`, { headers: { "X-Api-Key": apiKey } });
  const data = await res.json().catch(() => null);
  if (!res.ok) return json({ error: data?.error || { message: `HTTP ${res.status}` } }, res.status);
  const status = data?.data?.status;
  if (status === "failed") return json({ error: { message: "HeyGen reported the render failed." } }, 500);
  if (status === "completed") return json({ done: true, uri: data.data.video_url, jobRef: { sessionId, videoId } });
  return json({ done: false, jobRef: { sessionId, videoId } });
}

/* Confirmed field path from a real completed Veo job:
   response.generateVideoResponse.generatedSamples[0].video.uri — with a generic fallback
   scan in case Google varies the shape for other parameter combos. */
function findUriDeep(obj) {
  const direct = obj?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
  if (typeof direct === "string") return direct;
  if (!obj || typeof obj !== "object") return null;
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (typeof val === "string" && /^https?:\/\//.test(val) && /uri|url/i.test(key)) return val;
    if (typeof val === "object") { const found = findUriDeep(val); if (found) return found; }
  }
  return null;
}
