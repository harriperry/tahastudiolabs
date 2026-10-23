// Tests for the AI UGC funnel core. Run with: node --test tests/
// No network. The model is replaced by small mock functions.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const Core = require("../assets/ugc-funnel-core.js");
const spec = require("../assets/ugc/funnel.spec.json");

/* ---------------------------------------------------------------- helpers */

const FILLER = ["soft", "morning", "light", "hands", "table", "small", "jar", "quiet", "kitchen", "glass", "window", "slow"];
const HOOKW = ["bright", "corner", "ticket", "ocean", "paper", "engine", "button", "garden", "river", "pocket", "signal", "market"];
function hookWords(n, seed) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(HOOKW[(i + (seed || 0)) % HOOKW.length]);
  return out.join(" ");
}
function words(n, seed) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(FILLER[(i + (seed || 0)) % FILLER.length]);
  return out.join(" ");
}
function shots(scene, types) {
  let t = scene.start;
  return Core.defaultTiling(scene.dur).map((d, i) => {
    const s = { t: Core.fmtTime(t) + " to " + Core.fmtTime(t + d), type: types[Math.min(i, types.length - 1)], shot: "Close framing " + FILLER[i % FILLER.length] };
    t += d;
    return s;
  });
}
function mid(scene) { return Math.round((scene.min + scene.max) / 2); }

function goodRaw(ctx) {
  const S = ctx.byKey;
  const product = ctx.inputs.product_name;
  const raw = { hooks: [], body: {}, ctas: [], flags: [] };
  for (let i = 0; i < ctx.hookCount; i++) {
    raw.hooks.push({ spoken: hookWords(mid(S.hook), i), visual: shots(S.hook, ["talking_head", "punch_in"]) });
  }
  raw.body.problem = { spoken: words(mid(S.problem), 3), visual: shots(S.problem, ["b_roll"]) };
  if (ctx.hasSolution) {
    const sol = shots(S.solution, [ctx.demoType, "product_in_use"]);
    sol[sol.length - 1].type = "ui_zoom";
    let spoken = words(mid(S.solution) - (product ? 4 : 0), 5);
    if (product) spoken = product + " " + spoken + " now";
    raw.body.solution = { spoken, visual: sol };
  }
  for (let i = 0; i < ctx.ctaCount; i++) {
    let spoken = words(product ? Math.max(1, mid(S.cta) - 5) : mid(S.cta), 7 + i);
    if (product) spoken = "Tap for " + product + " " + spoken;
    raw.ctas.push({ spoken, visual: shots(S.cta, ["talking_head"]) });
  }
  return raw;
}

const baseInput = {
  category: "skincare", product_name: "Calm Barrier Cream", benefit: "feels soft and light",
  pain_point: "dry hands after washing dishes", audience: "busy parents", language: "en", length: 30,
  hook_count: 3, cta_count: 2, archetypes: ["shock", "secret", "callout"]
};
const ctxOf = (over) => Core.makeCtx(spec, Object.assign({}, baseInput, over || {}));
const kitOf = (ctx) => Core.normalizeKit(ctx, goodRaw(ctx));

/* ---------------------------------------------------------------- spec */

test("spec: every length tiles 0 to length and ranges are sane", () => {
  for (const len of Object.keys(spec.lengths)) {
    const sc = spec.lengths[len];
    assert.equal(sc[0].start, 0, len);
    for (let i = 1; i < sc.length; i++) assert.equal(sc[i].start, sc[i - 1].end, len + " gap");
    assert.equal(sc[sc.length - 1].end, Number(len), len + " end");
    sc.forEach((s) => assert.ok(s.min > 0 && s.min < s.max, len + " " + s.key));
  }
});

test("spec: every scene can be tiled by 2 and 3 second shots", () => {
  for (const len of Object.keys(spec.lengths)) {
    spec.lengths[len].forEach((s) => {
      const t = Core.defaultTiling(s.end - s.start);
      assert.equal(t.reduce((a, b) => a + b, 0), s.end - s.start);
      t.forEach((d) => assert.ok(d === 2 || d === 3));
    });
  }
});

test("no em dashes or en dashes in the spec or the core file", () => {
  for (const f of ["../assets/ugc/funnel.spec.json", "../assets/ugc-funnel-core.js", "./ugc-funnel.test.mjs"]) {
    const txt = readFileSync(new URL(f, import.meta.url), "utf8");
    assert.ok(!/[\u2012-\u2015]/.test(txt), f);
  }
});

/* ---------------------------------------------------------------- basics */

test("countWords counts words, not punctuation", () => {
  assert.equal(Core.countWords("Hello, world !"), 2);
  assert.equal(Core.countWords(" a  b\nc "), 3);
  assert.equal(Core.countWords("- , ..."), 0);
  assert.equal(Core.countWords("Hej på dig"), 3);
});

test("extractJson handles fences and trailing commas", () => {
  assert.deepEqual(Core.extractJson("```json\n{\"a\":1}\n```"), { a: 1 });
  assert.deepEqual(Core.extractJson("Here: {\"a\":[1,2,],}"), { a: [1, 2] });
  assert.throws(() => Core.extractJson("nothing"));
});

