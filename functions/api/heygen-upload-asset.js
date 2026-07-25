import { json } from "../_utils.js";

/* Relay for uploading a file (here: ElevenLabs-generated narration audio) to HeyGen's
Asset Storage, so it can be referenced by asset_id as a custom "audio" voice source on the
Create Avatar Video (V2) endpoint (see startHeyGenAudio in video-start.js). WHY THIS EXISTS:
same cross-origin/ad-blocker reasoning as every other relay in this folder.

API confirmed via developers.heygen.com/reference/upload-asset (not guessed): POST
https://api.heygen.com/v3/assets, header "x-api-key", multipart/form-data with a "file"
field, max 32MB, response shape has varied across HeyGen API versions in the wild, so both
data.asset_id and data.id are checked below rather than assuming one.

The browser can't easily attach an ElevenLabs-fetched audio blob to a real <input type=file>,
so the client instead base64-encodes it and this relay reconstructs a real multipart body
server-side before forwarding to HeyGen — fetch() sets the correct boundary headers for us
automatically once the body is a FormData instance.

DATA HANDLING: apiKey and the audio bytes are held in memory only for the duration of this
single request. Never written to Supabase, KV, or any log. */
export async function onRequestPost(context) {
const { request } = context;
let body;
try { body = await request.json(); } catch (e) { return json({ error: { message: "Bad request." } }, 400); }

const { apiKey, base64, mimeType } = body || {};
if (!apiKey || typeof apiKey !== "string") return json({ error: { message: "Missing HeyGen API key." } }, 400);
if (!base64 || typeof base64 !== "string") return json({ error: { message: "Missing audio data." } }, 400);

let bytes;
try {
const bin = atob(base64);
bytes = new Uint8Array(bin.length);
for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
} catch (e) {
return json({ error: { message: "Could not decode audio data." } }, 400);
}

const form = new FormData();
form.append("file", new Blob([bytes], { type: mimeType || "audio/mpeg" }), "narration.mp3");

let upstream;
try {
upstream = await fetch("https://api.heygen.com/v3/assets", {
method: "POST",
headers: { "x-api-key": apiKey },
body: form
});
} catch (e) {
return json({ error: { message: "Our server couldn't reach HeyGen just now. Please try again in a moment." } }, 502);
}

const data = await upstream.json().catch(() => null);
if (!upstream.ok) return json({ error: data?.error || { message: `HTTP ${upstream.status}` } }, upstream.status);

const assetId = data?.data?.asset_id || data?.data?.id || data?.asset_id || data?.id;
if (!assetId) return json({ error: { message: "HeyGen accepted the upload but returned no asset ID." } }, 502);

return json({ assetId, url: data?.data?.url || null });
}
