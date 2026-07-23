import { json } from "../_utils.js";

/* Relay for starting a video generation job with the customer's own API key.
   WHY THIS EXISTS: same reasoning as functions/api/format.js — a direct browser→provider
   call works in clean testing but can be silently blocked by real customers' ad blockers,
   antivirus web-shields, or VPNs (confirmed behavior with the Anthropic integration). This
   relay makes the browser call our own domain instead; the provider call happens server-to-
   server, where CORS/extension interference cannot apply.
   DATA HANDLING: apiKey and prompt text are held in memory only for the duration of this
   single request. Never written to Supabase, KV, or any log. */
export async function onRequestPost(context) {
  const { request } = context;
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: { message: "Bad request." } }, 400); }

  const { provider, apiKey, prompt, params } = body || {};
  if (!apiKey || typeof apiKey !== "string") return json({ error: { message: "Missing API key." } }, 400);
  if (!prompt || typeof prompt !== "string") return json({ error: { message: "Missing prompt." } }, 400);

  try {
    if (provider === "veo") return await startVeo(apiKey, prompt, params || {});
    if (provider === "grok") return await startGrok(apiKey, prompt, params || {});
    if (provider === "heygen") return await startHeyGen(apiKey, prompt);
    return json({ error: { message: "Unknown provider." } }, 400);
  } catch (e) {
    return json({ error: { message: "Our server couldn't reach the provider just now. Please try again in a moment." } }, 502);
  }
}

/* Veo 3.1 — https://ai.google.dev/gemini-api/docs/veo */
async function startVeo(apiKey, prompt, params) {
  const instance = { prompt };
  if (params.referenceImages) instance.referenceImages = params.referenceImages;
  const parameters = {
    aspectRatio: params.aspectRatio || "16:9",
    durationSeconds: Number(params.durationSeconds || 8),
    resolution: params.resolution || "720p",
    personGeneration: "allow_adult"
  };
  const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models/veo-3.1-generate-preview:predictLongRunning", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({ instances: [instance], parameters })
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) return json({ error: data?.error || { message: `HTTP ${res.status}` } }, res.status);
  return json({ jobRef: { opName: data.name } });
}

/* Grok Imagine — https://docs.x.ai/developers/rest-api-reference/inference/videos */
async function startGrok(apiKey, prompt, params) {
  const body = { model: "grok-imagine-video", prompt, duration: Number(params.duration || 8) };
  if (Array.isArray(params.referenceImages) && params.referenceImages.length) {
    body.reference_images = params.referenceImages.slice(0, 7).map(r => ({ url: r.url }));
    if (body.duration > 10) body.duration = 10;
  }
  const res = await fetch("https://api.x.ai/v1/videos/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) return json({ error: data?.error || { message: `HTTP ${res.status}` } }, res.status);
  return json({ jobRef: { requestId: data.request_id } });
}

/* HeyGen Video Agent — https://developers.heygen.com/docs/quick-start */
async function startHeyGen(apiKey, prompt) {
  const res = await fetch("https://api.heygen.com/v3/video-agents", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Api-Key": apiKey },
    body: JSON.stringify({ prompt })
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) return json({ error: data?.error || { message: `HTTP ${res.status}` } }, res.status);
  return json({ jobRef: { sessionId: data?.data?.session_id, videoId: data?.data?.video_id || null } });
}