/* ---------------------------------------------------------------- prompt */

test("spec: every scene is one clip of at most 10 seconds", () => {
  assert.equal(spec.limits.maxSceneSeconds, 10);
  for (const len of Object.keys(spec.lengths)) {
    spec.lengths[len].forEach((s) => assert.ok(s.end - s.start <= spec.limits.maxSceneSeconds, len + " " + s.key));
  }
  assert.deepEqual(Object.keys(spec.lengths).map(Number).sort((a, b) => a - b), [12, 15, 30]);
});

test("spec: word ranges stay below about 2.6 words per second", () => {
  for (const len of Object.keys(spec.lengths)) {
    spec.lengths[len].forEach((s) => assert.ok(s.max / (s.end - s.start) <= 2.7, len + " " + s.key + " " + s.max / (s.end - s.start)));
  }
});

test("kit prompt: only the chosen length is sent, has no dashes, strict rules only for strict", () => {
  const strict = Core.buildKitPrompt(ctxOf());
  assert.ok(strict.system.includes("30 seconds"));
  assert.ok(!strict.system.includes("60 seconds"));
  assert.ok(!/[\u2012-\u2015]/.test(strict.system + strict.user));
  assert.ok(strict.system.includes("never uses first person"));
  const std = Core.buildKitPrompt(ctxOf({ category: "food", product_name: "" }));
  assert.ok(std.system.includes("never uses first person"));
  assert.ok(!std.system.includes("Never use words like cure"));
  assert.ok(std.system.includes("no product is named"));
});

test("kit prompt: 12 second length has no solution scene", () => {
  const ctx = ctxOf({ length: 12 });
  assert.equal(ctx.hasSolution, false);
  const p = Core.buildKitPrompt(ctx);
  assert.ok(!p.system.includes("SOLUTION 0:"));
  assert.ok(p.system.includes("Leave out"));
});

test("kit prompt: before_after is not offered to strict categories", () => {
  assert.ok(!ctxOf().allowedTypes.includes("before_after"));
  assert.ok(ctxOf({ category: "apps" }).allowedTypes.includes("before_after"));
  assert.ok(!ctxOf({ category: "skincare" }).allowedTypes.includes("screen_recording"));
  assert.ok(ctxOf({ category: "apps" }).allowedTypes.includes("screen_recording"));
});

/* ---------------------------------------------------------------- validator */

test("a clean kit passes for every length, category and language", () => {
  for (const len of Object.keys(spec.lengths)) {
    for (const cat of spec.categories) {
      for (const language of ["en", "sv"]) {
        const ctx = ctxOf({ length: Number(len), category: cat.id, language });
        const rep = Core.validateKit(ctx, kitOf(ctx));
        assert.deepEqual(rep.failing, [], len + " " + cat.id + " " + language + " " + JSON.stringify(rep.units));
      }
    }
  }
});

function failCodes(ctx, kit, key) {
  return Core.validateKit(ctx, kit).units[key].issues.map((i) => i.code);
}

test("validator: word count too high and too low", () => {
  const ctx = ctxOf();
  let kit = kitOf(ctx);
  kit.body.problem.spoken = words(ctx.byKey.problem.max + 1, 0);
  assert.ok(failCodes(ctx, kit, "problem").includes("words"));
  kit = kitOf(ctx);
  kit.hooks[0].spoken = "Too short";
  assert.ok(failCodes(ctx, kit, "hook:0").includes("words"));
});

test("validator: shot tiling gaps, overruns and bad lengths", () => {
  const ctx = ctxOf();
  let kit = kitOf(ctx);
  kit.body.problem.visual[1].t = "0:08 to 0:10";
  assert.ok(failCodes(ctx, kit, "problem").includes("tiling"));
  kit = kitOf(ctx);
  kit.hooks[0].visual = [{ t: "0:00 to 0:01", type: "talking_head", shot: "x" }, { t: "0:01 to 0:03", type: "punch_in", shot: "y" }];
  assert.ok(failCodes(ctx, kit, "hook:0").includes("tiling"));
  kit = kitOf(ctx);
  kit.hooks[0].visual = [];
  assert.ok(failCodes(ctx, kit, "hook:0").includes("tiling"));
});

test("validator: problem needs at least half b_roll", () => {
  const ctx = ctxOf();
  const kit = kitOf(ctx);
  kit.body.problem.visual.forEach((s) => { s.type = "talking_head"; });
  assert.ok(failCodes(ctx, kit, "problem").includes("broll"));
});

test("validator: solution needs a demo and a result shot", () => {
  const ctx = ctxOf();
  const kit = kitOf(ctx);
  kit.body.solution.visual.forEach((s) => { s.type = "talking_head"; });
  const codes = failCodes(ctx, kit, "solution");
  assert.ok(codes.includes("demo") && codes.includes("result"));
});

test("validator: text_pop over 5 words fails", () => {
  const ctx = ctxOf();
  const kit = kitOf(ctx);
  kit.hooks[0].visual[0] = { t: "0:00 to 0:03", type: "text_pop", shot: "one two three four five six" };
  assert.ok(failCodes(ctx, kit, "hook:0").includes("textpop"));
});

