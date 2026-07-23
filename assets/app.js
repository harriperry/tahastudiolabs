
/* ─────────────────────────  THE EXACT FORMATTER PROMPT  ───────────────────────── */
function tstamp(sec){const m=String(Math.floor(sec/60)).padStart(2,"0"),s=String(sec%60).padStart(2,"0");return `${m}:${s}`;}
function totalLabel(n){const t=n*10;return t%60===0?`${t/60}-minute (${t}-second)`:`${t}-second`;}
function buildSystemPrompt(n, ratio){
const timingRule = Array.from({length:n},(_,i)=>`Segment ${i+1} = ${tstamp(i*10)}\u2013${tstamp((i+1)*10)}`).join(", ");
return `Act as a professional AI video production formatter. Take the full script the user provides, and split it EXACTLY into ${n} equal segment${n>1?'s':''} of 10 seconds each, to make a total ${totalLabel(n)} video.

Follow this exact structure for EVERY segment — keep wording clear and concise, match the tone of the original script, and ensure smooth natural continuity between segments:

---

### SEGMENT [NUMBER] | [START TIME]–[END TIME]

**Type**: [On-Camera / Voiceover + B-Roll / On-Camera + Brand Close]

**TTS Script**:
> [Full spoken text for this exact 10-second block — include short connecting phrases to flow smoothly between segments, keep it conversational and perfectly timed for 10 seconds]

**Visual / B-Roll Prompt**:
> [Detailed, photorealistic ${ratio} prompt matching the content, setting, and style of the original example]

**Motion**:
> [Specify exact camera movement + fallback Ken Burns rule if applicable]

**Audio Note**:
> [Music level / voice clarity instruction if needed]

---

Additional rules:
1. Keep all timing precise: ${timingRule}
2. Preserve all original key information, brand names, and facts — do not add or remove core details
3. Match the visual style, realism, and location details from the original reference examples
4. Output as clean, copy-paste ready blocks exactly like the sample format
5. If voice ID, avatar, or technical specs are provided, include them at the very top of the output in a "TECHNICAL SPECS" block before Segment 1
6. Each 10-second TTS block should be approximately 22–28 spoken words (≈150 wpm)
7. B-roll prompts: cinematic documentary grade, ultra-realistic African physiognomy where people appear, specify era, geography, lighting and composition — never generic stock-photo descriptors
8. Output ONLY the formatted blocks. No preamble, no commentary, no closing remarks.`;
}

/* ─────────────────────────  DOM  ───────────────────────── */
const $ = id => document.getElementById(id);
const els = {
  apiKey: $("apiKey"), rememberKey: $("rememberKey"), model: $("model"),
  formatProvider: $("formatProvider"),
  anthropicFormatOptions: $("anthropicFormatOptions"), geminiFormatOptions: $("geminiFormatOptions"), groqFormatOptions: $("groqFormatOptions"),
  apiKeyGemini: $("apiKeyGemini"), rememberKeyGemini: $("rememberKeyGemini"), modelGemini: $("modelGemini"),
  apiKeyGroq: $("apiKeyGroq"), rememberKeyGroq: $("rememberKeyGroq"), modelGroq: $("modelGroq"),
  segCount: $("segCount"), lenBadge: $("lenBadge"),
  ratio: $("ratio"),
  techSpecs: $("techSpecs"), script: $("script"), wordMeter: $("wordMeter"),
  btnFormat: $("btnFormat"), btnClear: $("btnClear"), btnMock: $("btnMock"), status: $("status"),
  output: $("output"), rawOut: $("rawOut"),
  btnToggleRaw: $("btnToggleRaw"), btnCopyAll: $("btnCopyAll"),
  scriptType: $("scriptType"), btnSaveLib: $("btnSaveLib"), btnPdf: $("btnPdf"),
  btnLibrary: $("btnLibrary"), libOverlay: $("libOverlay"), libList: $("libList"), btnLibClose: $("btnLibClose"),
  videoKeyVeo: $("videoKeyVeo"), rememberVideoKeyVeo: $("rememberVideoKeyVeo"),
  videoKeyGrok: $("videoKeyGrok"), rememberVideoKeyGrok: $("rememberVideoKeyGrok"),
  videoKeyHeygen: $("videoKeyHeygen"), rememberVideoKeyHeygen: $("rememberVideoKeyHeygen"),
  refImg1: $("refImg1"), refImg1prev: $("refImg1prev"),
  refImg2: $("refImg2"), refImg2prev: $("refImg2prev"),
  refImg3: $("refImg3"), refImg3prev: $("refImg3prev"),
  vidAspectRatio: $("vidAspectRatio"), vidResolution: $("vidResolution")
};
let lastRaw = "";
let lastMeta = null;

/* remember key (local file — localStorage, guarded) */
try {
  const saved = localStorage.getItem("sca_fmt_key");
  if (saved) { els.apiKey.value = saved; els.rememberKey.checked = true; }
} catch(e){}
els.rememberKey.addEventListener("change", persistKey);
els.apiKey.addEventListener("input", persistKey);
function persistKey(){
  try {
    if (els.rememberKey.checked) localStorage.setItem("sca_fmt_key", els.apiKey.value);
    else localStorage.removeItem("sca_fmt_key");
  } catch(e){}
}

/* Remember Gemini/Groq keys for script formatting — same one-slot-per-provider pattern used
   for the video providers below. Anthropic keeps its own dedicated apiKey/rememberKey/
   persistKey above (unchanged, still "sca_fmt_key") since it predates this pattern and
   existing saved keys shouldn't be disturbed. */
const FORMAT_PROVIDERS = {
  gemini: { keyEl: "apiKeyGemini", rememberEl: "rememberKeyGemini", ls: "sf_format_key_gemini" },
  groq:   { keyEl: "apiKeyGroq",   rememberEl: "rememberKeyGroq",   ls: "sf_format_key_groq" }
};
Object.values(FORMAT_PROVIDERS).forEach(p => {
  try {
    const saved = localStorage.getItem(p.ls);
    if (saved) { els[p.keyEl].value = saved; els[p.rememberEl].checked = true; }
  } catch (e) {}
  els[p.keyEl].addEventListener("input", () => persistFormatKey(p));
  els[p.rememberEl].addEventListener("change", () => persistFormatKey(p));
});
function persistFormatKey(p) {
  try {
    if (els[p.rememberEl].checked) localStorage.setItem(p.ls, els[p.keyEl].value);
    else localStorage.removeItem(p.ls);
  } catch (e) {}
}

