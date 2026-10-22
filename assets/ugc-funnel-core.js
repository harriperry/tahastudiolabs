/* ScriptForge AI UGC Funnel: core logic.

   WHAT THIS FILE IS
   Pure functions, no DOM, no network. It builds the prompts from assets/ugc/funnel.spec.json,
   checks every model answer in code (word counts, shot timing, dashes, claims, numbers),
   repairs only the one scene that failed, combines hooks, body and CTAs into variants, and
   builds the exports. The browser UI (assets/ugc-funnel.js) and the tests (tests/) both use it.

   WHY THE CHECKS LIVE IN CODE
   Models are unreliable at counting words and at doing arithmetic on time ranges. The model
   writes the content, this code decides whether it fits.

   HOUSE RULE: no em dashes or en dashes anywhere, in this file or in any output. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.UGCFunnelCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ------------------------------------------------------------------ small helpers */

  function str(v) { return v == null ? "" : String(v).trim(); }
  function clamp(n, lo, hi) { n = Number(n); if (!isFinite(n)) n = lo; return Math.max(lo, Math.min(hi, Math.round(n))); }
  function fill(tpl, vars) {
    return String(tpl).replace(/\{\{(\w+)\}\}/g, function (m, k) { return vars[k] == null ? "" : String(vars[k]); });
  }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function fmtTime(sec) { return Math.floor(sec / 60) + ":" + pad2(sec % 60); }
  function parseTime(s) {
    var m = /^(\d+):(\d{2})$/.exec(str(s));
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  }
  function parseRange(s) {
    var m = /^(\d+:\d{2})\s*(?:to|-|\u2013|\u2014)\s*(\d+:\d{2})$/i.exec(str(s));
    if (!m) return null;
    var a = parseTime(m[1]), b = parseTime(m[2]);
    return a == null || b == null ? null : [a, b];
  }
  function countWords(s) {
    return (String(s == null ? "" : s).match(/\S+/g) || []).filter(function (t) { return /[\p{L}\p{N}]/u.test(t); }).length;
  }
  function estimateTokens(text) { return Math.ceil(String(text || "").length / 4); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function unique(arr) { return arr.filter(function (v, i) { return arr.indexOf(v) === i; }); }

  /* Shot lengths that fill a scene exactly with 2 or 3 second shots. */
  function defaultTiling(dur) {
    var n3 = Math.floor(dur / 3), rem = dur - n3 * 3, out = [], i;
    if (rem === 1 && n3 >= 1) { n3 -= 1; for (i = 0; i < n3; i++) out.push(3); out.push(2, 2); return out; }
    for (i = 0; i < n3; i++) out.push(3);
    if (rem === 2) out.push(2);
    return out;
  }

  var LANG_NAMES = { en: "English", sv: "Swedish" };
  function languageName(code) { return LANG_NAMES[code] || "English"; }

  /* ------------------------------------------------------------------ context */

  function nearestPreset(spec, requested) {
    var presets = Object.keys(spec.lengths).map(Number).sort(function (a, b) { return a - b; });
    var want = Number(requested) || presets[0], pick = presets[0];
    presets.forEach(function (p) { if (p <= want) pick = p; });
    return pick;
  }

  function getScenes(spec, length, lang) {
    var f = (spec.wordFactor && spec.wordFactor[lang]) || 1;
    return spec.lengths[String(length)].map(function (s) {
      return { key: s.key, start: s.start, end: s.end, dur: s.end - s.start,
        min: Math.max(1, Math.round(s.min * f)), max: Math.max(1, Math.round(s.max * f)) };
    });
  }

  function makeCtx(spec, input) {
    input = input || {};
    var cat = spec.categories.filter(function (c) { return c.id === input.category; })[0] || spec.categories[spec.categories.length - 1];
    var lang = input.language === "sv" ? "sv" : "en";
    var length = nearestPreset(spec, input.length || 30);
    var scenes = getScenes(spec, length, lang);
    var byKey = {};
    scenes.forEach(function (s) { byKey[s.key] = s; });
    var hookCount = clamp(input.hook_count == null ? 3 : input.hook_count, 1, 5);
    var ctaCount = clamp(input.cta_count == null ? 2 : input.cta_count, 1, 3);
    var product = str(input.product_name);
    if (/^none$/i.test(product)) product = "";
    var benefit = str(input.benefit);
    if (/^none$/i.test(benefit)) benefit = "";
    var wanted = (input.archetypes || []).filter(function (id) { return spec.archetypes.some(function (a) { return a.id === id; }); });
    var plan = unique(wanted.concat(spec.fallbackArchetypes)).slice(0, hookCount).map(function (id) {
      return spec.archetypes.filter(function (a) { return a.id === id; })[0];
    });
    var tone = spec.tones.filter(function (t) { return t.id === (input.tone || cat.tone); })[0] ||
      spec.tones.filter(function (t) { return t.id === cat.tone; })[0] || spec.tones[0];
    var strict = cat.profile === "strict";
    var allowed = spec.shots.types.filter(function (t) {
      if (strict && spec.shots.blockedForStrict.indexOf(t) >= 0) return false;
      if (cat.kind !== "app" && t === "screen_recording") return false;
      return true;
    });
    var ctx = {
      spec: spec, cat: cat, profile: cat.profile, strict: strict, lang: lang, langName: languageName(lang),
      length: length, scenes: scenes, byKey: byKey, hasSolution: !!byKey.solution,
      hookCount: hookCount, ctaCount: ctaCount, plan: plan, tone: tone,
      allowedTypes: allowed,
      demoType: cat.kind === "app" ? "screen_recording" : "product_in_use",
      resultTypes: strict ? ["ui_zoom"] : ["before_after", "ui_zoom"],
      hasProduct: !!product,
      inputs: { category: cat.id, product_name: product, benefit: benefit, pain_point: str(input.pain_point),
        audience: str(input.audience), details: str(input.details), language: lang, tone: tone.id }
    };
    ctx.inputText = [product, benefit, ctx.inputs.pain_point, ctx.inputs.audience, ctx.inputs.details].join(" ").toLowerCase();
    return ctx;
  }

  /* ------------------------------------------------------------------ prompts */

  function sceneLine(s) {
    return s.key.toUpperCase() + " " + fmtTime(s.start) + " to " + fmtTime(s.end) + ", " + s.min + " to " + s.max + " words";
  }
  function inputLines(ctx) {
    var i = ctx.inputs;
    return [
      "category: " + ctx.cat.label,
      "product_name: " + (i.product_name || "none"),
      "benefit: " + (i.benefit || "none"),
      "pain_point: " + (i.pain_point || "none"),
      "audience: " + (i.audience || "general"),
      "details: " + (i.details || "none"),
      "language: " + ctx.langName,
      "tone: " + ctx.tone.label
    ];
  }
  function unitShape(kind) {
    var v = "\"visual\":[{\"t\":\"\",\"type\":\"\",\"shot\":\"\"}]";
    if (kind === "hook") return "{\"archetype\":\"\",\"spoken\":\"\"," + v + "}";
    if (kind === "cta") return "{\"type\":\"soft or direct\",\"spoken\":\"\"," + v + "}";
    return "{\"spoken\":\"\"," + v + "}";
  }
  function kitShape(hasSolution) {
    var body = "\"body\":{\"problem\":" + unitShape("problem") + (hasSolution ? ",\"solution\":" + unitShape("solution") : "") + "}";
    return "{\"hooks\":[" + unitShape("hook") + "]," + body + ",\"ctas\":[" + unitShape("cta") + "],\"flags\":[]}";
  }

  function visualRules(ctx, keys) {
    var p = ctx.spec.prompt, out = [];
    p.visuals.forEach(function (l) { out.push(fill(l, { shot_types: ctx.allowedTypes.join(", ") })); });
    if (keys.indexOf("problem") >= 0) out.push(p.visualsProblem);
    if (keys.indexOf("solution") >= 0) out.push(fill(p.visualsSolution, { demo_type: ctx.demoType, result_types: ctx.resultTypes.join(" or ") }));
    return out;
  }
  function voiceRules(ctx) {
    var p = ctx.spec.prompt;
    var out = p.voice.map(function (l) { return fill(l, { language: ctx.langName, tone: ctx.tone.label }); });
    if (ctx.strict) out = out.concat(p.voiceStrict);
    if (ctx.hasSolution) out = out.concat(p.voiceSolution);
    return out;
  }

  function buildKitPrompt(ctx) {
    var p = ctx.spec.prompt, L = [], vars = { length: ctx.length, language: ctx.langName, hook_count: ctx.hookCount,
      cta_count: ctx.ctaCount, product_name: ctx.inputs.product_name, pivot: ctx.cat.pivot };
    p.role.forEach(function (l) { L.push(fill(l, vars)); });
    L.push("", fill(p.scenePlanIntro, vars));
    ctx.scenes.forEach(function (s) { L.push(sceneLine(s)); });
    L.push("", fill(p.jobs.hook, vars), fill(p.jobs.problem, vars));
    if (ctx.hasSolution) L.push(fill(ctx.hasProduct ? p.jobs.solutionProduct : p.jobs.solutionCategory, vars));
    L.push(fill(p.jobs.cta, vars));
    L.push("", p.archetypesIntro);
    ctx.plan.forEach(function (a) { L.push("- " + a.label + ": " + a.definition); });
    L.push("");
    if (ctx.hasSolution) p.body.forEach(function (l) { L.push(fill(l, vars)); }); else L.push(p.body12);
    L.push(p.isolation);
    p.ctaRules.forEach(function (l) { L.push(l); });
    if (ctx.hasProduct) L.push(fill(p.ctaProduct, vars));
    if (!ctx.inputs.benefit) L.push(p.noBenefit);
    L.push(ctx.inputs.details ? p.detailsRule : p.noDetails);
    L.push("");
    visualRules(ctx, ctx.hasSolution ? ["problem", "solution"] : ["problem"]).forEach(function (l) { L.push(l); });
    L.push("");
    voiceRules(ctx).forEach(function (l) { L.push(l); });
    L.push(p.flags, "", p.shapeIntro, kitShape(ctx.hasSolution));
    if (!ctx.hasSolution) L.push(p.shapeSolutionNote);
    return { system: L.join("\n"), user: inputLines(ctx).join("\n") };
  }

  function splitKey(key) { var a = key.split(":"); return { kind: a[0], index: a[1] == null ? 0 : Number(a[1]) }; }

  function buildRepairPrompt(ctx, key, current, issues, note, neighbour) {
    var spec = ctx.spec, p = spec.prompt, k = splitKey(key), scene = ctx.byKey[k.kind];
    var vars = { language: ctx.langName, hook_count: 1, cta_count: 1, product_name: ctx.inputs.product_name, pivot: ctx.cat.pivot };
    var L = [spec.repair.role, unitShape(k.kind), "", "Scene: " + sceneLine(scene)];
    if (k.kind === "hook") {
      var a = ctx.plan[k.index];
      L.push(fill(p.jobs.hook, vars), "Archetype: " + a.label + ": " + a.definition, p.isolation);
    } else if (k.kind === "cta") {
      L.push(fill(p.jobs.cta, vars), p.isolation, current.type === "soft" ? "This CTA is soft (follow, save or comment). One action." : "This CTA is direct (buy, claim or tap the link). One action.");
      if (ctx.hasProduct && current.type !== "soft") L.push(fill(p.ctaProduct, vars));
    } else if (k.kind === "problem") {
      L.push(fill(p.jobs.problem, vars), p.isolation);
    } else {
      L.push(fill(ctx.hasProduct ? p.jobs.solutionProduct : p.jobs.solutionCategory, vars), fill(p.body[0], vars));
    }
    L.push("");
    visualRules(ctx, [k.kind]).forEach(function (l) { L.push(l); });
    L.push("");
    voiceRules(ctx).forEach(function (l) { L.push(l); });
    var tilingHint = issues.some(function (i) { return i.code === "tiling"; })
      ? "Use these shot lengths in seconds, in order: " + defaultTiling(scene.dur).join(", ") + "." : "";
    var U = inputLines(ctx);
    U.push("", "Current version:", JSON.stringify(current), "", spec.repair.fixIntro);
    issues.forEach(function (i) { U.push("- " + i.message); });
    if (tilingHint) U.push(tilingHint);
    if (neighbour) U.push("", neighbour);
    if (note) U.push("", spec.repair.userNote + " " + note);
    return { system: L.join("\n"), user: U.join("\n"), max_tokens: 4000 };
  }

  function buildAutofillPrompt(spec, a) {
    var lang = languageName(a.language === "sv" ? "sv" : "en");
    var cat = spec.categories.filter(function (c) { return c.id === a.category; })[0] || spec.categories[spec.categories.length - 1];
    var L = [spec.autofill.role, spec.autofill.shape, ""];
    spec.autofill.rules.forEach(function (r) { L.push(fill(r, { language: lang })); });
    var U = ["category: " + cat.label, "product_name: " + (str(a.product_name) || "none"), "what_it_is: " + (str(a.description) || "none"), "language: " + lang];
    return { system: L.join("\n"), user: U.join("\n"), max_tokens: 4000 };
  }

  /* ------------------------------------------------------------------ parsing */

  function extractJson(text) {
    var s = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    var a = s.indexOf("{"), b = s.lastIndexOf("}");
    if (a < 0 || b < a) throw new Error("The model did not return JSON.");
    var body = s.slice(a, b + 1);
    try { return JSON.parse(body); } catch (e) {
      return JSON.parse(body.replace(/,\s*([}\]])/g, "$1"));
    }
  }

  function normShot(r) {
    r = r || {};
    return { t: str(r.t), type: str(r.type), shot: str(r.shot != null ? r.shot : (r.text != null ? r.text : r.description)) };
  }
  function normUnit(r) {
    r = r || {};
    return { spoken: str(r.spoken), visual: (Array.isArray(r.visual) ? r.visual : []).map(normShot) };
  }

  function normalizeKit(ctx, raw) {
    raw = raw || {};
    var body = raw.body || raw;
    var kit = { length: ctx.length, hooks: [], body: { id: "B1", problem: normUnit(body.problem), solution: null }, ctas: [], flags: [] };
    var i;
    for (i = 0; i < ctx.hookCount; i++) {
      var h = normUnit((raw.hooks || [])[i]);
      h.id = "H" + (i + 1); h.archetype = ctx.plan[i].label; h.archetypeId = ctx.plan[i].id;
      kit.hooks.push(h);
    }
    if (ctx.hasSolution) kit.body.solution = normUnit(body.solution);
    for (i = 0; i < ctx.ctaCount; i++) {
      var c = normUnit((raw.ctas || [])[i]);
      c.id = "C" + (i + 1); c.type = (i === 0 && ctx.ctaCount >= 2) ? "soft" : "direct";
      kit.ctas.push(c);
    }
    kit.flags = (Array.isArray(raw.flags) ? raw.flags : []).map(str).filter(Boolean);
    return kit;
  }

  /* ------------------------------------------------------------------ unit access */

  function unitKeys(ctx) {
    var keys = [], i;
    for (i = 0; i < ctx.hookCount; i++) keys.push("hook:" + i);
    keys.push("problem");
    if (ctx.hasSolution) keys.push("solution");
    for (i = 0; i < ctx.ctaCount; i++) keys.push("cta:" + i);
    return keys;
  }
  function unitRef(kit, key) {
    var k = splitKey(key);
    if (k.kind === "hook") return kit.hooks[k.index];
    if (k.kind === "cta") return kit.ctas[k.index];
    return kit.body[k.kind];
  }
  function unitLabel(kit, key) {
    var k = splitKey(key);
    if (k.kind === "hook") return kit.hooks[k.index].id;
    if (k.kind === "cta") return kit.ctas[k.index].id;
    return k.kind === "problem" ? "B1 problem" : "B1 solution";
  }
  function replaceUnit(kit, key, fresh) {
    var u = unitRef(kit, key);
    u.spoken = fresh.spoken; u.visual = fresh.visual;
  }

  /* ------------------------------------------------------------------ auto fixes */

  function dashRegex(ctx) { return new RegExp(ctx.spec.dashes, "g"); }
  function tidy(s) { return s.replace(/\s+,/g, ",").replace(/,\s*,/g, ",").replace(/\s{2,}/g, " ").trim(); }

  function autoFixUnit(ctx, unit) {
    var re = dashRegex(ctx), changed = false;
    function fix(s) { var n = tidy(String(s).replace(re, ", ")); if (n !== s) changed = true; return n; }
    unit.spoken = fix(unit.spoken);
    unit.visual.forEach(function (sh) {
      sh.shot = fix(sh.shot);
      var r = parseRange(sh.t);
      if (r) sh.t = fmtTime(r[0]) + " to " + fmtTime(r[1]);
    });
    return changed;
  }

  /* ------------------------------------------------------------------ checks */

  function allTexts(unit) { return [unit.spoken].concat(unit.visual.map(function (s) { return s.shot; })); }

  function checkShots(ctx, scene, unit, issues) {
    var shots = unit.visual, spec = ctx.spec, problems = [];
    if (!shots.length) { issues.push({ code: "tiling", message: "No shots were given. Give shots that fill " + fmtTime(scene.start) + " to " + fmtTime(scene.end) + "." }); return; }
    var cursor = scene.start;
    shots.forEach(function (s, i) {
      if (ctx.allowedTypes.indexOf(s.type) < 0) {
        var blocked = spec.shots.types.indexOf(s.type) >= 0 && ctx.strict && spec.shots.blockedForStrict.indexOf(s.type) >= 0;
        issues.push({ code: blocked ? "blockedType" : "shotType",
          message: "Shot " + (i + 1) + " uses type \"" + s.type + "\", which is not allowed here. Allowed: " + ctx.allowedTypes.join(", ") + "." });
      }
      var r = parseRange(s.t);
      if (!r) { problems.push("Shot " + (i + 1) + " has an unreadable time \"" + s.t + "\"."); return; }
      if (r[0] !== cursor) problems.push("Shot " + (i + 1) + " starts at " + fmtTime(r[0]) + " but should start at " + fmtTime(cursor) + ".");
      var d = r[1] - r[0];
      if (d < spec.shots.minSeconds || d > spec.shots.maxSeconds) problems.push("Shot " + (i + 1) + " lasts " + d + " seconds, it must be " + spec.shots.minSeconds + " or " + spec.shots.maxSeconds + ".");
      cursor = r[1];
      if (s.type === "text_pop" && countWords(s.shot) > spec.shots.textPopMaxWords) {
        issues.push({ code: "textpop", message: "Shot " + (i + 1) + " is a text_pop with " + countWords(s.shot) + " words, the maximum is " + spec.shots.textPopMaxWords + "." });
      }
    });
    if (cursor !== scene.end) problems.push("The last shot ends at " + fmtTime(cursor) + " but the scene ends at " + fmtTime(scene.end) + ".");
    if (problems.length) issues.push({ code: "tiling", message: problems.join(" ") });
  }

  function scanText(ctx, unit, issues, warnings) {
    var spec = ctx.spec, texts = allTexts(unit), seen = {};
    Object.keys(spec.scans).forEach(function (name) {
      var sc = spec.scans[name];
      if (sc.profiles.indexOf(ctx.profile) < 0) return;
      var re = new RegExp(sc.pattern, "i");
      texts.forEach(function (t) {
        var m = re.exec(t);
        if (!m) return;
        var w = m[0].toLowerCase();
        if (seen[w]) return;
        seen[w] = true;
        if (ctx.inputText.indexOf(w) >= 0) {
          warnings.push("\"" + w + "\" comes from your brief. Check it is allowed for your market.");
        } else {
          issues.push({ code: "claims", scan: name, message: "\"" + w + "\" is not allowed: " + sc.reason + "." });
        }
      });
    });
    var numRe = /\d+(?:[.,]\d+)?/g, wordRe = new RegExp("\\b(" + spec.numberWords.join("|") + ")\\b", "gi"), nseen = {};
    texts.forEach(function (t) {
      var found = (t.match(numRe) || []).concat(t.match(wordRe) || []);
      found.forEach(function (n) {
        var low = n.toLowerCase();
        if (nseen[low] || ctx.inputText.indexOf(low) >= 0) return;
        nseen[low] = true;
        issues.push({ code: "numbers", message: "\"" + n + "\" is a number that is not in the brief. Remove it." });
      });
    });
  }

  function checkUnit(ctx, kit, key) {
    var k = splitKey(key), scene = ctx.byKey[k.kind], unit = unitRef(kit, key), spec = ctx.spec;
    var issues = [], warnings = [];
    if (!unit || !unit.spoken) {
      issues.push({ code: "words", message: "There is no spoken text. Write " + scene.min + " to " + scene.max + " words." });
    } else {
      var w = countWords(unit.spoken);
      if (w < scene.min || w > scene.max) {
        issues.push({ code: "words", message: "The spoken text has " + w + " words but the allowed range is " + scene.min + " to " + scene.max + " words." });
      }
    }
    if (!unit) return { issues: issues, warnings: warnings };
    checkShots(ctx, scene, unit, issues);
    if (k.kind === "problem") {
      var br = unit.visual.filter(function (s) { return s.type === "b_roll"; }).length;
      if (unit.visual.length && br * 2 < unit.visual.length) {
        issues.push({ code: "broll", message: "Only " + br + " of " + unit.visual.length + " shots are b_roll. At least half must be b_roll." });
      }
    }
    if (k.kind === "solution") {
      if (!unit.visual.some(function (s) { return s.type === ctx.demoType; })) issues.push({ code: "demo", message: "The SOLUTION needs a demo shot of type " + ctx.demoType + "." });
      if (!unit.visual.some(function (s) { return ctx.resultTypes.indexOf(s.type) >= 0; })) issues.push({ code: "result", message: "The SOLUTION needs a result shot of type " + ctx.resultTypes.join(" or ") + "." });
      if (new RegExp(spec.firstPerson, "i").test(unit.spoken)) issues.push({ code: "firstperson", message: "The SOLUTION must not use first person (I, my, me). Describe the product in use in neutral words." });
      if (ctx.hasProduct && unit.spoken.toLowerCase().indexOf(ctx.inputs.product_name.toLowerCase()) < 0) issues.push({ code: "product", message: "The SOLUTION must name " + ctx.inputs.product_name + "." });
    }
    if (k.kind === "cta" && ctx.hasProduct && unit.type === "direct" && unit.spoken.toLowerCase().indexOf(ctx.inputs.product_name.toLowerCase()) < 0) {
      issues.push({ code: "product", message: "A direct CTA must name " + ctx.inputs.product_name + "." });
    }
    if (dashRegex(ctx).test(allTexts(unit).join(" "))) issues.push({ code: "dashes", message: "Remove every em dash and en dash." });
    scanText(ctx, unit, issues, warnings);
    return { issues: issues, warnings: unique(warnings) };
  }

  function validateKit(ctx, kit) {
    var report = { units: {}, failing: [], warnings: [], fixes: [] };
    unitKeys(ctx).forEach(function (key) {
      var unit = unitRef(kit, key);
      if (unit && autoFixUnit(ctx, unit)) report.fixes.push({ key: key, code: "dashes" });
      var r = checkUnit(ctx, kit, key);
      report.units[key] = r;
      if (r.issues.length) report.failing.push(key);
      r.warnings.forEach(function (w) { if (report.warnings.indexOf(w) < 0) report.warnings.push(w); });
    });
    return report;
  }

  /* ------------------------------------------------------------------ repair loop */

  function neighbourNote(kit, key) {
    var k = splitKey(key);
    if (k.kind === "solution") return "Problem scene, for the pivot: " + kit.body.problem.spoken;
    if (k.kind === "problem" && kit.body.solution) return "Solution scene, so the pair still connects: " + kit.body.solution.spoken;
    return "";
  }

  /* callModel({system, user, max_tokens}) must return the model's text. Repairs run one scene
     at a time, only for scenes that failed, at most spec.limits.maxRetries rounds. */
  async function repairKit(ctx, kit, callModel, opts) {
    opts = opts || {};
    var rounds = opts.maxRetries == null ? ctx.spec.limits.maxRetries : opts.maxRetries;
    var log = [], report = validateKit(ctx, kit), attempt, i;
    report.fixes.forEach(function (f) { log.push({ key: f.key, attempt: 0, codes: ["dashes"], auto: true }); });
    for (attempt = 1; attempt <= rounds && report.failing.length; attempt++) {
      var keys = report.failing.slice();
      for (i = 0; i < keys.length; i++) {
        var key = keys[i], issues = report.units[key].issues;
        var entry = { key: key, attempt: attempt, codes: unique(issues.map(function (x) { return x.code; })), messages: issues.map(function (x) { return x.message; }),
          wordsBefore: countWords(unitRef(kit, key).spoken) };
        var p = buildRepairPrompt(ctx, key, { type: unitRef(kit, key).type, archetype: unitRef(kit, key).archetype, spoken: unitRef(kit, key).spoken, visual: unitRef(kit, key).visual }, issues, "", neighbourNote(kit, key));
        try {
          var text = await callModel({ system: p.system, user: p.user, max_tokens: p.max_tokens, purpose: "repair", key: key });
          replaceUnit(kit, key, normUnit(extractJson(text)));
          entry.wordsAfter = countWords(unitRef(kit, key).spoken);
        } catch (e) { entry.error = String(e && e.message || e); }
        log.push(entry);
      }
      report = validateKit(ctx, kit);
    }
    return { kit: kit, report: report, log: log };
  }

  async function regenerateUnit(ctx, kit, key, callModel, note) {
    var u = unitRef(kit, key);
    var p = buildRepairPrompt(ctx, key, { type: u.type, archetype: u.archetype, spoken: u.spoken, visual: u.visual },
      [{ code: "regen", message: "Write a fresh, different version." }], note || "", neighbourNote(kit, key));
    var text = await callModel({ system: p.system, user: p.user, max_tokens: p.max_tokens, purpose: "regenerate", key: key });
    replaceUnit(kit, key, normUnit(extractJson(text)));
    return repairKit(ctx, kit, callModel, {});
  }

  /* One full kit: build, call, parse, normalise, repair. */
  async function generateKit(ctx, callModel, opts) {
    var p = buildKitPrompt(ctx), est = estimateRun(ctx);
    var text = await callModel({ system: p.system, user: p.user, max_tokens: kitMaxTokens(est), purpose: "kit" });
    var kit = normalizeKit(ctx, extractJson(text));
    var res = await repairKit(ctx, kit, callModel, opts || {});
    var extra = res.report.warnings.slice();
    if (ctx.hasProduct && !ctx.inputs.details) extra.push("No product details were given, so the scripts describe actions only. Add the real features for richer scripts.");
    res.kit.flags = unique(res.kit.flags.concat(extra));
    return res;
  }

  /* ------------------------------------------------------------------ report for the UI */

  var CHECK_MAP = {
    words: "words", tiling: "shots", shotType: "shots", textpop: "shots", broll: "shots", demo: "shots", result: "shots",
    dashes: "dashes", claims: "compliance", firstperson: "compliance", blockedType: "compliance",
    numbers: "numbers", product: "swap"
  };

  function buildChecks(ctx, report, log) {
    var defs = [
      { id: "words", title: "Word counts in every scene", ok: "Counted in code against the " + ctx.length + "s ranges." },
      { id: "shots", title: "Shot times tile each scene exactly", ok: "No gaps, no overlaps, every shot 2 or 3 seconds, problem shots mostly b_roll." },
      { id: "dashes", title: "No em dashes or en dashes", ok: "Scanned spoken text, shot text and on-screen words." },
      { id: "compliance", title: "Compliance profile: " + ctx.cat.label + " (" + ctx.profile + ")", ok: "No medical or curative wording, no fear framing, no blocked shot types." },
      { id: "numbers", title: "No invented numbers or claims", ok: "No numbers, reviews or awards that are not in your brief." },
      { id: "swap", title: "Hooks and CTAs are swappable", ok: ctx.hasProduct ? "The direct CTA and the solution name the product." : "No product is named, so none is required." }
    ];
    var remaining = {};
    report.failing.forEach(function (k) {
      report.units[k].issues.forEach(function (i) { var c = CHECK_MAP[i.code]; if (c) (remaining[c] = remaining[c] || []).push(i.message); });
    });
    return defs.map(function (d) {
      var fixedKeys = unique(log.filter(function (e) {
        return (e.codes || []).some(function (c) { return CHECK_MAP[c] === d.id; });
      }).map(function (e) { return e.key; }));
      if (remaining[d.id]) return { id: d.id, title: d.title, state: "fail", detail: "Still failing after " + ctx.spec.limits.maxRetries + " repairs: " + remaining[d.id][0] };
      if (fixedKeys.length) {
        var what = d.id === "dashes" ? "Dashes were replaced automatically." : "Fixed by regenerating only: " + fixedKeys.join(", ") + ". The rest of the kit was left alone.";
        return { id: d.id, title: d.title, state: "edited", detail: what };
      }
      return { id: d.id, title: d.title, state: "pass", detail: d.ok };
    });
  }

  /* ------------------------------------------------------------------ variants and exports */

  function makeVariants(kit) {
    var out = [], n = 1;
    kit.hooks.forEach(function (h, hi) {
      kit.ctas.forEach(function (c, ci) {
        out.push({ id: "V" + n++, hookIndex: hi, ctaIndex: ci, label: h.id + " + B1 + " + c.id, note: h.archetype + ", " + c.type + " CTA" });
      });
    });
    return out;
  }
  function variantParts(kit, v) {
    var parts = [kit.hooks[v.hookIndex].spoken, kit.body.problem.spoken];
    if (kit.body.solution) parts.push(kit.body.solution.spoken);
    parts.push(kit.ctas[v.ctaIndex].spoken);
    return parts;
  }
  function variantScript(kit, v) { return variantParts(kit, v).join("\n"); }
  function variantWords(kit, v) { return variantParts(kit, v).reduce(function (n, s) { return n + countWords(s); }, 0); }

  function csvCell(s) { return "\"" + String(s == null ? "" : s).replace(/"/g, "\"\"") + "\""; }
  function variantsCsv(kit, variants) {
    var rows = [["variant", "hook_id", "hook_archetype", "hook", "problem", "solution", "cta_id", "cta_type", "cta", "total_words"].join(",")];
    variants.forEach(function (v) {
      var h = kit.hooks[v.hookIndex], c = kit.ctas[v.ctaIndex];
      rows.push([v.label, h.id, h.archetype, h.spoken, kit.body.problem.spoken, kit.body.solution ? kit.body.solution.spoken : "", c.id, c.type, c.spoken, variantWords(kit, v)].map(csvCell).join(","));
    });
    return rows.join("\n");
  }

  function t2iPrompts(ctx, kit, anchor, variants) {
    var hooks = {}, ctas = {};
    variants.forEach(function (v) { hooks[v.hookIndex] = true; ctas[v.ctaIndex] = true; });
    var units = [];
    kit.hooks.forEach(function (h, i) { if (hooks[i]) units.push([h.id, h]); });
    units.push(["B1 problem", kit.body.problem]);
    if (kit.body.solution) units.push(["B1 solution", kit.body.solution]);
    kit.ctas.forEach(function (c, i) { if (ctas[i]) units.push([c.id, c]); });
    var out = [];
    units.forEach(function (pair) {
      pair[1].visual.forEach(function (s) {
        if (ctx.spec.shots.t2iTypes.indexOf(s.type) < 0) return;
        out.push(pair[0] + " | " + s.t + " | " + s.type + "\n" + [str(anchor), s.shot, "Vertical 9:16."].filter(Boolean).join(" "));
      });
    });
    return out.join("\n\n");
  }

  /* ------------------------------------------------------------------ estimates */

  function estimateOutput(ctx, hookCount, ctaCount) {
    var total = 24;
    ctx.scenes.forEach(function (s) {
      var n = s.key === "hook" ? hookCount : (s.key === "cta" ? ctaCount : 1);
      var perUnit = ((s.min + s.max) / 2) * 1.4 + Math.ceil(s.dur / 2.5) * 34 + 14;
      total += n * perUnit;
    });
    return Math.round(total);
  }

  function estimateRun(ctx) {
    var p = buildKitPrompt(ctx);
    var tokensIn = estimateTokens(p.system) + estimateTokens(p.user);
    var tokensOut = estimateOutput(ctx, ctx.hookCount, ctx.ctaCount);
    var variants = ctx.hookCount * ctx.ctaCount;
    /* Old way: one call per variant, each with the same prompt built for one hook and one CTA. */
    var one = makeCtxFrom(ctx, 1, 1), op = buildKitPrompt(one);
    var oldIn = (estimateTokens(op.system) + estimateTokens(op.user)) * variants;
    var oldOut = estimateOutput(one, 1, 1) * variants;
    return { calls: 1, variants: variants, tokensIn: tokensIn, tokensOut: tokensOut,
      oldCalls: variants, oldIn: oldIn, oldOut: oldOut };
  }
  function makeCtxFrom(ctx, hookCount, ctaCount) {
    var c = Object.assign({}, ctx);
    c.hookCount = hookCount; c.ctaCount = ctaCount; c.plan = ctx.plan.slice(0, hookCount);
    return c;
  }
  /* Generous on purpose: some models spend part of max_tokens on hidden thinking, and a tight
     limit then leaves no room for the answer. Unused budget is not billed. */
  function kitMaxTokens(est) { return Math.max(6000, Math.round(est.tokensOut * 2 + 3000)); }

  /* ------------------------------------------------------------------ auto-fill */

  function parseAutofill(spec, category, raw) {
    var cat = spec.categories.filter(function (c) { return c.id === category; })[0] || spec.categories[spec.categories.length - 1];
    var removed = 0;
    function ok(s) {
      s = str(s);
      if (!s) return false;
      if (new RegExp(spec.dashes).test(s)) s = s.replace(new RegExp(spec.dashes, "g"), ", ");
      var bad = Object.keys(spec.scans).some(function (n) {
        var sc = spec.scans[n];
        return sc.profiles.indexOf(cat.profile) >= 0 && new RegExp(sc.pattern, "i").test(s);
      }) || /\d/.test(s);
      if (bad) removed++;
      return !bad;
    }
    function clean(s) { return tidy(String(s).replace(new RegExp(spec.dashes, "g"), ", ")); }
    var pains = (Array.isArray(raw.pain_points) ? raw.pain_points : []).filter(ok).map(clean);
    var bens = (Array.isArray(raw.benefits) ? raw.benefits : []).filter(ok).map(clean);
    var aud = str(raw.audience);
    return { pain_points: pains, benefits: bens, audience: ok(aud) ? clean(aud) : "", removed: removed };
  }

  return {
    countWords: countWords, estimateTokens: estimateTokens, fmtTime: fmtTime, parseRange: parseRange, defaultTiling: defaultTiling,
    nearestPreset: nearestPreset, getScenes: getScenes, makeCtx: makeCtx, languageName: languageName,
    buildKitPrompt: buildKitPrompt, buildRepairPrompt: buildRepairPrompt, buildAutofillPrompt: buildAutofillPrompt,
    extractJson: extractJson, normalizeKit: normalizeKit, unitKeys: unitKeys, unitRef: unitRef, unitLabel: unitLabel,
    validateKit: validateKit, checkUnit: checkUnit, repairKit: repairKit, regenerateUnit: regenerateUnit, generateKit: generateKit,
    buildChecks: buildChecks, makeVariants: makeVariants, variantScript: variantScript, variantWords: variantWords,
    variantsCsv: variantsCsv, t2iPrompts: t2iPrompts, estimateRun: estimateRun, kitMaxTokens: kitMaxTokens,
    parseAutofill: parseAutofill
  };
});
