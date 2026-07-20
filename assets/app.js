
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
  segCount: $("segCount"), lenBadge: $("lenBadge"),
  ratio: $("ratio"),
  techSpecs: $("techSpecs"), script: $("script"), wordMeter: $("wordMeter"),
  btnFormat: $("btnFormat"), btnClear: $("btnClear"), btnMock: $("btnMock"), status: $("status"),
  output: $("output"), rawOut: $("rawOut"),
  btnToggleRaw: $("btnToggleRaw"), btnCopyAll: $("btnCopyAll"),
  scriptType: $("scriptType"), btnSaveLib: $("btnSaveLib"), btnPdf: $("btnPdf"),
  btnLibrary: $("btnLibrary"), libOverlay: $("libOverlay"), libList: $("libList"), btnLibClose: $("btnLibClose")
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

/* ─────────────────────────  FORMAT (Anthropic browser API)  ───────────────────────── */
els.btnFormat.addEventListener("click", async () => {
  const key = els.apiKey.value.trim();
  const script = els.script.value.trim();
  if (!key || key === "sk-ant-YOUR_KEY_HERE") { setStatus("err", "Enter your Anthropic API key (console.anthropic.com/settings/keys)."); return; }
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
  setStatus("info", `<span class="spin"></span>Calling Anthropic API… splitting into ${n} × 10s segments`);

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify({
        model: els.model.value,
        max_tokens: Math.min(1500 + n*800, 16000),
        system: buildSystemPrompt(n, ratio),
        messages: [{ role: "user", content: userMsg }]
      })
    });
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
    setStatus("err", "API error: " + err.message + "<br>Check: key valid · all 3 headers present · network allows api.anthropic.com");
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
  const segRe = /###\s*SEGMENT\s*(\d+)\s*\|\s*([^\n]+)\n([\s\S]*?)(?=###\s*SEGMENT|\s*$)/gi;
  let m, found = 0;
  while ((m = segRe.exec(raw)) !== null) {
    found++;
    const num = m[1], time = m[2].trim(), body = m[3];
    const fields = [
      ["Type",                pick(body, "Type")],
      ["TTS Script",          pick(body, "TTS Script"),          "tts"],
      ["Visual / B-Roll Prompt", pick(body, "Visual / B-Roll Prompt") || pick(body, "Visual"), "visual"],
      ["Motion",              pick(body, "Motion")],
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
           <button class="btn-copy" onclick="copyText(this, ${JSON.stringify(blockMd).replace(/"/g,"&quot;")})">📋 Copy block</button>
         </div>
         <div class="seg-body">${inner || "<div class='field'><div class='fv'>"+esc(body.trim())+"</div></div>"}</div>
       </div>`
    );
  }

  els.output.innerHTML = found
    ? html.join("")
    : `<div class="specs-block"><div class="fl">Raw output</div>${esc(raw)}</div>`;
}

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
      <button class="btn-copy" onclick="libLoad(${item.id})">Open</button>
      <button class="btn-copy" onclick="libPdf(${item.id})">⬇ PDF</button>
      <button class="btn-copy" style="color:var(--err)" onclick="libDel(${item.id})">Delete</button>
    </div>`).join("");
}
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
const CHECKOUT_URL = "https://buy.polar.sh/YOUR_CHECKOUT_LINK_ID"; // TODO: paste Polar checkout link
let user = null, tier = "free";

const els2 = {};
["btnAccount","authOverlay","btnAuthClose","authTitle","upsell","viewSignedOut","viewSignedIn",
 "authEmail","authPass","btnLogin","btnSignup","btnMagic","authStatus","acctInfo","btnCheckout",
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

els2.btnCheckout.addEventListener("click", () => window.open(CHECKOUT_URL, "_blank", "noopener"));
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
