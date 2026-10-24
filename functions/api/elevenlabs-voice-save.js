import { json } from "../_utils.js";

/* Relay that saves an approved Voice Design candidate as a permanent voice on the customer's
   own ElevenLabs account, so its voice_id can be locked into a Voice Passport.

   API confirmed via elevenlabs.io/docs/api-reference/text-to-voice/create (not guessed):
   POST https://api.elevenlabs.io/v1/text-to-voice, auth via "xi-api-key" header, body
   { voice_name, voice_description, generated_voice_id }, response { voice_id, ... }.

   DATA HANDLING: the API key is held in memory only for the duration of this single request.
   Never written to Supabase, KV, or any log. */
export async function onRequestPost(context) {
  const { request } = context;
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: { message: "Bad request." } }, 400); }

  const { apiKey, generatedVoiceId, name, description } = body || {};
  if (!apiKey || typeof apiKey !== "string") return json({ error: { message: "Missing ElevenLabs API key." } }, 400);
  if (!generatedVoiceId || typeof generatedVoiceId !== "string") return json({ error: { message: "Missing candidate voice." } }, 400);
  if (!name || typeof name !== "string") return json({ error: { message: "Missing voice name." } }, 400);
  const desc = typeof description === "string" && description.trim().length >= 20 ? description.trim().slice(0, 1000) : "Custom voice created in ScriptForge.";

  let res;
  try {
    res = await fetch("https://api.elevenlabs.io/v1/text-to-voice", {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ voice_name: name.trim().slice(0, 100), voice_description: desc, generated_voice_id: generatedVoiceId })
    });
  } catch (e) {
    return json({ error: { message: "Our server couldn't reach ElevenLabs just now. Please try again in a moment." } }, 502);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) return json({ error: data?.detail || { message: `HTTP ${res.status}` } }, res.status);
  if (!data?.voice_id) return json({ error: { message: "ElevenLabs did not return a voice ID." } }, 502);
  return json({ voice_id: data.voice_id });
}