test("validator: dashes are fixed automatically, not sent back to the model", () => {
  const ctx = ctxOf();
  const kit = kitOf(ctx);
  const dash = String.fromCharCode(0x2014);
  kit.hooks[0].spoken = hookWords(5, 0) + " " + dash + " " + hookWords(1, 2);
  const rep = Core.validateKit(ctx, kit);
  assert.ok(!/[\u2012-\u2015]/.test(kit.hooks[0].spoken));
  assert.ok(rep.fixes.some((f) => f.key === "hook:0"));
  assert.ok(!rep.failing.includes("hook:0"));
});

test("validator: medical wording fails for strict but not for standard", () => {
  const strict = ctxOf();
  let kit = kitOf(strict);
  kit.hooks[0].spoken = "This will cure " + hookWords(5, 0);
  assert.ok(failCodes(strict, kit, "hook:0").includes("claims"));
  const std = ctxOf({ category: "food", product_name: "" });
  kit = kitOf(std);
  kit.hooks[0].spoken = "This will cure " + hookWords(5, 0);
  assert.ok(!failCodes(std, kit, "hook:0").includes("claims"));
});

test("validator: a risky word typed by the user becomes a warning, not a failure", () => {
  const ctx = ctxOf({ category: "food", product_name: "", benefit: "award winning taste" });
  const kit = kitOf(ctx);
  kit.hooks[0].spoken = "Award winning " + hookWords(4, 0);
  const rep = Core.validateKit(ctx, kit);
  assert.ok(!rep.units["hook:0"].issues.some((i) => i.code === "claims"));
  assert.ok(rep.warnings.length >= 1);
});

test("validator: invented numbers fail, numbers from the brief pass", () => {
  const ctx = ctxOf();
  let kit = kitOf(ctx);
  kit.body.problem.spoken = words(ctx.byKey.problem.min + 1, 0) + " 7 days three times";
  assert.ok(failCodes(ctx, kit, "problem").includes("numbers"));
  const ctx2 = ctxOf({ benefit: "lasts 24 hours of comfort" });
  kit = kitOf(ctx2);
  kit.body.problem.spoken = words(ctx2.byKey.problem.min + 1, 0) + " 24";
  assert.ok(!failCodes(ctx2, kit, "problem").includes("numbers"));
});

test("validator: the solution bans first person in every category", () => {
  const ctx = ctxOf();
  let kit = kitOf(ctx);
  kit.body.solution.spoken = "Calm Barrier Cream and my " + words(mid(ctx.byKey.solution) - 4, 1);
  assert.ok(failCodes(ctx, kit, "solution").includes("firstperson"));
  const std = ctxOf({ category: "fashion", product_name: "Torghu" });
  kit = kitOf(std);
  kit.body.solution.spoken = "Until I found Torghu " + words(mid(std.byKey.solution) - 5, 1);
  assert.ok(failCodes(std, kit, "solution").includes("firstperson"));
});

test("validator: before_after is blocked for strict and allowed for standard", () => {
  const ctx = ctxOf();
  let kit = kitOf(ctx);
  kit.body.solution.visual[1].type = "before_after";
  assert.ok(failCodes(ctx, kit, "solution").includes("blockedType"));
  const std = ctxOf({ category: "home", product_name: "Tidy Box" });
  kit = kitOf(std);
  kit.body.solution.visual[kit.body.solution.visual.length - 1].type = "before_after";
  assert.deepEqual(Core.validateKit(std, kit).failing, []);
});

test("validator: solution and direct CTA must name the product", () => {
  const ctx = ctxOf();
  const kit = kitOf(ctx);
  kit.body.solution.spoken = words(mid(ctx.byKey.solution), 0);
  kit.ctas[1].spoken = words(mid(ctx.byKey.cta), 0);
  assert.ok(failCodes(ctx, kit, "solution").includes("product"));
  assert.ok(failCodes(ctx, kit, "cta:1").includes("product"));
  assert.ok(!failCodes(ctx, kit, "cta:0").includes("product"));
});

test("category-only mode: no product is required", () => {
  const ctx = ctxOf({ product_name: "", benefit: "" });
  assert.equal(ctx.hasProduct, false);
  const kit = Core.normalizeKit(ctx, goodRaw(ctx));
  assert.deepEqual(Core.validateKit(ctx, kit).failing, []);
});

/* ---------------------------------------------------------------- repair loop */

test("repair: only the failing scene is regenerated", async () => {
  const ctx = ctxOf();
  const kit = kitOf(ctx);
  kit.hooks[1].spoken = "Too short";
  const good = goodRaw(ctx).hooks[1];
  const calls = [];
  const callModel = async (req) => { calls.push(req); return JSON.stringify(good); };
  const res = await Core.repairKit(ctx, kit, callModel);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].key, "hook:1");
  assert.deepEqual(res.report.failing, []);
  assert.equal(res.kit.hooks[1].id, "H2");
  assert.ok(res.kit.hooks[1].archetype);
});

