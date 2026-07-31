import { json } from "../_utils.js";

/* Anthropic's API does not support direct cross-origin browser fetches from
   arbitrary third-party sites (confirmed: identical requests fail with a
   network-level CORS error from any origin, not just this one — the
   "anthropic-dangerous-direct-browser-access" header only works inside
   Anthropic's own claude.ai sandbox). This relay forwards the request
   server-side instead, so ScriptEngine's bring-your-own-key flow works the
   same way ScriptForge's other BYOK integrations already do (ElevenLabs,
   HeyGen, video generation): the key is used for exactly one outbound
   request and is never stored, logged, or written to Supabase/KV. */
export async function onRequestPost(context) {
  const { request, env } = context;
  let b;
  try { b = await request.json(); } catch (e) { return json({ ok: false, error: "Bad request." }, 400); }

  const { apiKey, model, system, messages, max_tokens } = b;
  if (typeof apiKey !== "string" || !apiKey.trim()) return json({ ok: false, error: "Missing Anthropic API key." }, 400);
  if (!Array.isArray(messages) || messages.length === 0) return json({ ok: false, error: "Missing messages." }, 400);

  let res;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: model || "claude-sonnet-5",
        max_tokens: max_tokens || 4096,
        system,
        messages
      })
    });
  } catch (e) {
    return json({ ok: false, error: "Could not reach Anthropic." }, 502);
  }

  let data;
  try { data = await res.json(); } catch (e) { return json({ ok: false, error: `Anthropic returned an unreadable response (HTTP ${res.status}).` }, 502); }

  if (!res.ok || data?.type === "error") {
    return json({ ok: false, error: data?.error?.message || `Anthropic API error (HTTP ${res.status}).` }, res.status || 500);
  }

  const text = data.content?.find(c => c.type === "text")?.text || "";
  return json({ ok: true, text });
}
