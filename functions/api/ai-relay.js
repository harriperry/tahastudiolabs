import { json } from "../_utils.js";

/* Anthropic's API does not support direct cross-origin browser fetches from
   arbitrary third-party sites (confirmed: identical requests fail with a
   network-level CORS error from any origin, not just this one — the
   "anthropic-dangerous-direct-browser-access" header only works inside
   Anthropic's own claude.ai sandbox). This relay forwards the request
   server-side instead, so ScriptEngine's bring-your-own-key flow works the
   same way ScriptForge's other BYOK integrations already do (ElevenLabs,
   HeyGen, video generation): the key is used for exactly one outbound
   request and is never stored, logged, or written to Supabase/KV.

   GROK (xAI) SUPPORT: xAI's api.x.ai has the exact same restriction as
   Anthropic, no CORS headers permitting a direct browser fetch from a
   third-party origin like tahastudiolabs.com. Before this, ScriptEngine's
   Grok path called api.x.ai directly from the browser (story-script/app.js),
   which meant it never worked regardless of key validity: the browser
   blocks the request before a response is ever received, surfacing as a
   bare "Failed to fetch" no matter how good the key is. Grok now shares
   this same relay, selected via the "provider" field in the request body
   (defaults to "anthropic" for any older caller that doesn't send one), so
   both providers get identical treatment: key forwarded for one request
   only, normalized to the same { ok, text } / { ok:false, error } shape so
   the client doesn't need provider-aware response parsing. */
const GROK_MODEL_DEFAULT = "grok-4-fast";

export async function onRequestPost(context) {
  const { request } = context;
  let b;
  try { b = await request.json(); } catch (e) { return json({ ok: false, error: "Bad request." }, 400); }

  const { provider, apiKey, model, system, messages, max_tokens } = b;
  const isGrok = provider === "grok";
  if (typeof apiKey !== "string" || !apiKey.trim()) return json({ ok: false, error: `Missing ${isGrok ? "Grok (xAI)" : "Anthropic"} API key.` }, 400);
  if (!Array.isArray(messages) || messages.length === 0) return json({ ok: false, error: "Missing messages." }, 400);

  return isGrok
    ? relayGrok(apiKey, model, system, messages, max_tokens)
    : relayAnthropic(apiKey, model, system, messages, max_tokens);
}

async function relayAnthropic(apiKey, model, system, messages, max_tokens) {
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

/* Grok uses the OpenAI-compatible chat/completions shape (system + user as separate
   message-role entries, reply at choices[0].message.content) rather than Anthropic's
   Messages API shape, so the upstream request/response mapping differs even though the
   calling contract from the browser (provider, apiKey, model, system, messages, max_tokens
   -> { ok, text }) is identical between both branches. The client only ever sends one
   user message (see callAI() in story-script/app.js), so messages[0].content is the
   full user turn. */
async function relayGrok(apiKey, model, system, messages, max_tokens) {
  const userText = messages?.[0]?.content || "";
  let res;
  try {
    res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model || GROK_MODEL_DEFAULT,
        max_tokens: max_tokens || 4096,
        messages: [
          { role: "system", content: system },
          { role: "user", content: userText }
        ]
      })
    });
  } catch (e) {
    return json({ ok: false, error: "Could not reach xAI (Grok)." }, 502);
  }

  let data;
  try { data = await res.json(); } catch (e) { return json({ ok: false, error: `Grok returned an unreadable response (HTTP ${res.status}).` }, 502); }

  if (!res.ok || data?.error) {
    return json({ ok: false, error: data?.error?.message || data?.error || `Grok API error (HTTP ${res.status}).` }, res.status || 500);
  }

  const text = data.choices?.[0]?.message?.content || "";
  return json({ ok: true, text });
}