test("repair: stops after two retries and flags the scene", async () => {
  const ctx = ctxOf();
  const kit = kitOf(ctx);
  kit.hooks[0].spoken = "Too short";
  let n = 0;
  const callModel = async () => { n++; return JSON.stringify({ spoken: "Still short", visual: kit.hooks[0].visual }); };
  const res = await Core.repairKit(ctx, kit, callModel);
  assert.equal(n, 2);
  assert.deepEqual(res.report.failing, ["hook:0"]);
  const checks = Core.buildChecks(ctx, res.report, res.log);
  assert.equal(checks.find((c) => c.id === "words").state, "fail");
});

test("repair: a model error is logged and does not crash the kit", async () => {
  const ctx = ctxOf();
  const kit = kitOf(ctx);
  kit.hooks[0].spoken = "Too short";
  const res = await Core.repairKit(ctx, kit, async () => { throw new Error("network down"); });
  assert.ok(res.log.some((e) => e.error));
  assert.deepEqual(res.report.failing, ["hook:0"]);
});

test("generateKit: one call when the model gets it right, ids and archetypes assigned by code", async () => {
  const ctx = ctxOf();
  let n = 0;
  const res = await Core.generateKit(ctx, async () => { n++; return "```json\n" + JSON.stringify(goodRaw(ctx)) + "\n```"; });
  assert.equal(n, 1);
  assert.deepEqual(res.kit.hooks.map((h) => h.id), ["H1", "H2", "H3"]);
  assert.deepEqual(res.kit.ctas.map((c) => c.type), ["soft", "direct"]);
  const checks = Core.buildChecks(ctx, res.report, res.log);
  checks.forEach((c) => assert.equal(c.state, "pass", c.id));
});

test("generateKit: a bad scene costs one extra small call and shows as edited", async () => {
  const ctx = ctxOf();
  const raw = goodRaw(ctx);
  const goodHook = clone(raw.hooks[2]);
  raw.hooks[2].spoken = "Short";
  const reqs = [];
  const res = await Core.generateKit(ctx, async (r) => {
    reqs.push(r);
    return reqs.length === 1 ? JSON.stringify(raw) : JSON.stringify(goodHook);
  });
  assert.equal(reqs.length, 2);
  assert.ok(reqs[1].max_tokens < reqs[0].max_tokens);
  const checks = Core.buildChecks(ctx, res.report, res.log);
  assert.equal(checks.find((c) => c.id === "words").state, "edited");
});
function clone(o) { return JSON.parse(JSON.stringify(o)); }

/* ---------------------------------------------------------------- variants and exports */

test("variants: 3 hooks x 2 CTAs gives 6 and each script has the right parts", () => {
  const ctx = ctxOf();
  const kit = kitOf(ctx);
  const v = Core.makeVariants(kit);
  assert.equal(v.length, 6);
  assert.equal(v[0].label, "H1 + B1 + C1");
  const lines = Core.variantScript(kit, v[0]).split("\n");
  assert.equal(lines.length, 4);
  assert.equal(lines[0], kit.hooks[0].spoken);
  assert.equal(lines[3], kit.ctas[0].spoken);
  const csv = Core.variantsCsv(kit, v).split("\n");
  assert.equal(csv.length, 7);
});

test("t2i prompts: only T2I shot types, with the anchor, 9:16 and no dashes", () => {
  const ctx = ctxOf();
  const kit = kitOf(ctx);
  const out = Core.t2iPrompts(ctx, kit, "Ultra realistic woman, warm brown skin.", Core.makeVariants(kit));
  assert.ok(out.includes("b_roll"));
  assert.ok(!out.includes("talking_head"));
  assert.ok(out.includes("Ultra realistic woman"));
  assert.ok(out.includes("9:16"));
  assert.ok(!/[\u2012-\u2015]/.test(out));
});

/* ---------------------------------------------------------------- estimates */

test("token estimate: one kit call is cheaper than one call per variant", () => {
  const e = Core.estimateRun(ctxOf());
  assert.equal(e.calls, 1);
  assert.equal(e.variants, 6);
  assert.equal(e.oldCalls, 6);
  assert.ok(e.tokensIn < e.oldIn, "input " + e.tokensIn + " vs " + e.oldIn);
  assert.ok(e.tokensOut < e.oldOut, "output " + e.tokensOut + " vs " + e.oldOut);
  const saved = 1 - (e.tokensIn + e.tokensOut) / (e.oldIn + e.oldOut);
  console.log("estimated saving per 6 variants: " + Math.round(saved * 100) + "% (" + (e.tokensIn + e.tokensOut) + " vs " + (e.oldIn + e.oldOut) + " tokens, chars/4)");
  assert.ok(saved > 0.3);
});

/* ---------------------------------------------------------------- auto-fill */

test("autofill: drops claims and numbers, replaces dashes, keeps clean items", () => {
  const dash = String.fromCharCode(0x2014);
  const raw = {
    pain_points: ["My hands feel tight after dishes", "It will cure my dry skin", "I tried 5 creams " + "and none worked"],
    audience: "Busy parents " + dash + " on the move",
    benefits: ["Feels soft", "Clears acne fast", "Easy to apply"]
  };
  const out = Core.parseAutofill(spec, "skincare", raw);
  assert.deepEqual(out.pain_points, ["My hands feel tight after dishes"]);
  assert.deepEqual(out.benefits, ["Feels soft", "Easy to apply"]);
  assert.ok(!/[\u2012-\u2015]/.test(out.audience));
  assert.equal(out.removed, 3);
});

