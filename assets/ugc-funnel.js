/* ScriptForge AI UGC Funnel: browser screen.

   ADDITIVE ONLY, same contract as Long-Form Project.
   To remove the whole feature: delete the #btnUgcFunnel button and the two UGC lines
   (stylesheet and the two scripts) in scriptforge/index.html. Nothing else depends on this file.

   Needs, from app.js: els, FORMAT_PROVIDER_META, charGetAll, buildAnchorPhrase.
   Needs, from the other files: window.UGCFunnelCore (assets/ugc-funnel-core.js) and the spec JSON.
   Every model call goes through the same-origin relay /api/format. The key is used once per
   request and never stored. Model text is only ever put on the page with textContent. */
(function () {
  "use strict";
  if (!window.UGCFunnelCore) return;
  var Core = window.UGCFunnelCore;
  var SPEC_URL = "/assets/ugc/funnel.spec.json?v=1";
  var LS_KEY = "sf_ugc_kits_v1";
  var spec = null, overlay = null, state = null;

  /* ---------------------------------------------------------------- tiny DOM helpers */

  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === "class") el.className = attrs[k];
      else if (k === "text") el.textContent = attrs[k];
      else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== false && attrs[k] != null) el.setAttribute(k, attrs[k] === true ? "" : attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c != null) el.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return el;
  }
  function field(label, control, hint) {
    return h("label", { class: "ugc-field" }, [h("span", { class: "ugc-lab", text: label }), control, hint ? h("span", { class: "ugc-hint", text: hint }) : null]);
  }
  function select(id, options, value) {
    var s = h("select", { id: id });
    options.forEach(function (o) { s.appendChild(h("option", { value: o[0], text: o[1] })); });
    if (value != null) s.value = value;
    return s;
  }
  function $(id) { return document.getElementById(id); }
  function val(id) { var e = $(id); return e ? e.value.trim() : ""; }
  function fmtN(n) { return Math.round(n).toLocaleString("en-US"); }

  function download(name, text, type) {
    var url = URL.createObjectURL(new Blob([text], { type: type || "text/plain" }));
    var a = h("a", { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }
  function copy(text, btn) {
    var done = function () { if (btn) { var o = btn.textContent; btn.textContent = "Copied"; setTimeout(function () { btn.textContent = o; }, 1200); } };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, done); else done();
  }
  function status(msg, bad) {
    var s = $("ugcStatus"); if (!s) return;
    s.textContent = msg || ""; s.className = "ugc-status" + (bad ? " bad" : "");
  }

  /* ---------------------------------------------------------------- model call through the relay */

  function currentProvider() {
    var provider = (typeof els !== "undefined" && els.formatProvider && els.formatProvider.value) || "anthropic";
    var meta = FORMAT_PROVIDER_META[provider];
    var key = (els[meta.keyEl].value || "").trim();
    var model = els[meta.modelEl].value;
    return { provider: provider, meta: meta, key: key, model: model };
  }

  async function callModel(req) {
    var p = currentProvider();
    if (!p.key || (p.provider === "anthropic" && p.key === "sk-ant-YOUR_KEY_HERE")) {
      throw new Error("Enter your " + p.meta.label + " API key in the main ScriptForge panel first (" + p.meta.keyUrl + ").");
    }
    var body = JSON.stringify({ provider: p.provider, apiKey: p.key, model: p.model, max_tokens: req.max_tokens || 2000,
      system: req.system, messages: [{ role: "user", content: req.user }] });
    var res;
    try { res = await fetch("/api/format", { method: "POST", headers: { "Content-Type": "application/json" }, body: body }); }
    catch (e) {
      await new Promise(function (r) { setTimeout(r, 900); });
      res = await fetch("/api/format", { method: "POST", headers: { "Content-Type": "application/json" }, body: body });
    }
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error((data && data.error && data.error.message) || ("HTTP " + res.status));
    var text = (data.content || []).filter(function (b) { return b.type === "text"; }).map(function (b) { return b.text; }).join("\n").trim();
    if (!text) {
      var why = data.stop_reason ? " (stop reason: " + data.stop_reason + ")" : "";
      throw new Error("The model returned no text" + why + ". " + (data.stop_reason === "max_tokens" ? "It ran out of output room before answering, try again or pick a model without extended thinking." : "Try again, or check the model name for " + p.meta.label + "."));
    }
    return text;
  }

  /* ---------------------------------------------------------------- inputs */

  function readInput(painOverride) {
    var archetypes = Array.prototype.slice.call(overlay.querySelectorAll("input[name=ugcArch]:checked")).map(function (e) { return e.value; });
    var confirmed = $("ugcBenefitOk") && $("ugcBenefitOk").checked;
    var cat = spec.categories.filter(function (c) { return c.id === val("ugcCategory"); })[0];
    var benefit = val("ugcBenefit");
    if (cat && cat.profile === "strict" && !confirmed) benefit = "";
    return {
      category: val("ugcCategory"), product_name: val("ugcProduct"), brand: val("ugcBrand"), benefit: benefit,
      pain_point: painOverride != null ? painOverride : val("ugcPain").split("\n")[0].trim(), audience: val("ugcAudience"), details: val("ugcWhat"),
      language: val("ugcLang"), length: Number(val("ugcLength")), tone: val("ugcTone"),
      hook_count: Number(val("ugcHooks")), cta_count: Number(val("ugcCtas")), archetypes: archetypes
    };
  }
  function painList() {
    return val("ugcPain").split("\n").map(function (s) { return s.trim(); }).filter(Boolean).slice(0, spec.limits.maxPainsPerBatch);
  }

  function refreshEstimate() {
    var box = $("ugcEstimate"); if (!box || !spec) return;
    var list = painList(), n = Math.max(1, list.length);
    var ctx = Core.makeCtx(spec, readInput(list[0] || ""));
    var e = Core.estimateRun(ctx);
    var vars = e.variants * n;
    box.textContent = "";
    [["Kits to generate", String(n)], ["Variants", String(vars)], ["Model calls", String(n) + " (plus small repairs only if needed)"],
      ["Tokens, this way", "about " + fmtN((e.tokensIn + e.tokensOut) * n)],
      ["Tokens, one call per variant", "about " + fmtN((e.oldIn + e.oldOut) * n)]].forEach(function (r) {
      box.appendChild(h("div", { class: "ugc-row" }, [h("span", { text: r[0] }), h("b", { text: r[1] })]));
    });
    var saved = 1 - (e.tokensIn + e.tokensOut) / (e.oldIn + e.oldOut);
    box.appendChild(h("div", { class: "ugc-save", text: "Estimated saving: about " + Math.round(saved * 100) + "%. Estimates use text length divided by 4, not the provider's own count." }));
    var ctxTone = $("ugcTone");
    if (ctxTone && ctxTone.dataset.auto === "1") ctxTone.value = ctx.cat.tone;
  }

  /* ---------------------------------------------------------------- auto-fill */

  async function autofill() {
    var btn = $("ugcAutofill");
    var product = val("ugcProduct");
    btn.disabled = true; status("Suggesting pain points, an audience and benefits...");
    try {
      var p = Core.buildAutofillPrompt(spec, { category: val("ugcCategory"), product_name: (val("ugcBrand") + " " + product).trim(), description: val("ugcWhat"), language: val("ugcLang") });
      var text = await callModel({ system: p.system, user: p.user, max_tokens: p.max_tokens });
      var parsedAf;
      try { parsedAf = Core.extractJson(text); } catch (parseErr) {
        text = await callModel({ system: p.system, user: p.user + "\n\nYour previous reply was not valid JSON. Return it again with no double quote characters inside text values.", max_tokens: p.max_tokens });
        parsedAf = Core.extractJson(text);
      }
      var out = Core.parseAutofill(spec, val("ugcCategory"), parsedAf);
      if (out.pain_points.length) $("ugcPain").value = out.pain_points.join("\n");
      if (out.audience && !val("ugcAudience")) $("ugcAudience").value = out.audience;
      if (out.benefits.length) { $("ugcBenefit").value = out.benefits[0]; $("ugcBenefitSuggest").textContent = "Other suggestions: " + out.benefits.slice(1).join(" | "); }
      $("ugcBenefitOk").checked = false;
      status("Suggestions filled in. Edit them, and tick the benefit box only if it is true." + (out.removed ? " " + out.removed + " risky suggestion(s) were dropped." : ""));
    } catch (e) { status(String(e.message || e), true); }
    btn.disabled = false; refreshEstimate();
  }

  /* ---------------------------------------------------------------- generate */

  async function generate() {
    var btn = $("ugcGenerate"), list = painList();
    if (!val("ugcCategory")) { status("Pick a category first.", true); return; }
    if (!list.length) list = [""];
    btn.disabled = true; state.kits = []; state.current = 0;
    try {
      for (var i = 0; i < list.length; i++) {
        status("Generating kit " + (i + 1) + " of " + list.length + "...");
        var ctx = Core.makeCtx(spec, readInput(list[i]));
        var res = await Core.generateKit(ctx, callModel, {});
        state.kits.push({ ctx: ctx, kit: res.kit, report: res.report, log: res.log, pain: list[i], variants: Core.makeVariants(res.kit) });
        state.current = state.kits.length - 1;
        renderResults();
      }
      status("Done. " + state.kits.length + " kit(s) ready.");
      persistKits();
    } catch (e) {
      status(String(e.message || e), true);
      if (state.kits.length) renderResults();
    }
    btn.disabled = false;
  }

  async function regenerate(key) {
    var k = state.kits[state.current], note = "";
    status("Rewriting " + Core.unitLabel(k.kit, key) + "...");
    try {
      var res = await Core.regenerateUnit(k.ctx, k.kit, key, callModel, note);
      k.report = res.report; k.log = (k.log || []).concat(res.log); k.variants = Core.makeVariants(k.kit);
      renderResults(); persistKits(); status("Rewritten. Only that scene was touched.");
    } catch (e) { status(String(e.message || e), true); }
  }

  /* ---------------------------------------------------------------- results */

  function shotRows(unit) {
    return h("div", { class: "ugc-shots" }, unit.visual.map(function (s) {
      return h("div", { class: "ugc-shot" }, [h("span", { class: "ugc-tc", text: s.t }), h("span", { class: "ugc-type", text: s.type }), h("span", { text: s.shot })]);
    }));
  }
  function unitCard(k, key, title, sub) {
    var unit = Core.unitRef(k.kit, key), scene = k.ctx.byKey[key.split(":")[0]];
    var words = Core.countWords(unit.spoken), bad = k.report.units[key] && k.report.units[key].issues.length;
    return h("div", { class: "ugc-unit" + (bad ? " warn" : "") }, [
      h("div", { class: "ugc-unit-head" }, [
        h("b", { text: title }), h("span", { class: "ugc-tc", text: sub }),
        h("span", { class: "ugc-count", text: words + " words (" + scene.min + " to " + scene.max + ")" }),
        h("button", { class: "ugc-mini", text: "Rewrite", onclick: function () { regenerate(key); } }),
        h("button", { class: "ugc-mini", text: "Copy", onclick: function (e) { copy(unit.spoken, e.target); } })
      ]),
      h("p", { class: "ugc-spoken", text: unit.spoken }),
      shotRows(unit)
    ]);
  }

  function renderResults() {
    var box = $("ugcResults"); box.textContent = "";
    if (!state.kits.length) { box.appendChild(h("div", { class: "ugc-empty", text: "Your kit appears here: hooks, one body, CTAs, then every combination." })); return; }
    var k = state.kits[state.current], kit = k.kit, ctx = k.ctx;
    if (state.kits.length > 1) {
      var sel = select("ugcKitSel", state.kits.map(function (x, i) { return [String(i), "Kit " + (i + 1) + (x.pain ? ": " + x.pain.slice(0, 48) : "")]; }), String(state.current));
      sel.addEventListener("change", function () { state.current = Number(sel.value); renderResults(); });
      box.appendChild(h("div", { class: "ugc-pick" }, [sel]));
    }
    var checks = Core.buildChecks(ctx, k.report, k.log || []);
    var fails = checks.filter(function (c) { return c.state === "fail"; }).length;
    box.appendChild(h("div", { class: "ugc-strip" }, [
      h("span", { text: ctx.length + "s" }), h("span", { text: ctx.langName }), h("span", { text: ctx.cat.label + " (" + ctx.profile + ")" }),
      h("span", { text: k.variants.length + " variants" }), h("span", { class: fails ? "bad" : "ok", text: fails ? fails + " check(s) failing" : "All checks pass" })
    ]));

    box.appendChild(h("h3", { text: "Hooks" }));
    kit.hooks.forEach(function (hk, i) {
      var sc = ctx.byKey.hook;
      box.appendChild(unitCard(k, "hook:" + i, hk.id + " " + hk.archetype, Core.fmtTime(sc.start) + " to " + Core.fmtTime(sc.end)));
    });
    box.appendChild(h("h3", { text: "Body (B1)" }));
    box.appendChild(unitCard(k, "problem", "Problem", Core.fmtTime(ctx.byKey.problem.start) + " to " + Core.fmtTime(ctx.byKey.problem.end)));
    if (kit.body.solution) box.appendChild(unitCard(k, "solution", "Solution", Core.fmtTime(ctx.byKey.solution.start) + " to " + Core.fmtTime(ctx.byKey.solution.end)));
    box.appendChild(h("h3", { text: "CTAs" }));
    kit.ctas.forEach(function (c, i) {
      box.appendChild(unitCard(k, "cta:" + i, c.id + " (" + c.type + ")", Core.fmtTime(ctx.byKey.cta.start) + " to " + Core.fmtTime(ctx.byKey.cta.end)));
    });

    box.appendChild(h("h3", { text: "Variants" }));
    var table = h("div", { class: "ugc-variants" });
    k.variants.forEach(function (v) {
      table.appendChild(h("div", { class: "ugc-variant" }, [
        h("b", { text: v.label }), h("span", { class: "ugc-hint", text: v.note + ", " + Core.variantWords(kit, v) + " words" }),
        h("button", { class: "ugc-mini", text: "Copy", onclick: function (e) { copy(Core.variantScript(kit, v), e.target); } })
      ]));
    });
    box.appendChild(table);

    var row = h("div", { class: "ugc-exports" }, [
      h("button", { class: "btn-copy", text: "Copy all scripts", onclick: function (e) {
        copy(k.variants.map(function (v) { return "[" + v.label + "]\n" + Core.variantScript(kit, v); }).join("\n\n"), e.target); } }),
      h("button", { class: "btn-copy", text: "Download CSV", onclick: function () { download("ugc-variants.csv", Core.variantsCsv(kit, k.variants), "text/csv"); } }),
      h("button", { class: "btn-copy", text: "Download kit JSON", onclick: function () { download("ugc-kit.json", JSON.stringify({ input: ctx.inputs, length: ctx.length, kit: kit }, null, 2), "application/json"); } }),
      h("button", { class: "btn-copy", text: "Copy T2I prompts", onclick: function (e) { copy(Core.t2iPrompts(ctx, kit, state.anchor || "", k.variants), e.target); } })
    ]);
    box.appendChild(row);

    box.appendChild(h("h3", { text: "Validator report" }));
    checks.forEach(function (c) {
      box.appendChild(h("div", { class: "ugc-check " + c.state }, [
        h("span", { class: "ugc-dot", text: c.state === "pass" ? "OK" : (c.state === "edited" ? "FIXED" : "FAIL") }),
        h("div", {}, [h("b", { text: c.title }), h("div", { class: "ugc-hint", text: c.detail })])
      ]));
    });
    if (kit.flags.length) {
      box.appendChild(h("h3", { text: "Notes from the model and the checker" }));
      kit.flags.forEach(function (f) { box.appendChild(h("div", { class: "ugc-hint", text: f })); });
    }
  }

  /* ---------------------------------------------------------------- saved kits (this browser only) */

  function persistKits() {
    try {
      var all = JSON.parse(localStorage.getItem(LS_KEY) || "[]");
      state.kits.forEach(function (k) { all.unshift({ at: Date.now(), input: k.ctx.inputs, length: k.ctx.length, kit: k.kit }); });
      localStorage.setItem(LS_KEY, JSON.stringify(all.slice(0, spec.limits.savedKitsCap)));
    } catch (e) { /* storage can be blocked, the app works without it */ }
    renderSaved();
  }
  function renderSaved() {
    var box = $("ugcSaved"); if (!box) return; box.textContent = "";
    var all = [];
    try { all = JSON.parse(localStorage.getItem(LS_KEY) || "[]"); } catch (e) { all = []; }
    if (!all.length) { box.appendChild(h("div", { class: "ugc-hint", text: "No saved kits yet. Kits are kept in this browser only." })); return; }
    all.slice(0, 8).forEach(function (s) {
      box.appendChild(h("div", { class: "ugc-variant" }, [
        h("b", { text: (s.input.product_name || s.input.category) + ", " + s.length + "s" }),
        h("span", { class: "ugc-hint", text: new Date(s.at).toLocaleString() }),
        h("button", { class: "ugc-mini", text: "JSON", onclick: function () { download("ugc-kit.json", JSON.stringify(s, null, 2), "application/json"); } })
      ]));
    });
    box.appendChild(h("button", { class: "ugc-mini", text: "Clear saved kits", onclick: function () { try { localStorage.removeItem(LS_KEY); } catch (e) {} renderSaved(); } }));
  }

  /* ---------------------------------------------------------------- presenter */

  async function loadCharacters() {
    var sel = $("ugcChar"); if (!sel) return;
    sel.textContent = ""; sel.appendChild(h("option", { value: "", text: "None (no presenter anchor)" }));
    try {
      var list = await charGetAll();
      list.forEach(function (c) { sel.appendChild(h("option", { value: c.id, text: c.displayName || c.id })); });
      sel.onchange = function () {
        var c = list.filter(function (x) { return x.id === sel.value; })[0];
        state.anchor = c ? buildAnchorPhrase(c) : "";
      };
    } catch (e) { /* no characters yet */ }
  }

  /* ---------------------------------------------------------------- build the screen */

  function build() {
    state = { kits: [], current: 0, anchor: "" };
    var cats = spec.categories.map(function (c) { return [c.id, c.label]; });
    var lengths = Object.keys(spec.lengths).map(function (l) { return [l, l + " seconds"]; });
    var tones = spec.tones.map(function (t) { return [t.id, t.label]; });

    var left = h("div", { class: "ugc-col" }, [
      h("section", { class: "ugc-card" }, [
        h("h4", { text: "Brief" }),
        field("Category", select("ugcCategory", cats, "general")),
        field("Brand (optional)", h("input", { id: "ugcBrand", type: "text", placeholder: "For example: TORGHU" })),
        field("Product name (optional)", h("input", { id: "ugcProduct", type: "text", placeholder: "For example: Grassfield Gown. Empty for a category-level kit" })),
        field("Product details (true features only)", h("input", { id: "ugcWhat", type: "text", placeholder: "For example: multicolored dress, long sleeves" }), "Scripts describe only what you list here, so nothing is invented."),
        h("button", { id: "ugcAutofill", class: "btn-copy ugc-gold", text: "Auto-fill pain points, audience and benefits", onclick: autofill }),
        field("Pain points, one per line (each becomes a kit)", h("textarea", { id: "ugcPain", rows: "4", placeholder: "One per line, up to " + spec.limits.maxPainsPerBatch })),
        field("Audience", h("input", { id: "ugcAudience", type: "text" })),
        field("Benefit", h("input", { id: "ugcBenefit", type: "text" }), "Suggested benefits must be confirmed before they are used."),
        h("label", { class: "ugc-check-line" }, [h("input", { id: "ugcBenefitOk", type: "checkbox" }), h("span", { text: "I confirm this benefit is true" })]),
        h("div", { id: "ugcBenefitSuggest", class: "ugc-hint" }),
        h("div", { class: "ugc-hint", text: "Strict categories (skincare, haircare, supplements, wellness) only use a benefit you have confirmed." })
      ]),
      h("section", { class: "ugc-card" }, [
        h("h4", { text: "Kit setup" }),
        h("div", { class: "ugc-grid2" }, [
          field("Length", select("ugcLength", lengths, "30")), field("Language", select("ugcLang", [["en", "English"], ["sv", "Swedish"]], "en")),
          field("Hooks", select("ugcHooks", [["1", "1"], ["2", "2"], ["3", "3"], ["4", "4"], ["5", "5"]], "3")),
          field("CTAs", select("ugcCtas", [["1", "1"], ["2", "2"], ["3", "3"]], "2"))
        ]),
        field("Tone (default follows the category)", select("ugcTone", tones, "warm_honest")),
        h("div", { class: "ugc-lab", text: "Hook archetypes" }),
        h("div", { class: "ugc-archs" }, spec.archetypes.map(function (a, i) {
          return h("label", { class: "ugc-check-line" }, [h("input", { type: "checkbox", name: "ugcArch", value: a.id, checked: i < 3 }), h("span", { text: a.label })]);
        }))
      ]),
      h("section", { class: "ugc-card" }, [
        h("h4", { text: "Presenter and image prompts" }),
        field("Character anchor for image prompts", h("select", { id: "ugcChar" })),
        h("div", { class: "ugc-hint", text: "Only b_roll, product_in_use, ui_zoom and before_after shots become text-to-image prompts. Talking shots use your avatar." })
      ]),
      h("section", { class: "ugc-card" }, [
        h("h4", { text: "Run estimate" }), h("div", { id: "ugcEstimate" }),
        h("button", { id: "ugcGenerate", class: "btn-primary ugc-gold-btn", text: "Generate kit", onclick: generate }),
        h("div", { id: "ugcStatus", class: "ugc-status", role: "status" })
      ]),
      h("section", { class: "ugc-card" }, [h("h4", { text: "Saved kits" }), h("div", { id: "ugcSaved" })])
    ]);

    var right = h("div", { class: "ugc-col ugc-wide" }, [
      h("section", { class: "ugc-card" }, [h("div", { id: "ugcResults" })]),
      h("section", { class: "ugc-card ugc-rules" }, [
        h("h4", { text: "Rules that are always applied" }),
        h("ul", {}, [
          "No em dashes or en dashes, ever.", "Word counts, shot times and claims are checked in code, not trusted to the model.",
          "Only a scene that fails is rewritten, at most twice.", "No invented numbers, reviews or awards.",
          "Your keys are relayed per request and never stored."
        ].map(function (t) { return h("li", { text: t }); }))
      ])
    ]);

    overlay = h("div", { class: "lib-overlay", id: "ugcOverlay" }, [
      h("div", { class: "lib-panel ugc-panel" }, [
        h("h2", {}, [h("span", { text: "AI UGC Funnel" }), h("button", { class: "btn-copy", id: "btnUgcClose", text: "Close", onclick: function () { overlay.classList.remove("open"); } })]),
        h("div", { class: "ugc-layout" }, [left, right])
      ])
    ]);
    document.body.appendChild(overlay);
    overlay.addEventListener("click", function (e) { if (e.target === overlay) overlay.classList.remove("open"); });
    overlay.addEventListener("input", refreshEstimate);
    overlay.addEventListener("change", function (e) {
      if (e.target.id === "ugcCategory") { var t = $("ugcTone"); t.dataset.auto = "1"; }
      if (e.target.id === "ugcTone") e.target.dataset.auto = "0";
      refreshEstimate();
    });
    $("ugcTone").dataset.auto = "1";
    renderResults(); renderSaved(); refreshEstimate();
  }

  async function open() {
    if (!spec) {
      try {
        var r = await fetch(SPEC_URL, { cache: "no-cache" });
        spec = await r.json();
      } catch (e) { alert("Could not load the UGC funnel settings. Check your connection and try again."); return; }
      build();
    }
    overlay.classList.add("open");
    loadCharacters();
  }

  function init() {
    var b = document.getElementById("btnUgcFunnel");
    if (b) b.addEventListener("click", open);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
