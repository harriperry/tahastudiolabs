import { json } from "../_utils.js";
/* Relay for the Anthropic Messages API call.
   WHY THIS EXISTS: calling api.anthropic.com directly from the browser (the
   original v7 design) works fine on a clean browser, but is silently blocked by
   a meaningful share of real-world setups — ad blockers, antivirus "web shield"
   extensions, and corporate VPN/proxies all commonly intercept unfamiliar
   cross-origin fetches with custom headers. That surfaces to paying customers as
   a bare "Failed to fetch" with no path to fix it themselves. Routing the call
   through our own origin (same-origin, browser -> tahastudiolabs.com/api/format)
   removes that entire failure class, since it's no longer a cross-origin
   request from the browser's point of view.

   DATA HANDLING: the script text and Anthropic API key pass through this
   function's memory for the lifetime of a single request only. Nothing here is
   written to Supabase, KV, disk, or any log — the key and script are used once
   to make the upstream call and are discarded the instant the response is
   returned. See privacy.html §1 for the updated, accurate description of this
   flow (previously the site said the key "never leaves your browser," which
   stopped being true the moment this relay was introduced). */
export async function onRequestPost(context) {
  const { request } = context;
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: { message: "Bad request." } }, 400); }

  const { apiKey, model, max_tokens, system, messages } = body || {};
  if (!apiKey || typeof apiKey !== "string") return json({ error: { message: "Missing API key." } }, 400);
  if (!Array.isArray(messages) || !messages.length) return json({ error: { message: "Missing messages." } }, 400);

  let upstream;
  try {
    upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({ model, max_tokens, system, messages })
    });
  } catch (e) {
    return json({ error: { message: "Our server couldn't reach Anthropic just now. Please try again in a moment." } }, 502);
  }

  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}