test("autofill prompt: small, has no dashes, names the language", () => {
  const p = Core.buildAutofillPrompt(spec, { category: "skincare", product_name: "Calm Barrier Cream", language: "sv" });
  assert.ok(p.system.includes("Swedish"));
  assert.ok(!/[\u2012-\u2015]/.test(p.system + p.user));
  assert.ok(Core.estimateTokens(p.system + p.user) < 400);
});

/* ---------------------------------------------------------------- v2 rules */

test("speed promises are blocked in every profile, unless the user typed them", () => {
  for (const category of ["skincare", "fashion"]) {
    const ctx = ctxOf({ category, product_name: "Torghu" });
    const kit = kitOf(ctx);
    kit.hooks[0].spoken = "It comes together in seconds " + hookWords(ctx.byKey.hook.min - 2, 0);
    assert.ok(failCodes(ctx, kit, "hook:0").includes("claims"), category);
  }
  const ctx = ctxOf({ category: "fashion", product_name: "Torghu", benefit: "ready in seconds" });
  const kit = kitOf(ctx);
  kit.hooks[0].spoken = "Ready in seconds " + hookWords(ctx.byKey.hook.min - 2, 0);
  assert.ok(!failCodes(ctx, kit, "hook:0").includes("claims"));
});

test("product details: sent to the model, with the no-invention rule", () => {
  const withD = Core.buildKitPrompt(ctxOf({ category: "fashion", product_name: "Torghu", details: "multicolored dress" }));
  assert.ok(withD.user.includes("details: multicolored dress"));
  assert.ok(withD.system.includes("only with the features listed"));
  const without = Core.buildKitPrompt(ctxOf({ category: "fashion", product_name: "Torghu" }));
  assert.ok(without.user.includes("details: none"));
  assert.ok(without.system.includes("No product details were given"));
});

test("product details: a missing description is flagged on the kit", async () => {
  const ctx = ctxOf({ category: "fashion", product_name: "Torghu" });
  const res = await Core.generateKit(ctx, async () => JSON.stringify(goodRaw(ctx)));
  assert.ok(res.kit.flags.some((f) => f.includes("No product details")));
  const ctx2 = ctxOf({ category: "fashion", product_name: "Torghu", details: "multicolored dress" });
  const res2 = await Core.generateKit(ctx2, async () => JSON.stringify(goodRaw(ctx2)));
  assert.ok(!res2.kit.flags.some((f) => f.includes("No product details")));
});

test("pivot examples are neutral, never first person", () => {
  const re = new RegExp(spec.firstPerson, "i");
  spec.categories.forEach((c) => { assert.ok(c.pivots.length >= 3, c.id); c.pivots.forEach((pv) => assert.ok(!re.test(pv), c.id + " " + pv)); });
});

/* ---------------------------------------------------------------- v3 rules */

test("brand and product: one exact name is sent and checked", () => {
  const ctx = ctxOf({ category: "fashion", brand: "TORGHU", product_name: "Grassfield Gown" });
  assert.equal(ctx.nameToUse, "TORGHU Grassfield Gown");
  const p = Core.buildKitPrompt(ctx);
  assert.ok(p.user.includes("name_to_use: TORGHU Grassfield Gown"));
  assert.ok(p.system.includes("exactly as name_to_use"));
  const kit = kitOf(ctx);
  assert.deepEqual(Core.validateKit(ctx, kit).failing, []);
  kit.body.solution.spoken = words(mid(ctx.byKey.solution), 0);
  assert.ok(failCodes(ctx, kit, "solution").includes("product"));
  assert.equal(ctxOf({ category: "fashion", brand: "TORGHU", product_name: "" }).nameToUse, "TORGHU");
  assert.equal(ctxOf({ category: "fashion", brand: "TORGHU", product_name: "TORGHU Gown" }).nameToUse, "TORGHU Gown");
});

test("hooks that repeat the problem are failed and sent back with the problem text", async () => {
  const ctx = ctxOf();
  const kit = kitOf(ctx);
  kit.body.problem.spoken = "Same safe dress before every event and nothing else feels right " + words(ctx.byKey.problem.min - 11, 0);
  kit.hooks[0].spoken = "Same dress again every single event";
  assert.ok(failCodes(ctx, kit, "hook:0").includes("overlap"));
  kit.hooks[1].spoken = hookWords(ctx.byKey.hook.min, 3);
  assert.ok(!failCodes(ctx, kit, "hook:1").includes("overlap"));
  const reqs = [];
  await Core.repairKit(ctx, kit, async (r) => { reqs.push(r); return JSON.stringify({ spoken: hookWords(ctx.byKey.hook.min, 5), visual: kit.hooks[0].visual }); });
  assert.ok(reqs[0].user.includes("do not reuse its words"));
});