/* Show only the key/model fields for whichever script-writing provider is selected — same
   show/hide-by-provider pattern used for the video providers' option panels. */
function switchFormatProvider() {
  const p = els.formatProvider.value;
  els.anthropicFormatOptions.style.display = p === "anthropic" ? "" : "none";
  els.geminiFormatOptions.style.display = p === "gemini" ? "" : "none";
  els.groqFormatOptions.style.display = p === "groq" ? "" : "none";
}
els.formatProvider.addEventListener("change", switchFormatProvider);
switchFormatProvider();

/* remember video-provider keys — each provider gets its own localStorage slot so
   switching between them never overwrites another provider's saved key */
const VIDEO_PROVIDERS = {
  veo:    { keyEl: "videoKeyVeo",    rememberEl: "rememberVideoKeyVeo",    ls: "sf_video_key_veo" },
  grok:   { keyEl: "videoKeyGrok",   rememberEl: "rememberVideoKeyGrok",   ls: "sf_video_key_grok" },
  heygen: { keyEl: "videoKeyHeygen", rememberEl: "rememberVideoKeyHeygen", ls: "sf_video_key_heygen" }
};
Object.values(VIDEO_PROVIDERS).forEach(p => {
  try {
    const saved = localStorage.getItem(p.ls);
    if (saved) { els[p.keyEl].value = saved; els[p.rememberEl].checked = true; }
  } catch (e) {}
  els[p.keyEl].addEventListener("input", () => persistVideoKey(p));
  els[p.rememberEl].addEventListener("change", () => persistVideoKey(p));
});
function persistVideoKey(p) {
  try {
    if (els[p.rememberEl].checked) localStorage.setItem(p.ls, els[p.keyEl].value);
    else localStorage.removeItem(p.ls);
  } catch (e) {}
}

/* reference image previews (Veo 3.1 "Ingredients to video" — up to 3, optional) */
function wireImageInput(inputEl, previewEl) {
  if (!inputEl || !previewEl) return;
  inputEl.addEventListener("change", () => {
    const f = inputEl.files[0];
    if (!f) { previewEl.style.display = "none"; return; }
    const reader = new FileReader();
    reader.onload = () => { previewEl.src = reader.result; previewEl.style.display = "inline-block"; };
    reader.readAsDataURL(f);
  });
}
wireImageInput(els.refImg1, els.refImg1prev);
wireImageInput(els.refImg2, els.refImg2prev);
wireImageInput(els.refImg3, els.refImg3prev);

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ bytesBase64Encoded: reader.result.split(",")[1], mimeType: file.type || "image/png" });
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* Grok Imagine’s reference-to-video mode (docs.x.ai/developers/model-capabilities/video/
   reference-to-video) takes each reference image as {"url": "..."} where that field accepts
   EITHER a public HTTPS URL OR a full base64 data URI directly — same pattern xAI uses for the
   video-edit endpoint’s "video" field. So unlike Veo (which wants the base64 payload split from
   its data-URI prefix), Grok wants the whole "data:image/...;base64,..." string as-is. */
function fileToDataUri(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* word meter */
els.script.addEventListener("input", updateWordMeter);
els.segCount.addEventListener("change", updateLengthUI);
function updateWordMeter(){
  const n = +els.segCount.value, lo = n*22, hi = n*28;
  const w = els.script.value.trim().split(/\s+/).filter(Boolean).length;
  els.wordMeter.textContent = `${w} words · target ≈ ${lo}–${hi} words for ${tstamp(n*10)}` + (w > Math.round(hi*1.2) ? " — ⚠ likely over target, formatter will condense" : "");
}
function updateLengthUI(){
  const n = +els.segCount.value;
  els.lenBadge.textContent = `00:00 – ${tstamp(n*10)} · ${n} segments · 10s each`;
  els.btnFormat.textContent = `⚡ Format into ${n} × 10s Segments`;
  updateWordMeter();
}

function setStatus(cls, html){
  els.status.className = "status " + cls;
  els.status.innerHTML = html;
}

/* ─────────────────────────  FORMAT (via our own server — avoids browser CORS/
   extension interference; see functions/api/format.js for the relay + the
   data-handling note on why this changed from a direct browser→Anthropic call)
   ───────────────────────── */
/* Provider metadata for the "Format" call — mirrors VIDEO_PROVIDERS' shape but keyed to the
   script-writing providers instead. keyUrl/label feed the error messages below so a wrong or
   missing key points people at the right place regardless of which provider they picked. */
const FORMAT_PROVIDER_META = {
  anthropic: { label: "Anthropic", keyEl: "apiKey",       modelEl: "model",       keyUrl: "console.anthropic.com/settings/keys" },
  gemini:    { label: "Gemini",    keyEl: "apiKeyGemini",  modelEl: "modelGemini", keyUrl: "aistudio.google.com/apikey" },
  groq:      { label: "Groq",      keyEl: "apiKeyGroq",    modelEl: "modelGroq",   keyUrl: "console.groq.com/keys" }
};

els.btnFormat.addEventListener("click", async () => {
  const provider = els.formatProvider.value;
  const pmeta = FORMAT_PROVIDER_META[provider];
  const key = els[pmeta.keyEl].value.trim();
  const script = els.script.value.trim();
  if (!key || (provider === "anthropic" && key === "sk-ant-YOUR_KEY_HERE")) { setStatus("err", `Enter your ${pmeta.label} API key (${pmeta.keyUrl}).`); return; }
  if (!script) { setStatus("err", "Paste a script first."); return; }

  const n = +els.segCount.value;
  if (n > FREE_MAX_SEGS && tier !== "pro") { showUpgrade("Segments beyond " + FREE_MAX_SEGS + " × 10s are a Pro feature."); return; }
  const ratio = els.ratio.value;
  const stype = els.scriptType.value;
  let specs = "";
  if (stype) specs += `Script type: ${stype}\n`;
  specs += `Ratio: ${ratio}\n`;
  if (els.techSpecs.value.trim()) specs += `Specs: ${els.techSpecs.value.trim()}\n`;

  const userMsg = (specs ? `TECHNICAL SPECS PROVIDED (include at very top of output):\n${specs}\n` : "") +
                  (stype ? `FORMAT STYLE: ${stype} — adapt the Type fields, pacing and tone of every segment to a ${stype.toLowerCase()}.\n\n` : "") +
                  `Now process this script:\n\n${script}`;

  els.btnFormat.disabled = true;
  setStatus("info", `<span class="spin"></span>Calling ${pmeta.label}… splitting into ${n} × 10s segments`);

  async function callFormat() {
    return fetch("/api/format", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider,
        apiKey: key,
        model: els[pmeta.modelEl].value,
        max_tokens: Math.min(1500 + n*800, 16000),
        system: buildSystemPrompt(n, ratio),
        messages: [{ role: "user", content: userMsg }]
      })
    });
  }

  try {
    let res;
    try {
      res = await callFormat();
    } catch (networkErr) {
      // Same-origin call to our own server — a thrown TypeError here means a
      // brief network hiccup reaching tahastudiolabs.com itself, not anything
      // Anthropic- or extension-related. Safe to retry once.
      await new Promise(r => setTimeout(r, 900));
      res = await callFormat();
    }
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
    lastRaw = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n").trim();
    if (!lastRaw) throw new Error("Empty response from API.");
    lastMeta = { n, ratio, type: stype, date: new Date().toISOString() };
    renderOutput(lastRaw);
    els.btnSaveLib.style.display = "inline-block"; els.btnPdf.style.display = "inline-block";
    els.btnSaveLib.textContent = "💾 Save to Library";
    setStatus("ok", `✓ Done — ${n} segments generated. Copy blocks are ready below.`);
  } catch (err) {
    setStatus("err", "API error: " + err.message + `<br>Check that your key is valid at ${pmeta.keyUrl}, or try again in a moment.`);
  } finally {
    els.btnFormat.disabled = false;
  }
});

