/* Phase 4: the ScriptForge relay (functions/api/format.js) still sends plain ScriptForge calls
   to Gemini exactly as before, and now also passes pictures and a retry conversation.
   Run: node test/format-gemini.test.mjs (no network: fetch is replaced by a recorder). */
import { onRequestPost } from "../../../functions/api/format.js";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("PASS " + n); } else { fail++; console.log("FAIL " + n); } };
let sent = null;
globalThis.fetch = async (url, init) => {
  sent = { url: String(url), body: JSON.parse(init.body) };
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok \u2014 done" }] } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
};
const post = (body) => onRequestPost({ request: new Request("https://x/api/format", { method: "POST", body: JSON.stringify(body) }) });

let r = await post({ provider: "gemini", apiKey: "k", model: "gemini-2.5-flash", max_tokens: 100, system: "S", messages: [{ role: "user", content: "Hello script" }] });
ok(JSON.stringify(sent.body.contents) === JSON.stringify([{ role: "user", parts: [{ text: "Hello script" }] }]), "plain ScriptForge call: identical single-turn request as before");
const out = await r.json();
ok(out.content[0].text === "ok, done", "em-dashes are still stripped from Gemini answers");

await post({ provider: "gemini", apiKey: "k", model: "m", max_tokens: 100, system: "S", messages: [
  { role: "user", content: [{ type: "text", text: "Picture 1" }, { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "AAAA" } }, { type: "text", text: "Build" }] },
  { role: "assistant", content: "{bad}" },
  { role: "user", content: "Fix it" }
] });
const c = sent.body.contents;
ok(c.length === 3 && c[0].role === "user" && c[1].role === "model" && c[2].role === "user", "retry conversation keeps its turns (user, model, user)");
ok(c[0].parts[1].inline_data && c[0].parts[1].inline_data.mime_type === "image/jpeg" && c[0].parts[1].inline_data.data === "AAAA", "pictures reach Gemini as inline images");
ok(c[0].parts[0].text === "Picture 1" && c[0].parts[2].text === "Build", "text blocks around the pictures are kept in order");

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