test("effort and ease claims are blocked", () => {
  for (const phrase of ["zero extra effort", "so effortless", "ready for any event", "for any occasion", "no effort at all"]) {
    const ctx = ctxOf({ category: "fashion", product_name: "Torghu" });
    const kit = kitOf(ctx);
    kit.hooks[0].spoken = phrase + " " + hookWords(ctx.byKey.hook.min - 2, 0);
    assert.ok(failCodes(ctx, kit, "hook:0").includes("claims"), phrase);
  }
});

test("solution must show a listed feature when details are given", () => {
  const ctx = ctxOf({ category: "fashion", product_name: "Torghu", details: "multicolored dress, long sleeves" });
  const kit = kitOf(ctx);
  assert.ok(failCodes(ctx, kit, "solution").includes("feature"));
  kit.body.solution.spoken = "Torghu with long sleeves " + words(mid(ctx.byKey.solution) - 6, 1);
  assert.ok(!failCodes(ctx, kit, "solution").includes("feature"));
  const noDetails = ctxOf({ category: "fashion", product_name: "Torghu" });
  assert.ok(!failCodes(noDetails, kitOf(noDetails), "solution").includes("feature"));
});

test("pivot examples are given as a list and must not be copied", () => {
  const p = Core.buildKitPrompt(ctxOf({ category: "fashion", product_name: "Torghu" }));
  assert.ok(p.system.includes("Now look at this piece."));
  assert.ok(p.system.includes("never copy an example word for word"));
});

/* ---------------------------------------------------------------- v4: almost-JSON from models */

test("extractJson repairs raw line breaks and unescaped inner quotes", () => {
  const nl = "{\"a\":\"line one\nline two\",\"b\":[\"x\"]}";
  assert.equal(Core.extractJson(nl).a, "line one\nline two");
  const q = "{\"spoken\":\"She said \"wow\" at the door\",\"visual\":[{\"t\":\"0:00 to 0:03\",\"type\":\"b_roll\",\"shot\":\"Door\"}]}";
  const out = Core.extractJson(q);
  assert.equal(out.spoken, "She said \"wow\" at the door");
  assert.equal(out.visual.length, 1);
  assert.throws(() => Core.extractJson("{\"a\": oops}"));
});

test("generateKit retries once when the reply cannot be read, and not otherwise", async () => {
  const ctx = ctxOf();
  let n = 0;
  const res = await Core.generateKit(ctx, async (r) => { n++; return n === 1 ? "{\"hooks\": [oops" : JSON.stringify(goodRaw(ctx)); });
  assert.equal(n, 2);
  assert.deepEqual(res.report.failing, []);
  let m = 0;
  await assert.rejects(Core.generateKit(ctx, async () => { m++; return "not json"; }));
  assert.equal(m, 2);
});

/* ---------------------------------------------------------------- v5: production pack */

test("production pack: TTS, T2I and I2V together, per scene and per shot", () => {
  const ctx = ctxOf();
  const kit = kitOf(ctx);
  const v = Core.makeVariants(kit)[0];
  kit.body.problem.visual[0].type = "b_roll";
  kit.hooks[0].visual[0].type = "talking_head";
  const pack = Core.productionPack(ctx, kit, v, "Ultra realistic woman, warm brown skin.");
  assert.ok(pack.includes("[H1 + B1 + C1] 30s, 9:16"));
  ["HOOK", "PROBLEM", "SOLUTION", "CTA"].forEach((n) => assert.ok(pack.includes(" " + n + " | "), n));
  assert.equal((pack.match(/^TTS: /gm) || []).length, 4);
  assert.ok(pack.includes("TTS: " + kit.hooks[0].spoken));
  assert.ok(pack.includes("TTS: " + kit.ctas[0].spoken));
  const t2i = (pack.match(/^ {2}T2I: /gm) || []).length, i2v = (pack.match(/^ {2}I2V: /gm) || []).length;
  assert.ok(t2i > 0 && t2i === i2v);
  assert.ok(pack.includes("Ultra realistic woman"));
  assert.ok(pack.includes("AVATAR: the presenter says the TTS line"));
  assert.ok(/I2V: Animate the still image for \d seconds/.test(pack));
  assert.ok(!/[\u2012-\u2015]/.test(pack));
});

test("production pack: talking shots get no image prompts and 12s has no solution", () => {
  const ctx = ctxOf({ length: 12 });
  const kit = kitOf(ctx);
  kit.hooks[0].visual.forEach((s) => { s.type = "talking_head"; });
  const pack = Core.productionPack(ctx, kit, Core.makeVariants(kit)[0], "");
  assert.ok(!pack.includes("SOLUTION"));
  const hookPart = pack.split("SCENE 2")[0];
  assert.ok(!hookPart.includes("T2I:") && !hookPart.includes("I2V:"));
  const all = Core.productionPackAll(ctx, kit, Core.makeVariants(kit), "");
  assert.equal((all.match(/^\[H\d \+ B1 \+ C\d\]/gm) || []).length, 6);
});

/* ---------------------------------------------------------------- v6: stock pivots and shame wording */

