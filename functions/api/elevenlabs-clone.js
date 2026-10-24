import { json } from "../_utils.js";

/* Relay for ElevenLabs Instant Voice Cloning. The browser sends multipart form data with the
   customer's own key, a voice name and 1 to 5 clean audio samples. The samples are forwarded
   to ElevenLabs and dropped; nothing is stored here.

   API confirmed via elevenlabs.io/docs/api-reference/voices/ivc/create (not guessed):
   POST https://api.elevenlabs.io/v1/voices/add, auth via "xi-api-key" header, multipart fields
   name, files (repeated), remove_background_noise, response { voice_id, requires_verification }.
   The API key needs the Voices write permission, and the plan must include voice cloning.

   Only clone a voice you own or have written permission to use. The page says so too.

   DATA HANDLING: key and audio are held in memory only for the duration of this single
   request. Never written to Supabase, KV, or any log. */
const MAX_FILES = 5;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;

export async function onRequestPost(context) {
  const { request } = context;
  let form;
  try { form = await request.formData(); } catch (e) { return json({ error: { message: "Bad request." } }, 400); }

  const apiKey = form.get("apiKey");
  const name = form.get("name");
  const files = form.getAll("files").filter(f => f && typeof f === "object" && typeof f.arrayBuffer === "function");
  if (!apiKey || typeof apiKey !== "string") return json({ error: { message: "Missing ElevenLabs API key." } }, 400);
  if (!name || typeof name !== "string") return json({ error: { message: "Missing voice name." } }, 400);
  if (!files.length) return json({ error: { message: "Add at least one audio sample." } }, 400);
  if (files.length > MAX_FILES) return json({ error: { message: `Use at most ${MAX_FILES} samples.` } }, 400);
  const total = files.reduce((n, f) => n + (f.size || 0), 0);
  if (total > MAX_TOTAL_BYTES) return json({ error: { message: "Samples are too large. Keep them under 20 MB in total." } }, 413);

  const out = new FormData();
  out.set("name", name.trim().slice(0, 100));
  out.set("remove_background_noise", "false");
  for (const f of files) out.append("files", f, f.name || "sample.wav");

  let res;
  try {
    res = await fetch("https://api.elevenlabs.io/v1/voices/add", { method: "POST", headers: { "xi-api-key": apiKey }, body: out });
  } catch (e) {
    return json({ error: { message: "Our server couldn't reach ElevenLabs just now. Please try again in a moment." } }, 502);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) return json({ error: data?.detail || { message: `HTTP ${res.status}` } }, res.status);
  if (!data?.voice_id) return json({ error: { message: "ElevenLabs did not return a voice ID." } }, 502);
  return json({ voice_id: data.voice_id, requires_verification: !!data.requires_verification });
}
