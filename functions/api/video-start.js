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
    if (provider === "heygen") return await startHeyGen(apiKey, prompt, params || {});
    return json({ error: { message: "Unknown provider." } }, 400);
  } catch (e) {
    return json({ error: { message: "Our server couldn't reach the provider just now. Please try again in a moment." } }, 502);
  }
}

/* Veo 3.1 — https://ai.google.dev/gemini-api/docs/veo
   Reference images: Google's own documented schema (ai.google.dev/gemini-api/docs/video#
   reference-images) requires every reference image object to include a "referenceType": "asset"
   field alongside "image" — every one of Google's own request examples sends it. Enforced here
   server-side too, in case any cached client ever sends the old shape.

   ROUND 2 FIX — the actual image payload shape was ALSO wrong, confirmed by re-reading Google's
   own REST curl example for this exact endpoint (ai.google.dev/gemini-api/docs/video#reference-
   images): the "image" field must be a nested { inlineData: { mimeType, data } } object —
   `"image": {"inlineData": {"mimeType": "image/png", "data": "<base64>"}}` — NOT a flat
   { bytesBase64Encoded, mimeType } object (that flat shape belongs to a different endpoint,
   Imagen's predict API, not Veo's). We were sending the flat shape, which doesn't match Veo's
   schema at all — very likely why reference images were being silently ignored/malformed and a
   different person kept showing up regardless of the referenceType fix above. Client still sends
   { bytesBase64Encoded, mimeType } (see assets/app.js fileToBase64) — wrapped correctly here. */
async function startVeo(apiKey, prompt, params) {
  const instance = { prompt };
  if (params.referenceImages) {
    instance.referenceImages = params.referenceImages.map(r => {
      const mimeType = r.image?.mimeType || r.mimeType || "image/png";
      const data = r.image?.bytesBase64Encoded || r.image?.data || r.data;
      return {
        image: { inlineData: { mimeType, data } },
        referenceType: r.referenceType || "asset"
      };
    });
  }
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

/* Grok Imagine — https://docs.x.ai/developers/rest-api-reference/inference/videos
   Reference-to-video (docs.x.ai/developers/model-capabilities/video/reference-to-video):
   each reference image is passed as { url } where url accepts either a public HTTPS URL or a
   base64 data URI directly — the browser sends us whichever fileToDataUri() produced, and we
   just forward it as-is. Confirmed constraints from that doc: max 7 reference images, max 10s
   duration when reference images are present, and grok-imagine-video-1.5 doesn't support this
   mode (we use the base grok-imagine-video model, which does). */
async function startGrok(apiKey, prompt, params) {
  const body = {
    model: "grok-imagine-video",
    prompt,
    duration: Number(params.duration || 8),
    aspect_ratio: params.aspectRatio || "16:9",
    // The base grok-imagine-video model doesn't support 1080p/4k (that's 1.5-only, and only for
    // image-to-video) — the browser already clamps this to "720p" for Grok, but clamp again here
    // server-side too rather than trust the client alone.
    resolution: params.resolution === "1080p" || params.resolution === "4k" ? "720p" : (params.resolution || "720p")
  };
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

/* HeyGen Video Agent — https://developers.heygen.com/docs/quick-start
   Its CreateVideoAgentRequest schema has no resolution/aspect-ratio field, only "orientation"
   (landscape/portrait, default null = auto-detected from content) — confirmed via the OpenAPI
   schema at developers.heygen.com/reference/create-video-agent-session. We derive it from the
   same Aspect Ratio control used for Veo/Grok so all three providers share one setting. */
async function startHeyGen(apiKey, prompt, params) {
  const body = { prompt };
  if (params.orientation === "landscape" || params.orientation === "portrait") body.orientation = params.orientation;
  const res = await fetch("https://api.heygen.com/v3/video-agents", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Api-Key": apiKey },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) return json({ error: data?.error || { message: `HTTP ${res.status}` } }, res.status);
  return json({ jobRef: { sessionId: data?.data?.session_id, videoId: data?.data?.video_id || null } });
}