test("a solution that opens with a stock pivot fails, even with words changed", () => {
  const ctx = ctxOf({ category: "haircare", brand: "", product_name: "Dreadlocks" });
  const kit = kitOf(ctx);
  const tail = " " + words(mid(ctx.byKey.solution) - 14, 2);
  for (const opener of ["Here's another way to approach it.", "That's where Dreadlocks comes in.", "Here is another way to do it.", "Now look at this instead."]) {
    kit.body.solution.spoken = opener + " Dreadlocks" + tail;
    assert.ok(failCodes(ctx, kit, "solution").includes("pivotcopy"), opener);
  }
  kit.body.solution.spoken = "Small sections at the roots, taken slowly. Dreadlocks" + tail;
  assert.ok(!failCodes(ctx, kit, "solution").includes("pivotcopy"));
});

test("pivot check shows as its own row in the report", async () => {
  const ctx = ctxOf();
  const res = await Core.generateKit(ctx, async () => JSON.stringify(goodRaw(ctx)));
  const checks = Core.buildChecks(ctx, res.report, res.log);
  assert.equal(checks.length, 7);
  assert.equal(checks.find((c) => c.id === "pivot").state, "pass");
});

test("shame wording is blocked in every category", () => {
  for (const category of ["haircare", "fashion"]) {
    for (const phrase of ["you failed", "so embarrassing and ugly", "feel ashamed", "total failure"]) {
      const ctx = ctxOf({ category, product_name: "Torghu" });
      const kit = kitOf(ctx);
      kit.hooks[0].spoken = phrase + " " + hookWords(ctx.byKey.hook.min - 1, 0);
      assert.ok(failCodes(ctx, kit, "hook:0").includes("claims"), category + " " + phrase);
    }
  }
});

/* ---------------------------------------------------------------- v7: UGC Production Standard guardrails */

const NEG = "no readable text, no gibberish text, no ui, no player controls, no timeline, no watermark, no logo, no split screen, no stacked or tiled frames, no borders, no collage, no extra people, no face change, no morphing, no extra fingers";

test("v7: the spec is version 7 and carries the generator rules the model must follow", () => {
  assert.equal(spec.version, "ugc-funnel-7");
  const prompt = Core.buildKitPrompt(ctxOf()).system;
  assert.ok(prompt.includes("cannot render readable text, app screens, documents, logos, clocks or keyboards"));
  assert.ok(prompt.includes("Every b_roll shot has a job"));
  assert.ok(prompt.includes("never extra people"));
});

test("v7: shots a generator would draw cannot ask for clocks, keyboards, readable text or app screens", () => {
  for (const category of ["skincare", "apps", "fashion"]) {
    for (const phrase of ["Close up of a wall clock ticking", "Hands typing on a keyboard", "A laptop screen shows the dashboard", "Close up of a phone screen with an app", "Handwritten note on the table"]) {
      const ctx = ctxOf({ category });
      const kit = kitOf(ctx);
      kit.body.problem.visual[0].type = "b_roll";
      kit.body.problem.visual[0].shot = phrase;
      assert.ok(failCodes(ctx, kit, "problem").includes("render"), category + " " + phrase);
    }
  }
});

test("v7: render scan skips talking shots, real app footage and words the brief itself uses", () => {
  const ctx = ctxOf({ category: "apps" });
  const kit = kitOf(ctx);
  kit.body.problem.visual[0].type = "b_roll";
  kit.body.problem.visual[0].shot = "Hands wrap around a warm mug";
  kit.hooks[0].visual[0].type = "talking_head";
  kit.hooks[0].visual[0].shot = "She glances at the clock then looks into the camera";
  const sol = kit.body.solution.visual[kit.body.solution.visual.length - 1];
  assert.equal(sol.type, "ui_zoom");
  sol.shot = "Slow push in on the dashboard";
  assert.ok(!failCodes(ctx, kit, "problem").includes("render"));
  assert.ok(!failCodes(ctx, kit, "hook:0").includes("render"));
  assert.ok(!failCodes(ctx, kit, "solution").includes("render"));
  const clockCtx = ctxOf({ category: "home", product_name: "Oak Wall Clock", details: "silent clock" });
  const clockKit = kitOf(clockCtx);
  clockKit.body.problem.visual[0].type = "b_roll";
  clockKit.body.problem.visual[0].shot = "Close up of the clock on the wall";
  const rep = Core.validateKit(clockCtx, clockKit).units.problem;
  assert.ok(!rep.issues.some((i) => i.code === "render"));
});

test("v7: render problems show on the shots row of the report", () => {
  const ctx = ctxOf();
  const kit = kitOf(ctx);
  kit.body.problem.visual[0].type = "b_roll";
  kit.body.problem.visual[0].shot = "Close up of a wall clock";
  const report = Core.validateKit(ctx, kit);
  const checks = Core.buildChecks(ctx, report, []);
  assert.equal(checks.length, 7);
  assert.equal(checks.find((c) => c.id === "shots").state, "fail");
});

test("v7: autofill is not affected by the shot only scan", () => {
  const out = Core.parseAutofill(spec, "apps", { pain_points: ["I check the clock again and again"], audience: "busy parents", benefits: ["Feels calmer"] });
  assert.equal(out.pain_points.length, 1);
});

