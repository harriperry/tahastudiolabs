import { json } from "../_utils.js";

/* Relay for fetching the customer's own ElevenLabs voice list.
   WHY THIS EXISTS: same reasoning as functions/api/format.js and functions/api/video-start.js —
   routing through our own domain avoids ad blockers/antivirus/VPN silently blocking a direct
   browser -> api.elevenlabs.io call.

   SCOPE: this is a voice-ID picker only, not a text-to-speech generator. ScriptForge does not
   call ElevenLabs to generate audio — it fetches the customer's voice list so they can pick a
   Voice ID, which is then written into the script's TECHNICAL SPECS block for use downstream
   (e.g. pasted into HeyGen, or used with their own ElevenLabs TTS workflow outside this app).

   API confirmed via elevenlabs.io/docs/api-reference/voices/search (not guessed): GET
   https://api.elevenlabs.io/v2/voices, auth via the "xi-api-key" header, response shape
   { voices: [{ voice_id, name, category, ... }], has_more, ... }.

   DATA HANDLING: the API key is held in memory only for the duration of this single request.
   Never written to Supabase, KV, or any log. */
export async function onRequestPost(context) {
  const { request } = context;
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: { message: "Bad request." } }, 400); }

  const { apiKey } = body || {};
  if (!apiKey || typeof apiKey !== "string") return json({ error: { message: "Missing API key." } }, 400);

  let res;
  try {
    res = await fetch("https://api.elevenlabs.io/v2/voices?page_size=100", {
      method: "GET",
      headers: { "xi-api-key": apiKey }
    });
  } catch (e) {
    return json({ error: { message: "Our server couldn't reach ElevenLabs just now. Please try again in a moment." } }, 502);
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) return json({ error: data?.detail || { message: `HTTP ${res.status}` } }, res.status);

  const voices = (data?.voices || []).map(v => ({
    voice_id: v.voice_id,
    name: v.name,
    category: v.category || null
  }));
  if (!voices.length) return json({ error: { message: "No voices found on this ElevenLabs account — add or clone a voice at elevenlabs.io first." } }, 502);

  return json({ voices });
}
