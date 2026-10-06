/* V2 phase G1 test: Grok is gone from ScriptForge and ScriptEngine, and saved Grok settings
   move to Veo 3.1 (ScriptForge) or Anthropic (ScriptEngine) with a one-time notice.
   Plain node, no Worker needed:
     node test/grok-removed.test.mjs */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("PASS " + n); } else { fail++; console.log("FAIL " + n); } };
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const rel = (p) => path.relative(ROOT, p).split(path.sep).join("/");
const SKIP_DIRS = new Set([".git", "node_modules", ".wrangler", ".wrangler-tmp", "vendor"]);
const TEXT = /\.(js|mjs|html|css|json|md|txt|sql|xml|toml)$/i;
/* Lines that may still say the name: the migration code, the one-time notices, and the docs
   that record the removal. */
const ALLOWED = [
  { file: "assets/app.js", line: /retired|RETIRED_VIDEO_KEY/i },
  { file: "story-script/app.js", line: /retired|RETIRED_PROVIDER/i },
  { file: "scriptforge/index.html", line: /has been retired/ },
  { file: "workers/brain-vault/test/grok-removed.test.mjs", line: /./ },
  { file: "workers/brain-vault/test/run-all.mjs", line: /grok-removed\.test\.mjs/ },
  { file: "workers/brain-vault/HANDOVER.html", line: /./ },
  { file: "workers/brain-vault/README.html", line: /./ }
];

function walk(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) { if (!SKIP_DIRS.has(name)) walk(p, out); }
    else if (TEXT.test(name)) out.push(p);
  }
  return out;
}

try {
  const hits = [];
  for (const f of walk(ROOT, [])) {
    const r = rel(f);
    fs.readFileSync(f, "utf8").split(/\r?\n/).forEach((line, i) => {
      if (!/grok|x\.ai\b|\bxai\b/i.test(line)) return;
      if (ALLOWED.some((a) => a.file === r && a.line.test(line))) return;
      hits.push(r + ":" + (i + 1));
    });
  }
  ok(hits.length === 0, "no Grok or xAI left in code, prompts, pages or docs" + (hits.length ? ": " + hits.slice(0, 12).join(", ") : ""));

  const lf = (p) => fs.readFileSync(path.join(ROOT, p), "utf8").replace(/\r\n/g, "\n");
  const app = lf("assets/app.js");
  const page = lf("scriptforge/index.html");
  const engine = lf("story-script/app.js");
  ok(!/<option value="grok"/.test(app) && /<option value="veo">Veo 3\.1<\/option>/.test(app) && /<option value="heygen"/.test(app), "the segment generator offers Veo 3.1 and HeyGen only");
  ok(!/videoKeyGrok/.test(page + app), "the xAI key field is gone");
  ok(!/api\.x\.ai/.test(fs.readFileSync(path.join(ROOT, "functions/api/video-start.js"), "utf8") + fs.readFileSync(path.join(ROOT, "functions/api/video-poll.js"), "utf8") + fs.readFileSync(path.join(ROOT, "functions/api/ai-relay.js"), "utf8")), "no relay calls api.x.ai");
  ok(!/setProv\(|grokKey/.test(engine), "ScriptEngine has no provider switch and no xAI key");

  /* ScriptForge: the saved key is removed, and only someone who had one sees the notice once. */
  const fnSrc = app.match(/const RETIRED_VIDEO_KEY[\s\S]*?\nfunction retireOldVideoProvider\(\) \{[\s\S]*?\n\}\n/);
  ok(!!fnSrc, "ScriptForge has the saved setting migration");
  function sandbox(store) {
    const ls = {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; }
    };
    const box = { style: { display: "none" } };
    let click = null;
    const btn = { addEventListener: (ev, fn) => { if (ev === "click") click = fn; } };
    const document = { getElementById: (id) => (id === "retiredProviderNotice" ? box : id === "retiredProviderOk" ? btn : null) };
    new Function("localStorage", "document", fnSrc[0] + "\nretireOldVideoProvider();")(ls, document);
    return { store, box, click: () => click && click() };
  }
  let s = sandbox({ sf_video_key_grok: "xai-abc123", sf_video_key_veo: "AIza-keep" });
  ok(!("sf_video_key_grok" in s.store) && s.store.sf_video_key_veo === "AIza-keep", "the saved xAI key is removed and the Veo key is kept");
  ok(s.box.style.display === "", "someone who used it sees the notice");
  s.click();
  ok(s.box.style.display === "none" && s.store.sf_video_provider_retired_seen === "1", "Got it hides the notice for good");
  s = sandbox(s.store);
  ok(s.box.style.display === "none", "the notice does not come back");
  s = sandbox({ sf_video_key_veo: "AIza-keep" });
  ok(s.box.style.display === "none", "nobody else sees the notice");

  /* ScriptEngine: provider "grok" and its key are dropped; the notice shows only for real users. */
  const eSrc = engine.match(/const RETIRED_PROVIDER[\s\S]*?\nfunction retireOldProvider\(s\) \{[\s\S]*?\n\}\n/);
  ok(!!eSrc, "ScriptEngine has the saved setting migration");
  const retire = new Function(eSrc[0] + "\nreturn retireOldProvider;")();
  let r = retire({ key: "el", provider: "grok", grokKey: "xai-1", anthropicKey: "" });
  ok(r.changed && r.notify && !("grokKey" in r.settings) && !("provider" in r.settings) && r.settings.key === "el", "a Grok user is moved to Anthropic and told once");
  r = retire({ key: "el", provider: "anthropic", grokKey: "", anthropicKey: "sk-ant-x" });
  ok(r.changed && !r.notify && r.settings.anthropicKey === "sk-ant-x", "an Anthropic user's old empty field is cleaned without a notice");
  r = retire({ key: "el", anthropicKey: "sk-ant-x" });
  ok(!r.changed && !r.notify, "new settings are left alone");
} catch (e) {
  fail++;
  console.log("FAIL crashed: " + e.stack);
}
console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