test("v7: every T2I and I2V line, and the T2I list, carries the negative block", () => {
  const ctx = ctxOf();
  const kit = kitOf(ctx);
  kit.body.problem.visual.forEach((s) => { s.type = "b_roll"; });
  const v = Core.makeVariants(kit)[0];
  const pack = Core.productionPack(ctx, kit, v, "Ultra realistic woman.");
  const lines = pack.split("\n").filter((l) => /^ {2}(T2I|I2V): /.test(l));
  assert.ok(lines.length > 0);
  lines.forEach((l) => assert.ok(l.toLowerCase().includes(NEG), l.slice(0, 60)));
  const list = Core.t2iPrompts(ctx, kit, "Ultra realistic woman.", Core.makeVariants(kit));
  assert.ok(list.toLowerCase().includes(NEG));
  assert.ok(list.includes("no text or captions in the image"));
});

test("v7: for apps, screen recordings and UI zooms are real footage and never generated", () => {
  const ctx = ctxOf({ category: "apps", product_name: "Scriptly" });
  const kit = kitOf(ctx);
  const sol = kit.body.solution.visual;
  sol[0].type = "screen_recording"; sol[0].shot = "Tap Generate and the script fills the page";
  sol[sol.length - 1].type = "ui_zoom"; sol[sol.length - 1].shot = "Push in on the finished script";
  const pack = Core.productionPack(ctx, kit, Core.makeVariants(kit)[0], "");
  const solPart = pack.split("SOLUTION")[1].split("SCENE 4")[0];
  assert.equal((solPart.match(/REAL FOOTAGE NEEDED/g) || []).length, 2);
  assert.ok(!/ {2}T2I: Push in on the finished script/.test(solPart));
  assert.ok(solPart.includes("Never generate this shot with an image or video model"));
  const list = Core.t2iPrompts(ctx, kit, "", Core.makeVariants(kit));
  assert.ok(!list.includes("Push in on the finished script"));
});

test("v7: for physical products a UI zoom is still a detail shot made with the image model", () => {
  const ctx = ctxOf();
  const kit = kitOf(ctx);
  const sol = kit.body.solution.visual;
  sol[sol.length - 1].type = "ui_zoom"; sol[sol.length - 1].shot = "Slow push in on the jar lid";
  const pack = Core.productionPack(ctx, kit, Core.makeVariants(kit)[0], "");
  assert.ok(/ {2}T2I: .*Slow push in on the jar lid/.test(pack));
  assert.ok(!pack.includes("REAL FOOTAGE NEEDED"));
});

test("v7: every pack closes with post notes for captions, brand tag, end card, presenter and export", () => {
  const ctx = ctxOf();
  const kit = kitOf(ctx);
  const pack = Core.productionPack(ctx, kit, Core.makeVariants(kit)[0], "Ultra realistic woman.");
  const notes = pack.split("POST NOTES")[1];
  assert.ok(notes, "post notes missing");
  assert.ok(pack.trim().endsWith(notes.trim()));
  ["CAPTIONS: burned in on every spoken line", "BRAND TAG: show Calm Barrier Cream", "END CARD: last 2 seconds", "Never end on a black frame",
    "PRESENTER: use the same avatar", "EXPORT: 1080x1920", "CHECK: pause on every screen shot"].forEach((t) => assert.ok(notes.includes(t), t));
  assert.ok(!notes.includes("PRESENTER ANCHOR: none selected"));
  assert.equal((pack.match(/^TTS: /gm) || []).length, 4);
  assert.ok(!/[\u2012-\u2015]/.test(pack));
});

test("v7: post notes warn when no presenter anchor is chosen and skip the brand tag with no product", () => {
  const ctx = ctxOf({ product_name: "none", brand: "" });
  const kit = kitOf(ctx);
  const pack = Core.productionPack(ctx, kit, Core.makeVariants(kit)[0], "");
  assert.ok(pack.includes("PRESENTER ANCHOR: none selected"));
  assert.ok(!pack.includes("BRAND TAG"));
  const twelve = ctxOf({ length: 12 });
  const k12 = kitOf(twelve);
  const p12 = Core.productionPack(twelve, k12, Core.makeVariants(k12)[0], "");
  assert.ok(!p12.includes("SOLUTION"));
  assert.ok(p12.includes("POST NOTES"));
});

test("v7: the no screens rule lists only the shot types a generator draws for this category", () => {
  const rule = (ctx) => Core.buildKitPrompt(ctx).system.split("\n").find((l) => l.startsWith("Image and video models cannot render"));
  assert.ok(!rule(ctxOf({ category: "apps" })).includes("ui_zoom"));
  assert.ok(rule(ctxOf({ category: "apps" })).includes("b_roll"));
  assert.ok(rule(ctxOf({ category: "skincare" })).includes("ui_zoom"));
  assert.ok(!rule(ctxOf({ category: "skincare" })).includes("before_after"));
  assert.ok(!rule(ctxOf({ category: "skincare" })).includes("{{"));
});