/* ─────────────────────────  RENDER  ───────────────────────── */
function renderOutput(raw){
  els.rawOut.value = raw;
  els.btnToggleRaw.style.display = "inline-block";
  els.btnCopyAll.style.display = "inline-block";
  els.output.style.display = "block";
  els.rawOut.style.display = "none";
  els.btnToggleRaw.textContent = "View raw markdown";

  const html = [];

  /* Technical specs block (anything before first "### SEGMENT") */
  const firstSeg = raw.search(/###\s*SEGMENT/i);
  if (firstSeg > 0) {
    const pre = raw.slice(0, firstSeg).replace(/^-+\s*$/gm, "").trim();
    if (pre) html.push(`<div class="specs-block"><div class="fl">Technical Specs</div>${esc(pre).replace(/\*\*/g,"")}</div>`);
  }

  /* Segments */
  window.__segPrompts = {};
  const segRe = /###\s*SEGMENT\s*(\d+)\s*\|\s*([^\n]+)\n([\s\S]*?)(?=###\s*SEGMENT|\s*$)/gi;
  let m, found = 0;
  while ((m = segRe.exec(raw)) !== null) {
    found++;
    const num = m[1], time = m[2].trim(), body = m[3];
    const visualPrompt = pick(body, "Visual / B-Roll Prompt") || pick(body, "Visual");
    const motion = pick(body, "Motion");
    const segType = pick(body, "Type");
    const ttsScript = pick(body, "TTS Script");
    const audioNote = pick(body, "Audio Note");
    window.__segPrompts[num] = { visualPrompt, motion, ttsScript, audioNote, segType };
    const fields = [
      ["Type",                segType],
      ["TTS Script",          pick(body, "TTS Script"),          "tts"],
      ["Visual / B-Roll Prompt", visualPrompt, "visual"],
      ["Motion",              motion],
      ["Audio Note",          pick(body, "Audio Note")]
    ];
    let inner = "";
    for (const [lab, val, cls] of fields) {
      if (!val) continue;
      inner += `<div class="field ${cls||""}"><div class="fl">${lab}</div><div class="fv">${esc(val)}</div></div>`;
    }
    const blockMd = `### SEGMENT ${num} | ${time}\n${body.trim()}`;
    html.push(
      `<div class="seg-card">
         <div class="seg-head">
           <div class="t">SEGMENT ${num}<small>${esc(time)}</small></div>
           <button class="btn-copy" data-action="copy-block" data-text="${encodeURIComponent(blockMd)}">📋 Copy block</button>
         </div>
         <div class="seg-body">${inner || "<div class='field'><div class='fv'>"+esc(body.trim())+"</div></div>"}</div>
         ${visualPrompt ? `
         <div class="seg-video" style="border-top:1px solid var(--border);margin-top:10px;padding-top:10px">
           <div style="display:flex;gap:8px;align-items:center">
             <select id="vidGen${num}" style="flex:1">
               <option value="veo">Veo 3.1</option>
               <option value="grok">Grok Imagine</option>
               <option value="heygen">HeyGen Video Agent</option>
             </select>
             <input type="number" id="vidDur${num}" min="1" max="15" step="1" value="15" style="width:52px" title="Clip length in seconds. Grok Imagine allows 1-15s (this dropdown only applies to Grok — Veo 3.1 is fixed at 8s per call, and HeyGen has no formal duration parameter).">
             <button class="btn-copy" data-action="gen-clip" data-num="${num}">🎬 Generate clip</button>
           </div>
           <div class="status" id="vidStatus${num}"></div>
           <div id="vidResult${num}" style="margin-top:8px"></div>
         </div>` : ""}
       </div>`
    );
  }

  els.output.innerHTML = found
    ? html.join("")
    : `<div class="specs-block"><div class="fl">Raw output</div>${esc(raw)}</div>`;
}

/* Delegated click handling for the output panel. The site's Content-Security-Policy is
   script-src 'self' (no 'unsafe-inline'), which silently blocks inline onclick="" attributes
   in the browser — buttons still look clickable but their handler never fires. This was
   true for the pre-existing "Copy block" button too, not just the new video one. Using one
   listener on the stable container + data-attributes on the buttons is CSP-safe and only
   needs to be wired once, regardless of how many segment cards get re-rendered. */
els.output.addEventListener("click", (e) => {
  const copyBtn = e.target.closest('[data-action="copy-block"]');
  if (copyBtn) { copyText(copyBtn, decodeURIComponent(copyBtn.dataset.text)); return; }
  const genBtn = e.target.closest('[data-action="gen-clip"]');
  if (genBtn) { genClip(Number(genBtn.dataset.num), genBtn); return; }
});

function pick(body, label){
  const re = new RegExp("\\*\\*" + label.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&") + "\\*\\*\\s*:?\\s*\\n?((?:>[^\\n]*\\n?)+|[^\\n*]+)", "i");
  const m = body.match(re);
  if (!m) return "";
  return m[1].replace(/^>\s?/gm, "").trim();
}
function esc(s){ return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }

/* ─────────────────────────  COPY / TOGGLE / CLEAR  ───────────────────────── */
window.copyText = function(btn, text){
  navigator.clipboard.writeText(text).then(() => {
    const o = btn.textContent; btn.textContent = "✓ Copied";
    setTimeout(() => btn.textContent = o, 1400);
  });
};
els.btnCopyAll.addEventListener("click", () => copyText(els.btnCopyAll, lastRaw));
els.btnToggleRaw.addEventListener("click", () => {
  const showRaw = els.rawOut.style.display === "none";
  els.rawOut.style.display = showRaw ? "block" : "none";
  els.output.style.display = showRaw ? "none" : "block";
  els.btnToggleRaw.textContent = showRaw ? "View formatted" : "View raw markdown";
});
els.btnClear.addEventListener("click", () => {
  els.script.value = ""; els.output.innerHTML = '<div class="empty">Formatted segments will appear here.</div>';
  els.rawOut.value = ""; lastRaw = "";
  els.btnToggleRaw.style.display = "none"; els.btnCopyAll.style.display = "none";
  els.btnSaveLib.style.display = "none"; els.btnPdf.style.display = "none"; lastMeta = null;
  els.status.className = "status"; updateWordMeter();
});
/* ─────────────────────────  LIBRARY & PDF  ───────────────────────── */
function getLib(){ try { return JSON.parse(localStorage.getItem("sca_fmt_library") || "[]"); } catch(e){ return []; } }
function setLib(list){ try { localStorage.setItem("sca_fmt_library", JSON.stringify(list)); } catch(e){ alert("Could not save — storage full or blocked."); } }
function titleFor(raw, meta){
  const m = raw.match(/\*\*TTS Script\*\*:\s*\n?>?\s*([^\n]+)/i);
  const base = m ? m[1].replace(/[>*"]/g,"").trim().split(/\s+/).slice(0,8).join(" ") : "Untitled script";
  return `${meta && meta.type ? meta.type + " — " : ""}${base}`;
}
els.btnSaveLib.addEventListener("click", () => {
  if (!lastRaw) return;
  const lib = getLib();
  if (tier !== "pro" && lib.length >= FREE_LIB_CAP) { showUpgrade("The free Library holds " + FREE_LIB_CAP + " scripts. Pro removes the limit."); return; }
  lib.unshift({ id: Date.now(), title: titleFor(lastRaw, lastMeta), meta: lastMeta, raw: lastRaw });
  setLib(lib);
  els.btnSaveLib.textContent = "✓ Saved";
});
els.btnLibrary.addEventListener("click", () => { renderLib(); els.libOverlay.classList.add("open"); });
els.btnLibClose.addEventListener("click", () => els.libOverlay.classList.remove("open"));
els.libOverlay.addEventListener("click", e => { if (e.target === els.libOverlay) els.libOverlay.classList.remove("open"); });
function renderLib(){
  const lib = getLib();
  if (!lib.length) { els.libList.innerHTML = '<div class="lib-empty">No saved scripts yet.<br>Format a script, then hit 💾 Save to Library.</div>'; return; }
  els.libList.innerHTML = lib.map(item => `
    <div class="lib-item">
      <div class="meta">
        <div class="t">${esc(item.title)}</div>
        <div class="d">${new Date((item.meta && item.meta.date) || item.id).toLocaleString()}${item.meta && item.meta.n ? " · " + item.meta.n + " segments · " + tstamp(item.meta.n*10) : ""}${item.meta && (item.meta.ratio || item.meta.avatar) ? " · " + esc(item.meta.ratio || item.meta.avatar) : ""}</div>
      </div>
      <button class="btn-copy" data-action="lib-open" data-id="${item.id}">Open</button>
      <button class="btn-copy" data-action="lib-pdf" data-id="${item.id}">⬇ PDF</button>
      <button class="btn-copy" style="color:var(--err)" data-action="lib-del" data-id="${item.id}">Delete</button>
    </div>`).join("");
}
els.libList.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const id = Number(btn.dataset.id);
  if (btn.dataset.action === "lib-open") libLoad(id);
  else if (btn.dataset.action === "lib-pdf") libPdf(id);
  else if (btn.dataset.action === "lib-del") libDel(id);
});
window.libLoad = function(id){
  const item = getLib().find(x => x.id === id); if (!item) return;
  lastRaw = item.raw; lastMeta = item.meta;
  renderOutput(lastRaw);
  els.btnSaveLib.style.display = "inline-block"; els.btnPdf.style.display = "inline-block";
  els.btnSaveLib.textContent = "💾 Save to Library";
  els.libOverlay.classList.remove("open");
  setStatus("ok", "✓ Loaded from Library: " + esc(item.title));
};
window.libDel = function(id){ setLib(getLib().filter(x => x.id !== id)); renderLib(); };
window.libPdf = function(id){
  if (tier !== "pro") { showUpgrade("PDF export is a Pro feature."); return; }
  const item = getLib().find(x => x.id === id); if (item) makePdf(item.title, item.raw, item.meta);
};
els.btnPdf.addEventListener("click", () => { if (!lastRaw) return; if (tier !== "pro") { showUpgrade("PDF export is a Pro feature."); return; } makePdf(titleFor(lastRaw, lastMeta), lastRaw, lastMeta); });
function makePdf(title, raw, meta){
  if (!(window.jspdf && window.jspdf.jsPDF)) {
    const w = window.open("", "_blank");
    w.document.write("<pre style='font:11px Consolas,monospace;white-space:pre-wrap'>" + esc(raw) + "</pre>");
    w.document.close(); w.print(); return;
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const margin = 18, maxW = 210 - margin*2;
  let y = margin;
  doc.setFont("helvetica", "bold"); doc.setFontSize(14);
  const tLines = doc.splitTextToSize("TAHA Studio AI ScriptForge — " + title, maxW);
  doc.text(tLines, margin, y); y += tLines.length * 6 + 3;
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(120);
  doc.text(`${meta && meta.date ? new Date(meta.date).toLocaleString() : ""}${meta && meta.n ? "  ·  " + meta.n + " × 10s segments (" + tstamp(meta.n*10) + " total)" : ""}  ·  TAHA Production Studio`, margin, y);
  y += 8; doc.setTextColor(30); doc.setFontSize(10);
  const lines = doc.splitTextToSize(raw.replace(/\r/g,""), maxW);
  for (const line of lines) {
    if (y > 280) { doc.addPage(); y = margin; }
    doc.setFont("helvetica", /^###\s*SEGMENT/i.test(line.trim()) ? "bold" : "normal");
    doc.text(line, margin, y);
    y += 5;
  }
  doc.save(title.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "_").slice(0, 60) + ".pdf");
}
/* ─────────────────────────  MOCK TEST (canned simulation — no API)  ───────────────────────── */
const MOCK_SCRIPT = "Every great video starts with a script — but timing it, shot-listing it, and prepping it for production takes hours. TAHA Studio's Segment Formatter splits any script into perfectly timed ten-second blocks — narration, visuals, motion and audio notes included. From thirty seconds to five minutes, your script is production-ready in one click. Try it free at TAHA Production Studio today.";
const MOCK_RAW = `TECHNICAL SPECS
Script type: Short Advert
Ratio: 16:9
Specs: 1080p · SRT captions · flux-realism for B-roll

---

### SEGMENT 1 | 00:00–00:10

**Type**: Voiceover + B-Roll

**TTS Script**:
> Every great video starts with a script — but timing it, shot-listing it, and prepping it for production takes hours.

**Visual / B-Roll Prompt**:
> Photorealistic 16:9 shot of a cluttered editor's desk at night, dual monitors glowing with scattered script pages, warm lamp light, shallow depth of field, cinematic documentary grade.

**Motion**:
> Slow push-in toward the monitors; fallback Ken Burns zoom on still.

**Audio Note**:
> Music bed low (-18 dB), voice clear and forward.

---

### SEGMENT 2 | 00:10–00:20

**Type**: Voiceover + B-Roll

**TTS Script**:
> TAHA Studio's Segment Formatter splits any script into perfectly timed ten-second blocks — narration, visuals, motion, and audio notes included.

**Visual / B-Roll Prompt**:
> Clean 16:9 screen-capture style view of a dark dashboard interface, glowing blue segment cards appearing one by one, modern tech aesthetic, crisp UI lighting.

**Motion**:
> Subtle lateral glide; fallback Ken Burns left-to-right.

**Audio Note**:
> Keep music steady; no ducking needed.

---

### SEGMENT 3 | 00:20–00:30

**Type**: On-Camera + Brand Close

**TTS Script**:
> From thirty seconds to five minutes, your script is production-ready in one click. Try it free at TAHA Production Studio today.

**Visual / B-Roll Prompt**:
> Photorealistic 16:9 presenter in a modern studio, soft key light, TAHA Production Studio logo on a wall screen, confident closing smile.

**Motion**:
> Static locked shot; end-card fade to logo.

**Audio Note**:
> Music swells slightly for close (-14 dB), clean voice tail.`;
els.btnMock.addEventListener("click", () => {
  if (!els.script.value.trim()) { els.script.value = MOCK_SCRIPT; updateWordMeter(); }
  els.btnMock.disabled = true; els.btnFormat.disabled = true;
  setStatus("info", '<span class="spin"></span>Running mock simulation — no API call, no key needed…');
  setTimeout(() => {
    lastRaw = MOCK_RAW;
    lastMeta = { n: 3, ratio: "16:9", type: "Short Advert", date: new Date().toISOString(), mock: true };
    renderOutput(lastRaw);
    els.btnSaveLib.style.display = "inline-block"; els.btnPdf.style.display = "inline-block";
    els.btnSaveLib.textContent = "💾 Save to Library";
    setStatus("ok", "✓ Mock test complete — simulated output, no API used. Every button works: copy blocks, save to Library, download the PDF. Enter your API key to format your own scripts.");
    els.btnMock.disabled = false; els.btnFormat.disabled = false;
  }, 1400);
});
updateLengthUI();


/* ═════════════════════════  ACCOUNTS, GATING & LIBRARY BACKUP (v7)  ═════════════════════════
   Server holds ONLY: email, hashed credential (via auth provider), subscription status,
   license redemption record. Scripts + API key NEVER leave this browser.               */

const FREE_MAX_SEGS = 3, FREE_LIB_CAP = 5;
const PRO_MONTHLY_CHECKOUT_URL = "https://buy.polar.sh/polar_cl_A6Vc4BjSfy6csnvzYQdje8tq3QX85U2MI9HHw2iegnR";
const PRO_ANNUAL_CHECKOUT_URL = "https://buy.polar.sh/polar_cl_IocSZNT4jxQRqeijsaOd8zj7q31p2s09HmVQT42pvCr";
const LIFETIME_CHECKOUT_URL = "https://buy.polar.sh/polar_cl_Wt5DoGAYG0ewAMyDzs5vJ2CqdyR8Y8c7zYewT2a5TtN";
let user = null, tier = "free";

const els2 = {};
["btnAccount","authOverlay","btnAuthClose","authTitle","upsell","viewSignedOut","viewSignedIn",
 "authEmail","authPass","btnLogin","btnSignup","btnMagic","authStatus","acctInfo",
 "btnCheckoutMonthly","btnCheckoutAnnual","btnCheckoutLifetime",
 "licKey","btnRedeem","btnSignOut","btnDeleteAcct","deleteConfirm","delPass","btnDeleteFinal",
 "acctStatus","btnLibExport","btnLibImport","libFile","upgradeBox"].forEach(id => els2[id] = $(id));

async function api(path, body){
  try {
    const res = await fetch("/api/" + path, {
      method: body === undefined ? "GET" : "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    let data = null; try { data = await res.json(); } catch(e){}
    return { ok: res.ok, status: res.status, data };
  } catch(e) { return { ok: false, status: 0, data: null }; }
}

function setAuthStatus(el, cls, msg){ el.className = "status " + cls; el.innerHTML = msg; }

function applyTier(){
  [...els.segCount.options].forEach(o => {
    const locked = +o.value > FREE_MAX_SEGS && tier !== "pro";
    o.textContent = o.textContent.replace(/ 🔒 Pro$/, "") + (locked ? " 🔒 Pro" : "");
    o.disabled = locked;
  });
  // Pro customers already have full access — the free mock demo is only useful
  // pre-purchase, so hide it once a license is active.
  els.btnMock.style.display = tier === "pro" ? "none" : "";
  if (els.segCount.selectedOptions[0] && els.segCount.selectedOptions[0].disabled) {
    els.segCount.value = String(FREE_MAX_SEGS); updateLengthUI();
  }
  els2.btnAccount.textContent = user ? (tier === "pro" ? "👤 Account · Pro" : "👤 Account · Free") : "Sign in";
  if (user) {
    els2.acctInfo.textContent = `Signed in as: ${user.email}\nPlan: ${tier === "pro" ? "Pro (active)" : "Free"}`;
    els2.upgradeBox.style.display = tier === "pro" ? "none" : "block";
  }
}

async function refreshMe(){
  const r = await api("me");
  if (r.ok && r.data && r.data.email) { user = r.data; tier = (r.data.tier === "pro" && r.data.status === "active") ? "pro" : "free"; }
  else { user = null; tier = "free"; }
  applyTier();
  els2.viewSignedOut.style.display = user ? "none" : "block";
  els2.viewSignedIn.style.display  = user ? "block" : "none";
  els2.authTitle.textContent = user ? "Account" : "Sign in / Create account";
}

function showUpgrade(msg){
  els2.upsell.textContent = "🔒 " + msg + (user ? "" : " Sign in or create a free account, then upgrade.");
  els2.upsell.style.display = "block";
  els2.authOverlay.classList.add("open");
}
function openAccount(){ els2.upsell.style.display = "none"; els2.authOverlay.classList.add("open"); }

els2.btnAccount.addEventListener("click", openAccount);
els2.btnAuthClose.addEventListener("click", () => els2.authOverlay.classList.remove("open"));
els2.authOverlay.addEventListener("click", e => { if (e.target === els2.authOverlay) els2.authOverlay.classList.remove("open"); });

els2.btnLogin.addEventListener("click", async () => {
  setAuthStatus(els2.authStatus, "info", '<span class="spin"></span>Signing in…');
  const r = await api("login", { email: els2.authEmail.value.trim(), password: els2.authPass.value });
  if (r.ok) { setAuthStatus(els2.authStatus, "ok", "✓ Signed in."); els2.authPass.value = ""; await refreshMe(); }
  else setAuthStatus(els2.authStatus, "err", (r.data && r.data.error) || (r.status === 0 ? "Backend unreachable — accounts need the tahastudiolabs.com deployment." : "Sign-in failed. Check email and password."));
});
els2.btnSignup.addEventListener("click", async () => {
  setAuthStatus(els2.authStatus, "info", '<span class="spin"></span>Creating account…');
  const r = await api("signup", { email: els2.authEmail.value.trim(), password: els2.authPass.value });
  if (r.ok) setAuthStatus(els2.authStatus, "ok", "✓ Account created. Check your inbox to confirm your email, then sign in.");
  else setAuthStatus(els2.authStatus, "err", (r.data && r.data.error) || "Sign-up failed.");
});
els2.btnMagic.addEventListener("click", async () => {
  setAuthStatus(els2.authStatus, "info", '<span class="spin"></span>Sending link…');
  const r = await api("magic", { email: els2.authEmail.value.trim() });
  if (r.ok) setAuthStatus(els2.authStatus, "ok", "✓ Check your inbox for a one-click sign-in link.");
  else setAuthStatus(els2.authStatus, "err", (r.data && r.data.error) || "Could not send link.");
});
els2.btnSignOut.addEventListener("click", async () => { await api("logout", {}); await refreshMe(); });

els2.btnCheckoutMonthly.addEventListener("click", () => window.open(PRO_MONTHLY_CHECKOUT_URL, "_blank", "noopener"));
els2.btnCheckoutAnnual.addEventListener("click", () => window.open(PRO_ANNUAL_CHECKOUT_URL, "_blank", "noopener"));
els2.btnCheckoutLifetime.addEventListener("click", () => window.open(LIFETIME_CHECKOUT_URL, "_blank", "noopener"));
els2.btnRedeem.addEventListener("click", async () => {
  setAuthStatus(els2.acctStatus, "info", '<span class="spin"></span>Redeeming license…');
  const r = await api("redeem", { license_key: els2.licKey.value.trim() });
  if (r.ok) { setAuthStatus(els2.acctStatus, "ok", "✓ License redeemed — Pro unlocked on this account."); await refreshMe(); }
  else setAuthStatus(els2.acctStatus, "err", (r.data && r.data.error) || "Redemption failed.");
});

els2.btnDeleteAcct.addEventListener("click", () => { els2.deleteConfirm.style.display = "block"; });
els2.btnDeleteFinal.addEventListener("click", async () => {
  setAuthStatus(els2.acctStatus, "info", '<span class="spin"></span>Deleting account…');
  const r = await api("delete-account", { password: els2.delPass.value });
  if (r.ok) { setAuthStatus(els2.acctStatus, "ok", "✓ Account and all stored records deleted. Your local Library remains on this device."); user = null; tier = "free"; applyTier(); await refreshMe(); }
  else setAuthStatus(els2.acctStatus, "err", (r.data && r.data.error) || "Deletion failed — check your password.");
});

/* magic-link callback: tokens arrive in the URL fragment; exchange for httpOnly cookies, never persist */
(async function magicCallback(){
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.get("access_token") && h.get("refresh_token")) {
    history.replaceState(null, "", location.pathname + location.search);
    await api("session-from-token", { access_token: h.get("access_token"), refresh_token: h.get("refresh_token") });
  }
  await refreshMe();
})();

/* library export / import — manual backup path, no cloud copy exists */
els2.btnLibExport.addEventListener("click", () => {
  const blob = new Blob([JSON.stringify({ app: "TAHA_ScriptForge_Library", version: 1, exported: new Date().toISOString(), items: getLib() }, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "scriptforge-library-" + new Date().toISOString().slice(0,10) + ".json";
  a.click(); URL.revokeObjectURL(a.href);
});
els2.btnLibImport.addEventListener("click", () => els2.libFile.click());
els2.libFile.addEventListener("change", () => {
  const f = els2.libFile.files[0]; if (!f) return;
  const rd = new FileReader();
  rd.onload = () => {
    try {
      const data = JSON.parse(rd.result);
      const items = Array.isArray(data) ? data : data.items;
      if (!Array.isArray(items)) throw new Error("bad format");
      const lib = getLib(); const have = new Set(lib.map(x => x.id)); let added = 0;
      for (const it of items) if (it && it.id && it.raw && !have.has(it.id)) { lib.push(it); added++; }
      lib.sort((a,b) => b.id - a.id);
      if (tier !== "pro" && lib.length > FREE_LIB_CAP && added > 0) { showUpgrade("Import would exceed the free Library limit of " + FREE_LIB_CAP + " scripts."); els2.libFile.value = ""; return; }
      setLib(lib); renderLib();
      alert(added + " script(s) imported.");
    } catch(e) { alert("Could not import — not a valid ScriptForge library file."); }
    els2.libFile.value = "";
  };
  rd.readAsText(f);
});

/* ═════════════════════════  VIDEO GENERATION (Veo 3.1 / Grok Imagine / HeyGen)  ═════════════════════════
   Calls our own /api/video-start, /api/video-poll, /api/video-download relays — never the
   provider directly — using whichever of your own keys you entered in "5 · Video Generation".
   Ported from the standalone local pilot that validated all three providers; the only change
   is that every provider call now goes through our server instead of straight from the browser,
   for the same reason the Anthropic "Format" call does (real customers' ad blockers / antivirus
   can silently block a direct third-party call — confirmed behavior earlier in this product). */
async function videoApi(path, body) {
  const res = await fetch("/api/" + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

function vidSetStatus(num, cls, msg) {
  const el = $("vidStatus" + num);
  if (!el) return;
  el.className = "status " + cls;
  el.innerHTML = msg;
}

window.genClip = async function (num, btn) {
  const seg = window.__segPrompts && window.__segPrompts[num];
  if (!seg) { vidSetStatus(num, "err", "No segment data found."); return; }

  const provider = $("vidGen" + num).value;
  const providerMeta = VIDEO_PROVIDERS[provider];
  const apiKey = els[providerMeta.keyEl].value.trim();
  if (!apiKey) { vidSetStatus(num, "err", `Enter your ${provider === "veo" ? "Gemini" : provider === "grok" ? "xAI" : "HeyGen"} API key in the "5 · Video Generation" section first.`); return; }

  /* Duration: only Grok Imagine’s API actually accepts a variable duration (1-15s, confirmed
     via docs.x.ai/developers/model-capabilities/video/generation). Veo 3.1 generates fixed
     8-second clips per call (ai.google.dev/gemini-api/docs/veo) — sending it anything else
     isn’t supported by this integration, so it’s ignored. HeyGen’s /v3/video-agents has no
     formal duration field at all (confirmed via its OpenAPI schema) — "Duration: ~Ns" in the
     prompt is only a hint to its storyboard planner, not an enforced parameter. */
  const durInput = document.getElementById("vidDur" + num);
  const requestedDuration = Math.min(15, Math.max(1, Number(durInput?.value) || 15));

  /* Round 1 fix (routing TTS Script to HeyGen instead of the Visual Prompt) was confirmed
     insufficient by real-world testing: HeyGen still produced no sound, and Grok produced
     background music but never spoke the dialogue. Verified against each provider's actual
     API docs (not guessed):
     - Veo 3.1 (ai.google.dev/gemini-api/docs/veo): natively generates dialogue + SFX +
       ambience in ONE call, but only if the prompt explicitly writes speech in quotes, e.g.
       `A character says: "..."` — plain visual description alone renders silent/ambient-only.
     - Grok Imagine (docs.x.ai .../video/generation): the REST body is just
       {model, prompt, duration} — there is no separate dialogue field. Grok DOES support
       short embedded dialogue with lip-sync (per xAI's own partner-quote marketing), but only
       if the spoken line is written into the prompt text itself. Our old code sent Grok only
       seg.visualPrompt — literally never gave it any words — which fully explains "music but
       no dialogue": Grok had nothing to say because we never sent it anything to say.
     - HeyGen Video Agent (developers.heygen.com/reference/create-video-agent-session): the
       body has no dedicated script field either — a single free-text `prompt` (1–10000 chars)
       that an LLM storyboard planner freely interprets, deciding on its own whether to include
       an avatar and whether it speaks. avatar_id/voice_id default to null (auto-picked). HeyGen's
       own prompting guide's "Scene-by-Scene Prompting: Maximum Control" section recommends a
       labeled `Scene / Visual / VO/Script: "..." / Duration` structure specifically to force
       verbatim spoken narration — a bare unlabeled string (the round-1 fix) doesn't clearly
       signal "this must be spoken by an on-camera presenter," so the planner could reasonably
       render silent B-roll instead, which matches what was seen. */
  let prompt;
  if (provider === "heygen") {
    if (!seg.ttsScript) { vidSetStatus(num, "err", "No TTS Script found for this segment — HeyGen needs the spoken script text to generate voice."); return; }
    prompt = `Scene: ${seg.segType || "On-camera presenter"}\n`
      + `Visual: ${seg.visualPrompt || "A presenter speaking directly to camera"}${seg.motion ? ". Camera: " + seg.motion : ""}\n`
      + `VO/Script: "${seg.ttsScript}"\n`
      + `Instruction: this is a talking-presenter video, not silent B-roll — an on-camera avatar must speak the VO/Script line above verbatim, aloud, in a natural human voice.`
      + (seg.audioNote ? `\nAudio/Tone: ${seg.audioNote}` : "")
      + `\nDuration: ~${requestedDuration} seconds`;
  } else if (provider === "grok") {
    if (!seg.visualPrompt) { vidSetStatus(num, "err", "No visual prompt found for this segment."); return; }
    let p = seg.motion ? `${seg.visualPrompt}. Camera direction: ${seg.motion}` : seg.visualPrompt;
    if (seg.ttsScript) p += `. The on-camera subject speaks: "${seg.ttsScript}"`;
    if (seg.audioNote) p += `. Audio: ${seg.audioNote}`;
    prompt = p;
  } else {
    // Veo 3.1 — natively supports dialogue/SFX/ambience in the same prompt (per Google's own
    // prompting guide), using quotes for speech, so pass TTS Script/Audio Note through too.
    if (!seg.visualPrompt) { vidSetStatus(num, "err", "No visual prompt found for this segment."); return; }
    let p = seg.motion ? `${seg.visualPrompt}. Camera direction: ${seg.motion}` : seg.visualPrompt;
    if (seg.ttsScript) p += `. A character on screen says: "${seg.ttsScript}"`;
    if (seg.audioNote) p += `. Audio: ${seg.audioNote}`;
    prompt = p;
  }

  btn.disabled = true;
  $("vidResult" + num).innerHTML = "";
  vidSetStatus(num, "info", '<span class="spin"></span>Submitting…');

  try {
    const refFiles = [els.refImg1, els.refImg2, els.refImg3].map(el => el?.files?.[0]).filter(Boolean);
    const aspectRatio = els.vidAspectRatio?.value || "16:9";
    const resolutionSel = els.vidResolution?.value || "720p";

    /* Aspect ratio / resolution — the standalone pilot had these as real controls (Veo’s
       predictLongRunning API takes aspectRatio/resolution/durationSeconds directly), but the
       fusion never exposed them: genClip always sent the server-side defaults (16:9, 720p,
       durationSeconds:8) no matter what. Restoring parity with the pilot, including its
       duration-forcing rule — Veo only accepts 4/6/8-second clips, and Google forces 8s
       whenever resolution is 1080p/4k or a reference image is attached. */
    const veoForce8 = resolutionSel === "1080p" || resolutionSel === "4k" || refFiles.length > 0;
    let veoDuration = requestedDuration;
    if (veoForce8) veoDuration = 8;
    else veoDuration = [4, 6, 8].reduce((best, v) => Math.abs(v - veoDuration) < Math.abs(best - veoDuration) ? v : best);

    const params = {
      aspectRatio,
      // Grok’s base "grok-imagine-video" model doesn’t support 1080p/4k (that tier is 1.5-only,
      // and only for image-to-video) — always send 720p for Grok regardless of the Resolution
      // dropdown, rather than let a request with an unsupported resolution fail.
      resolution: provider === "grok" ? "720p" : resolutionSel,
      durationSeconds: veoDuration,
      duration: provider === "grok" ? requestedDuration : 8,
      // HeyGen has no resolution field, only orientation (landscape/portrait) — derive it from
      // the same aspect-ratio control so all three providers respect one shared setting.
      orientation: aspectRatio === "9:16" ? "portrait" : "landscape"
    };

    /* Reference images used to be encoded ONLY when provider === "veo" — selecting Grok skipped
       this whole block silently (no error shown), so Grok always generated from text alone and
       invented its own visuals instead of using the attached image. Grok Imagine has its own
       documented reference-to-video mode (docs.x.ai/.../video/reference-to-video), so it now
       gets the same images too, just encoded in the shape Grok’s API actually expects. */
    if (provider === "veo" || provider === "grok") {
      if (refFiles.length) {
        vidSetStatus(num, "info", '<span class="spin"></span>Encoding reference image(s)…');
        if (provider === "veo") {
          const encoded = await Promise.all(refFiles.map(fileToBase64));
          params.referenceImages = encoded.map(img => ({ image: img }));
        } else {
          const dataUris = await Promise.all(refFiles.map(fileToDataUri));
          params.referenceImages = dataUris.map(url => ({ url }));
          // Grok’s reference-to-video mode caps duration at 10s whenever reference images are
          // attached (confirmed in its docs) — clamp down rather than let the request fail.
          if (params.duration > 10) {
            params.duration = 10;
            vidSetStatus(num, "info", '<span class="spin"></span>Reference image attached — Grok caps clips with a reference image at 10s, adjusting…');
          }
        }
        vidSetStatus(num, "info", '<span class="spin"></span>Submitting…');
      }
    }
    const startRes = await videoApi("video-start", { provider, apiKey, prompt, params });
    if (!startRes.ok) throw new Error(startRes.data?.error?.message || `HTTP ${startRes.status}`);
    let jobRef = startRes.data.jobRef;

    const maxAttempts = 225, pollInterval = 4000;
    let uri = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await new Promise(r => setTimeout(r, pollInterval));
      vidSetStatus(num, "info", `<span class="spin"></span>Rendering… (attempt ${attempt}/${maxAttempts})`);
      const pollRes = await videoApi("video-poll", { provider, apiKey, jobRef });
      if (!pollRes.ok) throw new Error(pollRes.data?.error?.message || `HTTP ${pollRes.status}`);
      if (pollRes.data.jobRef) jobRef = pollRes.data.jobRef;
      if (pollRes.data.done) { uri = pollRes.data.uri; break; }
    }
    if (!uri) throw new Error("Timed out waiting for the clip after ~15 minutes.");

    vidSetStatus(num, "info", '<span class="spin"></span>Fetching clip…');
    const dlRes = await fetch("/api/video-download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, apiKey, uri })
    });
    if (!dlRes.ok) {
      const errData = await dlRes.json().catch(() => null);
      throw new Error(errData?.error?.message || `Download failed: HTTP ${dlRes.status}`);
    }
    const blob = await dlRes.blob();
    const blobUrl = URL.createObjectURL(blob);
    $("vidResult" + num).innerHTML = `
      <video controls src="${blobUrl}" style="max-width:100%;border-radius:8px"></video>
      <div style="margin-top:6px"><a href="${blobUrl}" download="segment-${num}-clip.mp4" style="color:var(--accent2)">⬇ Download this clip</a></div>`;
    vidSetStatus(num, "ok", "✓ Done.");
  } catch (err) {
    vidSetStatus(num, "err", "Error: " + err.message);
  } finally {
    btn.disabled = false;
  }
};
