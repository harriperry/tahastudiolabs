import { json } from "../_utils.js";

/* Relay for ElevenLabs text-to-speech. WHY THIS EXISTS: same reasoning as every other
provider relay in this folder - routing through our own domain avoids ad blockers/
antivirus/VPN silently blocking a direct browser -> api.elevenlabs.io call.

SCOPE CHANGE from elevenlabs-voices.js: that relay only lists voices; this one actually
generates spoken audio from a segment's TTS Script text using the chosen Voice ID, so the
narration can be (a) fed into HeyGen's audio-driven avatar mode for real voice consistency
across segments (see startHeyGenAudio in video-start.js), or (b) downloaded alongside a
Veo clip for the customer to mux in their own editor, since Veo does not accept external
audio as input.

VOICE PASSPORT EXTENSION (backward compatible): the body may also carry modelId,
voiceSettings { stability, similarity_boost, style, speed, use_speaker_boost }, seed,
previousText, nextText and outputFormat. When none are sent the behaviour is exactly what it
was before (eleven_multilingual_v2, default settings, mp3). A locked Voice Passport sends all
of them so every scene is generated with the same model and settings. Raw PCM output
(pcm_16000, pcm_22050, pcm_24000) is returned as application/octet-stream so the browser can
run its voice checks on the samples.

API confirmed via elevenlabs.io/docs/api-reference/text-to-speech (not guessed):
POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}, auth via "xi-api-key" header,
JSON body { text, model_id, voice_settings, seed, previous_text, next_text }, query
output_format, response is raw audio bytes (default mp3_44100_128).

DATA HANDLING: apiKey and text are held in memory only for the duration of this single
request. Audio bytes are streamed straight through - never written to Supabase, KV, or any
log, matching every other relay in this app. */

const MODEL_RE = /^eleven_[a-z0-9_]{1,40}$/;
const FORMAT_RE = /^(mp3_\d{4,5}_\d{2,3}|pcm_\d{4,5}|wav_\d{4,5}|ulaw_8000|alaw_8000|opus_\d{4,5}_\d{2,3})$/;

function num(v, min, max) {
  if (typeof v !== "number" || !isFinite(v)) return undefined;
  return Math.min(max, Math.max(min, v));
}

/* Exported for tests. Returns the clean JSON body to send upstream. */
export function buildUpstreamBody(body) {
  const out = {
    text: body.text,
    model_id: typeof body.modelId === "string" && MODEL_RE.test(body.modelId) ? body.modelId : "eleven_multilingual_v2"
  };
  const vs = body.voiceSettings;
  if (vs && typeof vs === "object") {
    const s = {};
    const stability = num(vs.stability, 0, 1), sim = num(vs.similarity_boost, 0, 1), style = num(vs.style, 0, 1), speed = num(vs.speed, 0.7, 1.2);
    if (stability !== undefined) s.stability = stability;
    if (sim !== undefined) s.similarity_boost = sim;
    if (style !== undefined) s.style = style;
    if (speed !== undefined) s.speed = speed;
    if (typeof vs.use_speaker_boost === "boolean") s.use_speaker_boost = vs.use_speaker_boost;
    if (Object.keys(s).length) out.voice_settings = s;
  }
  if (Number.isInteger(body.seed) && body.seed >= 0 && body.seed <= 4294967295) out.seed = body.seed;
  if (typeof body.previousText === "string" && body.previousText) out.previous_text = body.previousText.slice(0, 1000);
  if (typeof body.nextText === "string" && body.nextText) out.next_text = body.nextText.slice(0, 1000);
  return out;
}

export async function onRequestPost(context) {
const { request } = context;
let body;
try { body = await request.json(); } catch (e) { return json({ error: { message: "Bad request." } }, 400); }

const { apiKey, voiceId, text } = body || {};
if (!apiKey || typeof apiKey !== "string") return json({ error: { message: "Missing ElevenLabs API key." } }, 400);
if (!voiceId || typeof voiceId !== "string") return json({ error: { message: "Missing voice ID." } }, 400);
if (!text || typeof text !== "string") return json({ error: { message: "Missing narration text." } }, 400);

const isPcm = typeof body.outputFormat === "string" && FORMAT_RE.test(body.outputFormat) && /^(pcm|ulaw|alaw)_/.test(body.outputFormat);
const qs = typeof body.outputFormat === "string" && FORMAT_RE.test(body.outputFormat) ? `?output_format=${body.outputFormat}` : "";

let upstream;
try {
upstream = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}${qs}`, {
method: "POST",
headers: { "xi-api-key": apiKey, "Content-Type": "application/json", "Accept": isPcm ? "application/octet-stream" : "audio/mpeg" },
body: JSON.stringify(buildUpstreamBody(body))
});
} catch (e) {
return json({ error: { message: "Our server couldn't reach ElevenLabs just now. Please try again in a moment." } }, 502);
}

if (!upstream.ok) {
const errData = await upstream.json().catch(() => null);
const headers = {};
const ra = upstream.headers.get("retry-after");
if (ra) headers["Retry-After"] = ra;
return json({ error: errData?.detail || { message: `HTTP ${upstream.status}` } }, upstream.status, headers);
}

return new Response(upstream.body, {
status: 200,
headers: {
"Content-Type": isPcm ? "application/octet-stream" : (upstream.headers.get("Content-Type") || "audio/mpeg"),
"Cache-Control": "no-store"
}
});
}
