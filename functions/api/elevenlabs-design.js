import { json } from "../_utils.js";

/* Relay for ElevenLabs Voice Design: turns a written description into 3 candidate voices.
   Each candidate comes back with a generated_voice_id and a short base64 audio preview. A
   candidate is NOT a permanent voice until it is saved through /api/elevenlabs-voice-save.

   API confirmed via elevenlabs.io/docs/api-reference/text-to-voice/design (not guessed):
   POST https://api.elevenlabs.io/v1/text-to-voice/design, auth via "xi-api-key" header, body
   { voice_description, model_id, text | auto_generate_text }, response
   { previews: [{ generated_voice_id, audio_base_64, media_type, duration_secs }], text }.
   The API key needs the Text to Voice permission.

   DATA HANDLING: the API key is held in memory only for the duration of this single request.
   Never written to Supabase, KV, or any log. */
export async function onRequestPost(context) {
  const { request } = context;
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: { message: "Bad request." } }, 400); }

  const { apiKey, description } = body || {};
  if (!apiKey || typeof apiKey !== "string") return json({ error: { message: "Missing ElevenLabs API key." } }, 400);
  if (!description || typeof description !== "string" || description.trim().length < 20) {
    return json({ error: { message: "Describe the voice in at least 20 characters: age, accent, energy and style." } }, 400);
  }
  const payload = {
    voice_description: description.trim().slice(0, 1000),
    model_id: "eleven_multilingual_ttv_v2",
    auto_generate_text: true
  };

  let res;
  try {
    res = await fetch("https://api.elevenlabs.io/v1/text-to-voice/design?output_format=mp3_44100_128", {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  } catch (e) {
    return json({ error: { message: "Our server couldn't reach ElevenLabs just now. Please try again in a moment." } }, 502);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) return json({ error: data?.detail || { message: `HTTP ${res.status}` } }, res.status);

  const previews = (data?.previews || []).map(p => ({
    generated_voice_id: p.generated_voice_id,
    audio_base_64: p.audio_base_64,
    media_type: p.media_type || "audio/mpeg",
    duration_secs: p.duration_secs
  }));
  if (!previews.length) return json({ error: { message: "ElevenLabs returned no candidate voices. Try a more detailed description." } }, 502);
  return json({ previews, text: data?.text || "" });
}
