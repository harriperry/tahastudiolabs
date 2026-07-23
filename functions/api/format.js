import { json } from "../_utils.js";
/* Relay for the script-formatting call.
   WHY THIS EXISTS: calling api.anthropic.com directly from the browser (the
   original v7 design) works fine on a clean browser, but is silently blocked by
   a meaningful share of real-world setups — ad blockers, antivirus "web shield"
   extensions, and corporate VPN/proxies all commonly intercept unfamiliar
   cross-origin fetches with custom headers. That surfaces to paying customers as
   a bare "Failed to fetch" with no path to fix it themselves. Routing the call
   through our own origin (same-origin, browser -> tahastudiolabs.com/api/format)
   removes that entire failure class, since it's no longer a cross-origin
   request from the browser's point of view.

   PROVIDERS: originally Anthropic-only. Extended to also support Google Gemini
   and Groq so people without an Anthropic budget can still use ScriptForge for
   free — both have genuine free tiers (no credit card, confirmed July 2026).
   Each provider has its own request/response shape, so this relay translates
   both directions: it builds the right upstream request, then NORMALIZES every
   provider's response into Anthropic's { content: [{type:"text", text}] } shape
   before it reaches the browser. That means the entire rendering pipeline
   (segment parsing, Library, PDF export) needs zero provider-aware changes —
   it only ever sees one response format, regardless of which provider answered.

   DATA HANDLING: the script text and API key pass through this function's
   memory for the lifetime of a single request only. Nothing here is written to
   Supabase, KV, disk, or any log — the key and script are used once to make the
   upstream call and are discarded the instant the response is returned. See
   privacy.html §1 for the accurate description of this flow. */
/* HARD BAN ON EM DASHES — the user does not want "—" anywhere in generated dialogue/script
   output, regardless of which provider wrote it. buildSystemPrompt() (assets/app.js) also
   instructs every model not to use one, but instructions alone are not a guarantee — models
   still slip one in occasionally. This is the actual enforcement: every provider's text passes
   through here, right before it reaches the browser, so no em dash can survive regardless of
   model compliance. Replaces "—" (with or without surrounding spaces) with a comma, which reads
   naturally in the vast majority of real sentence positions an em dash appears in. */
function stripEmDashes(text) {
  return typeof text === "string" ? text.replace(/\s*—\s*/g, ", ") : text;
}

export async function onRequestPost(context) {
  const { request } = context;
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: { message: "Bad request." } }, 400); }

  const { provider, apiKey, model, max_tokens, system, messages } = body || {};
  if (!apiKey || typeof apiKey !== "string") return json({ error: { message: "Missing API key." } }, 400);
  if (!Array.isArray(messages) || !messages.length) return json({ error: { message: "Missing messages." } }, 400);

  try {
    if (provider === "gemini") return await formatGemini(apiKey, model, max_tokens, system, messages);
    if (provider === "groq") return await formatGroq(apiKey, model, max_tokens, system, messages);
    return await formatAnthropic(apiKey, model, max_tokens, system, messages);
  } catch (e) {
    return json({ error: { message: "Our server couldn't reach the provider just now. Please try again in a moment." } }, 502);
  }
}

/* Anthropic Messages API — the original/default path, unchanged in request shape. Response
   used to be passed through completely as-is; now it's parsed just enough to run every text
   block through stripEmDashes() before re-serializing, since Claude is just as capable of
   producing an em dash as any other provider and the ban applies regardless of provider. */
async function formatAnthropic(apiKey, model, max_tokens, system, messages) {
  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({ model, max_tokens, system, messages })
  });
  const text = await upstream.text();
  if (!upstream.ok) {
    return new Response(text, {
      status: upstream.status,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
    });
  }
  let data;
  try { data = JSON.parse(text); } catch (e) {
    return new Response(text, {
      status: upstream.status,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
    });
  }
  if (Array.isArray(data.content)) {
    data.content = data.content.map(b => b && b.type === "text" ? { ...b, text: stripEmDashes(b.text) } : b);
  }
  return new Response(JSON.stringify(data), {
    status: upstream.status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}

/* Google Gemini — generateContent (ai.google.dev/gemini-api/docs/text-generation).
   Deliberately using this classic endpoint rather than Google's newer Interactions API:
   generateContent still fully supports a plain system_instruction + contents +
   generationConfig.maxOutputTokens request with none of the deprecated-sampling-parameter
   churn that only affects the newest 3.6/3.5 models — and we never send temperature/top_p/
   top_k anyway, so this is the lower-risk, more stable integration point. */
async function formatGemini(apiKey, model, max_tokens, system, messages) {
  const userText = messages.map(m => m.content).join("\n\n");
  let res;
  try {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model || "gemini-2.5-flash")}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system || "" }] },
        contents: [{ role: "user", parts: [{ text: userText }] }],
        generationConfig: { maxOutputTokens: Number(max_tokens || 4096) }
      })
    });
  } catch (e) {
    return json({ error: { message: "Our server couldn't reach Google's Gemini API just now. Please try again in a moment." } }, 502);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) return json({ error: data?.error || { message: `HTTP ${res.status}` } }, res.status);
  const text = stripEmDashes((data?.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join("").trim());
  if (!text) return json({ error: { message: "Gemini returned an empty response — try again, or double-check your key/model at aistudio.google.com." } }, 502);
  return json({ content: [{ type: "text", text }] });
}

/* Groq — OpenAI-compatible chat completions (console.groq.com/docs/openai). Same response
   normalization as Gemini above, into Anthropic's { content: [...] } shape. */
async function formatGroq(apiKey, model, max_tokens, system, messages) {
  let res;
  try {
    res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: model || "llama-3.3-70b-versatile",
        max_tokens: Number(max_tokens || 4096),
        messages: [{ role: "system", content: system || "" }, ...messages]
      })
    });
  } catch (e) {
    return json({ error: { message: "Our server couldn't reach Groq's API just now. Please try again in a moment." } }, 502);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) return json({ error: data?.error || { message: `HTTP ${res.status}` } }, res.status);
  const text = stripEmDashes((data?.choices?.[0]?.message?.content || "").trim());
  if (!text) return json({ error: { message: "Groq returned an empty response — try again, or double-check your key/model at console.groq.com." } }, 502);
  return json({ content: [{ type: "text", text }] });
}
