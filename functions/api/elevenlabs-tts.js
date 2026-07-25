import { json } from "../_utils.js";

/* Relay for ElevenLabs text-to-speech. WHY THIS EXISTS: same reasoning as every other
provider relay in this folder — routing through our own domain avoids ad blockers/
antivirus/VPN silently blocking a direct browser -> api.elevenlabs.io call.

SCOPE CHANGE from elevenlabs-voices.js: that relay only lists voices; this one actually
generates spoken audio from a segment's TTS Script text using the chosen Voice ID, so the
narration can be (a) fed into HeyGen's audio-driven avatar mode for real voice consistency
across segments (see startHeyGenAudio in video-start.js), or (b) downloaded alongside a
Veo/Grok clip for the customer to mux in their own editor, since neither of those providers
accepts external audio as input.

API confirmed via elevenlabs.io/docs/api-reference/text-to-speech (not guessed):
POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}, auth via "xi-api-key" header,
JSON body { text, model_id }, response is raw audio bytes (default mp3_44100_128).

DATA HANDLING: apiKey and text are held in memory only for the duration of this single
request. Audio bytes are streamed straight through — never written to Supabase, KV, or any
log, matching every other relay in this app. */
export async function onRequestPost(context) {
const { request } = context;
let body;
try { body = await request.json(); } catch (e) { return json({ error: { message: "Bad request." } }, 400); }

const { apiKey, voiceId, text } = body || {};
if (!apiKey || typeof apiKey !== "string") return json({ error: { message: "Missing ElevenLabs API key." } }, 400);
if (!voiceId || typeof voiceId !== "string") return json({ error: { message: "Missing voice ID." } }, 400);
if (!text || typeof text !== "string") return json({ error: { message: "Missing narration text." } }, 400);

let upstream;
try {
upstream = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
method: "POST",
headers: { "xi-api-key": apiKey, "Content-Type": "application/json", "Accept": "audio/mpeg" },
body: JSON.stringify({ text, model_id: "eleven_multilingual_v2" })
});
} catch (e) {
return json({ error: { message: "Our server couldn't reach ElevenLabs just now. Please try again in a moment." } }, 502);
}

if (!upstream.ok) {
const errData = await upstream.json().catch(() => null);
return json({ error: errData?.detail || { message: `HTTP ${upstream.status}` } }, upstream.status);
}

return new Response(upstream.body, {
status: 200,
headers: {
"Content-Type": upstream.headers.get("Content-Type") || "audio/mpeg",
"Cache-Control": "no-store"
}
});
}
