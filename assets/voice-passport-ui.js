/* Voice Passport: browser screens.

   ADDITIVE ONLY. Two screens, both built from assets/voice-passport-core.js:
   1) a "Voice Passport" section inside the Character form (Characters library), where a
      character's ElevenLabs voice is chosen (library, design or clone), locked, and given a
      golden reference clip;
   2) a "Voiceover with a locked voice" card inside the AI UGC Funnel, next to the production
      pack, which generates every scene with the same voice and checks it.

   To remove: delete the two voice-passport script tags and the stylesheet link in
   scriptforge/index.html, the voicePassport line in readDraftFromForm() in assets/app.js, and
   the two window.VoicePassportUI lines in assets/ugc-funnel.js. Nothing else depends on this file.

   Needs, from app.js: charDraft (the character being edited), openCharForm.
   Every ElevenLabs call goes through a same-origin relay (/api/elevenlabs-*). The customer's key
   is read from the ElevenLabs field in section 7, used once per request and never stored by us.
   Text from ElevenLabs is only ever put on the page with textContent. */
(function () {
  "use strict";
  var VP = window.VoicePassportCore;
  if (!VP) return;

  /* ---------------------------------------------------------------- tiny helpers */

  function $(id) { return document.getElementById(id); }
  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (k === "text") el.textContent = v;
      else if (k === "class") el.className = v;
      else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), v);
      else if (v !== undefined && v !== null && v !== false) el.setAttribute(k, v === true ? "" : v);
    });
    (kids || []).forEach(function (c) { if (c) el.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return el;
  }
  function setStatus(el, kind, msg) {
    if (!el) return;
    el.className = "status " + (kind || "");
    el.textContent = msg || "";
    if (!msg) el.className = "status";
  }
  function getKey() { var e = $("elevenLabsKey"); return e ? e.value.trim() : ""; }
  var NEED_KEY = "Add your ElevenLabs API key in section 7 (ElevenLabs Voice) of this page first.";

  function errMsg(d, status) {
    var e = d && d.error;
    if (typeof e === "string") return e;
    if (e && typeof e.message === "string") return e.message;
    if (Array.isArray(e) && e[0] && e[0].msg) return e[0].msg;
    return "ElevenLabs request failed: HTTP " + status;
  }
  function makeError(msg, status, res) {
    var err = new Error(msg);
    err.status = status;
    err.retryable = [409, 429, 500, 502, 503, 504].indexOf(status) >= 0;
    var ra = res && Number(res.headers.get("retry-after"));
    if (ra > 0) err.retryAfterSec = ra;
    if (status === 404 || /voice.*not.*found|invalid.*voice/i.test(msg)) { err.voiceGone = true; err.retryable = false; }
    return err;
  }

  async function postJson(path, body) {
    var res;
    try { res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
    catch (e) { var ne = new Error("Network error. Check your connection and try again."); ne.retryable = true; throw ne; }
    var data = await res.json().catch(function () { return null; });
    if (!res.ok) throw makeError(errMsg(data, res.status), res.status, res);
    return data;
  }

  /* Raw 24 kHz PCM text to speech through the relay, with retry and backoff. */
  function ttsPcm(onRetry) {
    return function (a) {
      var key = getKey();
      if (!key) return Promise.reject(new Error(NEED_KEY));
      return VP.withRetry(async function () {
        var res;
        try {
          res = await fetch("/api/elevenlabs-tts", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ apiKey: key, voiceId: a.voiceId, text: a.text, modelId: a.modelId, voiceSettings: a.voiceSettings,
              seed: a.seed, previousText: a.previousText, nextText: a.nextText, outputFormat: "pcm_24000" })
          });
        } catch (e) { var ne = new Error("Network error. Check your connection and try again."); ne.retryable = true; throw ne; }
        if (!res.ok) { var d = await res.json().catch(function () { return null; }); throw makeError(errMsg(d, res.status), res.status, res); }
        return new Uint8Array(await res.arrayBuffer());
      }, { onRetry: onRetry });
    };
  }

  function wavBlob(bytes) { return new Blob([bytes], { type: "audio/wav" }); }
  function b64ToBlob(b64, type) {
    var bin = atob(b64), u8 = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return new Blob([u8], { type: type || "audio/mpeg" });
  }
  function download(name, blob) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }

  /* ---------------------------------------------------------------- minimal ZIP (store, no compression) */

  var CRC_TABLE = null;
  function crc32(u8) {
    if (!CRC_TABLE) {
      CRC_TABLE = new Uint32Array(256);
      for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC_TABLE[n] = c >>> 0; }
    }
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < u8.length; i++) crc = CRC_TABLE[(crc ^ u8[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
  function makeZip(files) {
    var enc = new TextEncoder(), parts = [], central = [], offset = 0;
    files.forEach(function (f) {
      var name = enc.encode(f.name), data = f.data, crc = crc32(data);
      var lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
      lh.setUint16(10, 0, true); lh.setUint16(12, 0x21, true); lh.setUint32(14, crc, true);
      lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      parts.push(new Uint8Array(lh.buffer), name, data);
      var ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
      ch.setUint16(10, 0, true); ch.setUint16(12, 0, true); ch.setUint16(14, 0x21, true); ch.setUint32(16, crc, true);
      ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true);
      ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + data.length;
    });
    var cdSize = central.reduce(function (n, p) { return n + p.length; }, 0);
    var end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    return new Blob(parts.concat(central, [new Uint8Array(end.buffer)]), { type: "application/zip" });
  }

  /* ---------------------------------------------------------------- draft access */

  function draftRecord() { try { return charDraft; } catch (e) { return null; } }   // eslint-disable-line no-undef
  function container() { var d = draftRecord(); return d && d.voicePassport ? d.voicePassport : null; }
  function setContainer(c) { var d = draftRecord(); if (d) d.voicePassport = c; }
  function activePassport(c) { return c ? VP.getActive(c.store) : null; }

  /* ================================================================ 1. CHARACTER FORM PANEL */

  var ui = { host: null, mode: "library", choosing: false, voices: null, pickedVoiceId: "", pickedVoiceName: "", candidates: [], busy: false, urls: [] };

  function revokeUrls() { ui.urls.forEach(function (u) { URL.revokeObjectURL(u); }); ui.urls = []; }
  function urlFor(blob) { var u = URL.createObjectURL(blob); ui.urls.push(u); return u; }

  function slider(id, label, value) {
    var out = h("span", { class: "vp-val", text: Number(value).toFixed(2) });
    var inp = h("input", { type: "range", id: id, min: "0", max: "1", step: "0.05", value: String(value) });
    inp.addEventListener("input", function () { out.textContent = Number(inp.value).toFixed(2); });
    return h("div", { class: "vp-slider" }, [h("label", { for: id, text: label }), inp, out]);
  }

  function readSettings() {
    function v(id, d) { var e = $(id); return e ? Number(e.value) : d; }
    var d = VP.DEFAULT_VOICE_SETTINGS;
    return { stability: v("vpStability", d.stability), similarity_boost: v("vpSimilarity", d.similarity_boost), style: v("vpStyle", d.style) };
  }
  function readRules() {
    function v(id, d) { var e = $(id); return e && e.value.trim() ? e.value.trim() : d; }
    var d = VP.DEFAULT_DELIVERY_RULES;
    return { pace: v("vpPace", d.pace), energy: v("vpEnergy", d.energy), pauses: d.pauses, tone: v("vpTone", d.tone), forbidden: v("vpForbidden", d.forbidden) };
  }
  function readModel() { var e = $("vpModel"); return e && e.value ? e.value : VP.DEFAULT_MODEL_ID; }

  function status() { return $("vpStatus"); }

  /* Remember what the user set in the settings box so a re-render does not reset it. */
  function snapshotSettings() {
    if (!$("vpModel")) return;
    ui.saved = { model: readModel(), s: readSettings(), r: readRules(), open: !!(ui.host.querySelector(".vp-adv") && ui.host.querySelector(".vp-adv").open) };
  }

  function render() {
    if (!ui.host) return;
    snapshotSettings();
    revokeUrls();
    ui.host.textContent = "";
    var c = container(), active = activePassport(c);

    ui.host.appendChild(h("div", { class: "vp-head" }, [
      h("b", { text: "Voice Passport" }),
      h("span", { class: "vp-sub", text: " lock one ElevenLabs voice to this character so it sounds the same in every video" })
    ]));

    if (active) renderActive(c, active);
    if (!active || ui.choosing) renderChooser(active);
    ui.host.appendChild(h("div", { id: "vpStatus", class: "status" }));
  }

  function renderActive(c, p) {
    var box = h("div", { class: "vp-active" });
    box.appendChild(h("div", { class: "vp-line" }, [
      h("span", { class: "vp-badge", text: "LOCKED" }),
      h("b", { text: p.character_id }),
      h("span", { class: "vp-sub", text: " voice " + p.elevenlabs_voice_id + " | " + p.model_id + " | " + p.voice_source })
    ]));
    var s = p.voice_settings;
    box.appendChild(h("div", { class: "vp-sub", text: "Stability " + s.stability + ", similarity " + s.similarity_boost + ", style " + s.style + ". Delivery: " + p.delivery_rules.energy + ", " + p.delivery_rules.tone + ". Never: " + p.delivery_rules.forbidden + "." }));
    var clip = c.goldenClips && c.goldenClips[p.character_id];
    if (clip) {
      box.appendChild(h("div", { class: "vp-sub", text: "Golden reference clip (" + (p.reference_audio.golden_profile ? p.reference_audio.golden_profile.durationSec + " s, pitch " + Math.round(p.reference_audio.golden_profile.pitchMedianHz) + " Hz" : "") + "):" }));
      box.appendChild(h("audio", { controls: true, src: urlFor(clip), class: "vp-audio" }));
    }
    var versions = Object.keys(c.store.versions);
    if (versions.length > 1) {
      var list = h("div", { class: "vp-versions" }, [h("span", { class: "vp-sub", text: "Versions: " })]);
      versions.forEach(function (id) {
        var isActive = id === c.store.active;
        list.appendChild(h("button", { type: "button", class: "ugc-mini" + (isActive ? " vp-on" : ""), text: id + (isActive ? " (active)" : ""), disabled: isActive,
          onclick: function () { switchVersion(id); } }));
      });
      box.appendChild(list);
    }
    box.appendChild(h("div", { class: "vp-actions" }, [
      h("button", { type: "button", class: "btn-ghost", text: "Change voice (creates " + nextVersionName(c) + ", keeps " + p.version + ")",
        onclick: function () { ui.choosing = true; ui.candidates = []; render(); } }),
      h("button", { type: "button", class: "btn-ghost", text: "Test a line", onclick: function () { testLine(p); } })
    ]));
    box.appendChild(h("div", { class: "vp-sub vp-note", text: "Press Save character to keep this voice. Characters live only in this browser." }));
    ui.host.appendChild(box);
  }

  function nextVersionName(c) {
    var n = Object.keys(c.store.versions).map(function (k) { return Number(c.store.versions[k].version.slice(1)); });
    return "v" + (Math.max.apply(null, n) + 1);
  }

  function switchVersion(id) {
    var c = container();
    c.store = VP.setActive(c.store, id);
    var p = VP.getActive(c.store), legacy = $("charElevenVoiceId");
    if (legacy) legacy.value = p.elevenlabs_voice_id;
    ui.choosing = false;
    render();
    setStatus(status(), "ok", "Now using " + id + ". Press Save character to keep it.");
  }

  async function testLine(p) {
    var st = status();
    setStatus(st, "info", "Generating a test line...");
    try {
      var line = "Okay, be honest. How many unfinished videos are sitting in your drafts right now?";
      var pcm = await ttsPcm()({ voiceId: p.elevenlabs_voice_id, text: line, modelId: p.model_id, voiceSettings: p.voice_settings, seed: 1 });
      var au = new Audio(urlFor(wavBlob(VP.wavFromPcm(pcm))));
      au.play().catch(function () {});
      setStatus(st, "ok", "Playing the test line with the locked voice.");
    } catch (e) { setStatus(st, "err", e.message); }
  }

  function renderChooser(active) {
    var box = h("div", { class: "vp-chooser" });
    var tabs = h("div", { class: "vp-tabs" });
    [["library", "Library voice"], ["design", "Design a voice"], ["clone", "Clone a voice"]].forEach(function (t) {
      tabs.appendChild(h("button", { type: "button", class: "ugc-mini" + (ui.mode === t[0] ? " vp-on" : ""), text: t[1],
        onclick: function () { ui.mode = t[0]; render(); } }));
    });
    box.appendChild(tabs);

    if (ui.mode === "library") box.appendChild(libraryPane());
    else if (ui.mode === "design") box.appendChild(designPane());
    else box.appendChild(clonePane());

    box.appendChild(settingsPane());
    if (active) box.appendChild(h("button", { type: "button", class: "ugc-mini", text: "Cancel and keep " + active.character_id, onclick: function () { ui.choosing = false; render(); } }));
    ui.host.appendChild(box);
  }

  function settingsPane() {
    var sv = ui.saved || {};
    var d = sv.s || VP.DEFAULT_VOICE_SETTINGS, r = sv.r || VP.DEFAULT_DELIVERY_RULES;
    var model = h("select", { id: "vpModel" }, [
      h("option", { value: "eleven_multilingual_v2", text: "Multilingual v2 (most consistent, recommended)" }),
      h("option", { value: "eleven_flash_v2_5", text: "Flash v2.5 (fast, cheaper)" }),
      h("option", { value: "eleven_v3", text: "v3 (very expressive, less predictable)" })
    ]);
    if (sv.model) model.value = sv.model;
    return h("details", { class: "vp-adv", open: !!sv.open }, [
      h("summary", { text: "Model, voice settings and delivery rules (defaults are tuned for consistency)" }),
      h("label", { for: "vpModel", text: "Model" }), model,
      slider("vpStability", "Stability", d.stability), slider("vpSimilarity", "Similarity", d.similarity_boost), slider("vpStyle", "Style exaggeration", d.style),
      h("label", { for: "vpPace", text: "Pace" }), h("input", { type: "text", id: "vpPace", value: r.pace }),
      h("label", { for: "vpEnergy", text: "Energy" }), h("input", { type: "text", id: "vpEnergy", value: r.energy }),
      h("label", { for: "vpTone", text: "Tone" }), h("input", { type: "text", id: "vpTone", value: r.tone }),
      h("label", { for: "vpForbidden", text: "Never sound like" }), h("input", { type: "text", id: "vpForbidden", value: r.forbidden })
    ]);
  }

  /* ---- library ---- */
  function libraryPane() {
    var sel = h("select", { id: "vpVoiceSel" }, [h("option", { value: "", text: ui.voices ? "Choose a voice" : "Load your voices first" })]);
    (ui.voices || []).forEach(function (v) {
      var o = h("option", { value: v.voice_id, text: v.name + (v.category ? " (" + v.category + ")" : "") });
      if (v.voice_id === ui.pickedVoiceId) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener("change", function () { ui.pickedVoiceId = sel.value; ui.pickedVoiceName = sel.selectedOptions[0] ? sel.selectedOptions[0].textContent : ""; var m = $("vpVoiceId"); if (m) m.value = sel.value; });
    var manual = h("input", { type: "text", id: "vpVoiceId", placeholder: "or paste a voice ID", value: ui.pickedVoiceId });
    manual.addEventListener("input", function () { ui.pickedVoiceId = manual.value.trim(); });
    return h("div", { class: "vp-pane" }, [
      h("div", { class: "vp-sub", text: "Premade voices work on every ElevenLabs plan. Hear a voice before you lock it." }),
      h("button", { type: "button", class: "btn-ghost", id: "vpLoadVoices", text: "Load my voices", onclick: loadVoices }),
      sel, manual,
      h("div", { class: "vp-actions" }, [
        h("button", { type: "button", class: "btn-ghost", text: "Hear this voice", onclick: hearPicked }),
        h("button", { type: "button", class: "btn-primary", id: "vpLockLib", text: "Lock this voice", onclick: function () { lockVoice(ui.pickedVoiceId, "library", []); } })
      ])
    ]);
  }
  async function loadVoices() {
    var st = status(), key = getKey();
    if (!key) { setStatus(st, "err", NEED_KEY); return; }
    setStatus(st, "info", "Loading voices...");
    try {
      var data = await postJson("/api/elevenlabs-voices", { apiKey: key });
      ui.voices = data.voices || [];
      render();
      setStatus(status(), "ok", ui.voices.length + " voice(s) loaded.");
    } catch (e) { setStatus(st, "err", e.message); }
  }
  async function hearPicked() {
    var st = status();
    if (!ui.pickedVoiceId) { setStatus(st, "err", "Choose or paste a voice first."); return; }
    setStatus(st, "info", "Generating a short preview...");
    try {
      var pcm = await ttsPcm()({ voiceId: ui.pickedVoiceId, text: VP.GOLDEN_TEST_LINES[0], modelId: readModel(), voiceSettings: readSettings(), seed: 1 });
      var au = new Audio(urlFor(wavBlob(VP.wavFromPcm(pcm)))); au.play().catch(function () {});
      setStatus(st, "ok", "Playing the preview.");
    } catch (e) { setStatus(st, "err", e.message); }
  }

  /* ---- design ---- */
  function designPane() {
    var pane = h("div", { class: "vp-pane" }, [
      h("div", { class: "vp-sub", text: "Describe the voice: age, accent, energy and style. ElevenLabs makes 3 candidates. Voice design has some randomness, so you approve one and that exact voice is saved for good. Needs the Text to Voice permission on your API key." }),
      h("textarea", { id: "vpDesc", rows: "3", placeholder: "Late twenties, warm and relaxed, slightly breathy, friendly Swedish-English UGC creator voice" }),
      h("button", { type: "button", class: "btn-ghost", text: "Generate 3 candidates", onclick: designCandidates })
    ]);
    ui.candidates.forEach(function (cand, i) {
      pane.appendChild(h("div", { class: "vp-cand" }, [
        h("b", { text: "Candidate " + (i + 1) }),
        h("audio", { controls: true, class: "vp-audio", src: urlFor(cand.blob) }),
        h("button", { type: "button", class: "btn-primary", text: "Use this voice", onclick: function () { approveCandidate(cand); } })
      ]));
    });
    return pane;
  }
  async function designCandidates() {
    var st = status(), key = getKey(), desc = ($("vpDesc") || {}).value || "";
    if (!key) { setStatus(st, "err", NEED_KEY); return; }
    setStatus(st, "info", "Designing candidates (about 20 seconds)...");
    try {
      var data = await postJson("/api/elevenlabs-design", { apiKey: key, description: desc });
      ui.designDesc = desc;
      ui.candidates = data.previews.map(function (p) { return { id: p.generated_voice_id, blob: b64ToBlob(p.audio_base_64, p.media_type) }; });
      render();
      var d2 = $("vpDesc"); if (d2) d2.value = desc;
      setStatus(status(), "ok", "Listen to each candidate, then press Use this voice on the one you want.");
    } catch (e) { setStatus(st, "err", e.message); }
  }
  async function approveCandidate(cand) {
    var st = status(), name = ($("charDisplayName") || {}).value || "";
    if (!name.trim()) { setStatus(st, "err", "Enter the character's display name above first."); return; }
    setStatus(st, "info", "Saving the approved voice to your ElevenLabs account...");
    try {
      var saved = await postJson("/api/elevenlabs-voice-save", { apiKey: getKey(), generatedVoiceId: cand.id, name: name.trim(), description: ui.designDesc || "" });
      await lockVoice(saved.voice_id, "design", []);
    } catch (e) { setStatus(st, "err", e.message); }
  }

  /* ---- clone ---- */
  function clonePane() {
    return h("div", { class: "vp-pane" }, [
      h("div", { class: "vp-sub", text: "Upload 1 to 5 clean recordings (about a minute or more in total, one speaker, no music or noise). Instant cloning needs a plan that includes it and the Voices write permission on your API key. Professional cloning is done on elevenlabs.io, then use its voice here as a library voice." }),
      h("label", { class: "vp-check" }, [h("input", { type: "checkbox", id: "vpConsent" }), " This is my own voice, or I have written permission from the speaker to clone it."]),
      h("input", { type: "file", id: "vpFiles", accept: "audio/*", multiple: true }),
      h("div", { class: "vp-actions" }, [h("button", { type: "button", class: "btn-primary", text: "Clone and lock this voice", onclick: cloneAndLock })])
    ]);
  }
  async function cloneAndLock() {
    var st = status(), name = (($("charDisplayName") || {}).value || "").trim(), files = ($("vpFiles") || {}).files || [];
    if (!name) { setStatus(st, "err", "Enter the character's display name above first."); return; }
    if (!getKey()) { setStatus(st, "err", NEED_KEY); return; }
    if (!($("vpConsent") || {}).checked) { setStatus(st, "err", "Please confirm you have the right to clone this voice."); return; }
    if (!files.length) { setStatus(st, "err", "Choose at least one audio file."); return; }
    setStatus(st, "info", "Cloning the voice...");
    try {
      var fd = new FormData();
      fd.set("apiKey", getKey()); fd.set("name", name);
      var names = [];
      Array.prototype.forEach.call(files, function (f) { fd.append("files", f, f.name); names.push(f.name); });
      var res = await fetch("/api/elevenlabs-clone", { method: "POST", body: fd });
      var data = await res.json().catch(function () { return null; });
      if (!res.ok) throw makeError(errMsg(data, res.status), res.status, res);
      await lockVoice(data.voice_id, "clone", names);
    } catch (e) { setStatus(st, "err", e.message); }
  }

  /* ---- lock ---- */
  async function lockVoice(voiceId, source, sampleNames) {
    if (ui.busy) return;
    var st = status(), name = (($("charDisplayName") || {}).value || "").trim();
    if (!name) { setStatus(st, "err", "Enter the character's display name above first."); return; }
    if (!voiceId) { setStatus(st, "err", "Choose a voice first."); return; }
    if (!getKey()) { setStatus(st, "err", NEED_KEY); return; }
    var d = draftRecord();
    if (!d) { setStatus(st, "err", "Open a character first."); return; }
    ui.busy = true;
    try {
      var existing = container();
      var added = VP.addVersion(existing ? existing.store : null, { characterName: name, voiceId: voiceId, voiceSource: source, modelId: readModel(),
        voiceSettings: readSettings(), deliveryRules: readRules(), originalSamples: sampleNames });
      var pass = added.passport, count = 0;
      setStatus(st, "info", "Locking " + pass.character_id + ": generating the golden reference clip...");
      var golden = await VP.buildGolden(pass, ttsPcm(function (r) { setStatus(status(), "info", "ElevenLabs is busy, retrying in " + Math.round(r.delayMs / 1000) + " s..."); }),
        { onProgress: function (p) { count = p.done; setStatus(status(), "info", "Locking " + pass.character_id + ": golden clip, line " + count + " of 5..."); } });
      var store = VP.attachGolden(added.store, pass.character_id, { profile: golden.profile, lines: golden.lines });
      var next = { store: store, goldenClips: Object.assign({}, existing ? existing.goldenClips : {}) };
      next.goldenClips[pass.character_id] = wavBlob(golden.wav);
      setContainer(next);
      var legacy = $("charElevenVoiceId"); if (legacy) legacy.value = voiceId;
      ui.choosing = false; ui.candidates = [];
      render();
      setStatus(status(), "ok", "Locked " + pass.character_id + ". Play the golden clip, then press Save character to keep it." + (golden.warnings.length ? " Note: " + golden.warnings.join(" ") : ""));
    } catch (e) {
      var msg = e.voiceGone ? "ElevenLabs says this voice is invalid or deleted. Pick or recreate a voice." : e.message;
      setStatus(st, "err", msg);
    } finally { ui.busy = false; }
  }

  /* ---- mount ---- */
  function mountCharacterPanel() {
    var anchor = $("charElevenVoiceId");
    if (!anchor || $("vpHost")) return;
    ui.host = h("div", { id: "vpHost", class: "vp-panel" });
    anchor.insertAdjacentElement("afterend", ui.host);
    render();
    // Re-render whenever the form is opened for a new or existing character.
    if (typeof window.openCharForm === "function") {
      var orig = window.openCharForm;
      window.openCharForm = async function () {
        var r = await orig.apply(this, arguments);
        ui.choosing = false; ui.candidates = []; ui.pickedVoiceId = ""; ui.pickedVoiceName = "";
        render();
        return r;
      };
    }
  }

  /* ================================================================ 2. FUNNEL VOICEOVER CARD */

  function funnelScenes(Core, ctx, kit, v) {
    var rows = [["hook", "HOOK", kit.hooks[v.hookIndex], ctx.byKey.hook, "hook"], ["problem", "PROBLEM", kit.body.problem, ctx.byKey.problem, "body"]];
    if (kit.body.solution) rows.push(["solution", "SOLUTION", kit.body.solution, ctx.byKey.solution, "body"]);
    rows.push(["cta", "CTA", kit.ctas[v.ctaIndex], ctx.byKey.cta, "cta"]);
    return rows.map(function (r) {
      return { id: r[0], label: r[1], role: r[4], text: r[2].spoken, durationSec: r[3].end - r[3].start };
    });
  }

  function mountFunnelPanel(box, o) {
    var card = h("section", { class: "ugc-card vp-funnel" }, [h("h4", { text: "Voiceover with a locked voice" })]);
    box.appendChild(card);
    var c = o.character && o.character.voicePassport, p = c && VP.getActive(c.store);
    if (!o.character) {
      card.appendChild(h("div", { class: "ugc-hint", text: "Pick a presenter on the left that has a locked Voice Passport to generate voiceover with the same voice in every scene. Add one under Characters > edit > Voice Passport." }));
      return;
    }
    if (!p) {
      card.appendChild(h("div", { class: "ugc-hint", text: o.character.displayName + " has no locked voice yet. Open Characters, edit this character and lock a voice in the Voice Passport section." }));
      return;
    }
    var bad = VP.verifyStore(c.store);
    if (!bad.ok) { card.appendChild(h("div", { class: "ugc-hint vp-bad", text: bad.problems.join(" ") + " Restore the character or lock a new voice version." })); return; }

    card.appendChild(h("div", { class: "ugc-hint", text: o.character.displayName + " | " + p.character_id + " | voice " + p.elevenlabs_voice_id + " | " + p.model_id + ". Every scene uses exactly this voice and these settings." }));
    var sel = h("select", { class: "vp-variant" }, o.variants.map(function (v, i) { return h("option", { value: String(i), text: v.label }); }));
    var go = h("button", { type: "button", class: "btn-copy ugc-gold", text: "Generate voiceover for this variant" });
    var progress = h("div", { class: "status" });
    var out = h("div", { class: "vp-results" });
    card.appendChild(h("div", { class: "vp-actions" }, [sel, go]));
    card.appendChild(progress);
    card.appendChild(out);

    var urls = [];
    go.addEventListener("click", async function () {
      if (!getKey()) { setStatus(progress, "err", NEED_KEY); return; }
      var v = o.variants[Number(sel.value)], scenes = funnelScenes(o.core, o.ctx, o.kit, v), jobs = VP.buildJobs(scenes);
      go.disabled = true; out.textContent = ""; urls.forEach(function (u) { URL.revokeObjectURL(u); }); urls = [];
      setStatus(progress, "info", "Generating " + jobs.length + " clip(s)...");
      try {
        var run = await VP.runVoiceover({
          passport: p, jobs: jobs,
          tts: ttsPcm(function (r) { setStatus(progress, "info", "ElevenLabs is busy, retrying in " + Math.round(r.delayMs / 1000) + " s..."); }),
          onProgress: function (e) { setStatus(progress, "info", "Scene " + (e.index + 1) + " of " + e.total + " (" + e.job + "), attempt " + e.attempt + (e.pass ? ": passed" : ": checking again")); }
        });
        showResults(out, run, p, scenes, urls, v);
        setStatus(progress, run.ready ? "ok" : "err", run.ready ? "All clips passed the voice checks. Ready for the renderer." : run.metrics.needs_review + " clip(s) need a manual listen before use. They are marked below.");
      } catch (e) {
        setStatus(progress, "err", e.voiceGone ? "ElevenLabs says the locked voice " + p.elevenlabs_voice_id + " is invalid or deleted. Lock a new voice version for this character. No other voice was used." : e.message);
      } finally { go.disabled = false; }
    });
  }

  function showResults(out, run, p, scenes, urls, variant) {
    var label = {}; scenes.forEach(function (s) { label[s.id] = s.label; });
    run.results.forEach(function (r) {
      var url = URL.createObjectURL(wavBlob(r.wav)); urls.push(url);
      var ok = r.status === "ok";
      out.appendChild(h("div", { class: "vp-row" + (ok ? "" : " vp-warn") }, [
        h("div", { class: "vp-line" }, [
          h("b", { text: (label[r.scene_id] || r.scene_id) + (r.id !== r.scene_id ? " (" + r.id + ")" : "") }),
          h("span", { class: "vp-badge " + (ok ? "vp-okb" : "vp-badb"), text: ok ? "OK" : "NEEDS REVIEW" }),
          h("span", { class: "vp-sub", text: r.duration_sec + " s | " + r.attempts.length + " attempt(s)" })
        ]),
        h("div", { class: "ugc-spoken", text: r.text }),
        h("audio", { controls: true, class: "vp-audio", src: url }),
        ok ? null : h("div", { class: "ugc-hint vp-bad", text: r.qa.failures.map(function (f) { return f.detail; }).join(" ") })
      ]));
    });
    var tag = (variant.label || "variant").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "variant";
    var manifest = VP.manifestFor(run, p);
    var enc = new TextEncoder();
    function files() {
      var f = [{ name: "voiceover_full.wav", data: run.fullWav }, { name: "manifest.json", data: enc.encode(JSON.stringify(manifest, null, 2)) }];
      run.results.forEach(function (r) { f.push({ name: "scenes/" + r.id + ".wav", data: r.wav }); });
      return f;
    }
    out.appendChild(h("div", { class: "vp-actions" }, [
      h("button", { type: "button", class: "btn-copy ugc-gold", text: "Download everything (.zip)", onclick: function () { download("voiceover-" + tag + ".zip", makeZip(files())); } }),
      h("button", { type: "button", class: "btn-copy", text: "Full track (.wav)", onclick: function () { download("voiceover-" + tag + ".wav", wavBlob(run.fullWav)); } }),
      h("button", { type: "button", class: "btn-copy", text: "manifest.json", onclick: function () { download("voiceover-" + tag + "-manifest.json", new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" })); } })
    ]));
    out.appendChild(h("div", { class: "ugc-hint", text: "Checks: duration, silence, clipping, loudness, pitch and pace against the golden clip. True speaker similarity is not measured. Nothing is stored on our servers." }));
  }

  /* ---------------------------------------------------------------- start */

  window.VoicePassportUI = { mountFunnelPanel: mountFunnelPanel, makeZip: makeZip, crc32: crc32 };

  function init() {
    // The character form exists in the page markup from the start; mount once app.js has run.
    var tries = 0;
    (function wait() {
      if ($("charElevenVoiceId") && typeof window.openCharForm === "function") mountCharacterPanel();
      else if (tries++ < 50) setTimeout(wait, 100);
    })();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
