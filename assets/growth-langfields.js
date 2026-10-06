/* TAHA Growth Department V2, Part H: the Swedish text fields of a campaign.
   Shared by the Brain Vault (Worker) and ScriptForge (browser), so both agree on what a
   "language item" is and how approved text replaces the machine text.

   A field path is a dotted path into the campaign document. Arrays are addressed by index
   (hook.0, adVariations.2.headline), except socialCopy (by channel: socialCopy.instagram.text)
   and visuals (by id: visuals.v_offer.overlay.headline). */

const CH = { instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok", linkedin: "LinkedIn", google_business: "Google Business", email: "Email" };
/* Where a platform allows less than the campaign schema, the platform wins. */
const POST_LIMIT = { instagram: 2200, tiktok: 2200, facebook: 3000, linkedin: 3000, google_business: 1500, email: 3000 };

export function langFields(doc) {
  const out = [];
  const add = (path, outputKey, label, kind, maxLen) => {
    const v = getPath(doc, path);
    if (typeof v === "string" && v.trim()) out.push({ path, outputKey, label, kind, maxLen, text: v });
  };
  if (doc.concept) {
    add("concept.title", "concept", "The idea: title", "concept", 200);
    add("concept.bigIdea", "concept", "The idea: big idea", "concept", 500);
    add("concept.keyMessage", "concept", "The idea: key message", "concept", 500);
  }
  (doc.hook || []).forEach((_, i) => add("hook." + i, "hook", "Opening line " + (i + 1), "hook", 300));
  if (doc.offer) {
    add("offer.framing", "offer", "Offer: framing", "offer", 1500);
    add("offer.terms", "offer", "Offer: terms", "offer", 500);
    add("offer.deadline", "offer", "Offer: deadline", "offer", 100);
    add("offer.riskReversal", "offer", "Offer: risk reversal", "offer", 500);
  }
  if (doc.shortVideo) add("shortVideo.script", "shortVideo", "Video script (spoken lines and on-screen text)", "video", 10000);
  (doc.socialCopy || []).forEach((p) => add("socialCopy." + p.channel + ".text", "socialCopy." + p.channel, "Post: " + (CH[p.channel] || p.channel), "post", POST_LIMIT[p.channel] || 3000));
  (doc.adVariations || []).forEach((_, i) => {
    add("adVariations." + i + ".headline", "adVariations." + (i + 1), "Ad " + (i + 1) + ": headline", "ad", 200);
    add("adVariations." + i + ".primaryText", "adVariations." + (i + 1), "Ad " + (i + 1) + ": primary text", "ad", 1500);
    add("adVariations." + i + ".description", "adVariations." + (i + 1), "Ad " + (i + 1) + ": description", "ad", 300);
  });
  (doc.cta || []).forEach((_, i) => {
    add("cta." + i + ".text", "cta", "Call to action " + (i + 1), "cta", 300);
    add("cta." + i + ".button", "cta", "Call to action " + (i + 1) + ": button", "cta", 40);
  });
  if (doc.landingPage) {
    add("landingPage.headline", "landingPage", "Landing page: headline", "page", 200);
    add("landingPage.subheadline", "landingPage", "Landing page: subheadline", "page", 400);
    (doc.landingPage.benefits || []).forEach((_, i) => {
      add("landingPage.benefits." + i + ".title", "landingPage", "Landing page: reason " + (i + 1) + " title", "page", 200);
      add("landingPage.benefits." + i + ".text", "landingPage", "Landing page: reason " + (i + 1) + " text", "page", 800);
    });
    add("landingPage.cta", "landingPage", "Landing page: button", "page", 200);
  }
  if (doc.email) {
    (doc.email.subjects || []).forEach((_, i) => add("email.subjects." + i, "email", "Email: subject line " + (i + 1), "email", 200));
    add("email.preview", "email", "Email: preview text", "email", 200);
    add("email.body", "email", "Email: body", "email", 8000);
    add("email.cta", "email", "Email: call to action", "email", 200);
  }
  if (doc.googleBusinessPost) add("googleBusinessPost.text", "googleBusinessPost", "Google Business post", "post", 1500);
  (doc.visuals || []).forEach((v) => {
    const where = v.placement || v.id;
    add("visuals." + v.id + ".overlay.headline", "visuals", "Image text: headline (" + where + ")", "overlay", 120);
    add("visuals." + v.id + ".overlay.sub", "visuals", "Image text: subline (" + where + ")", "overlay", 160);
    add("visuals." + v.id + ".overlay.cta", "visuals", "Image text: button (" + where + ")", "overlay", 60);
    add("visuals." + v.id + ".alt_text.sv", "visuals", "Alt text, Swedish (" + where + ")", "alt", 300);
  });
  return out;
}

function step(obj, key) {
  if (obj == null) return undefined;
  if (Array.isArray(obj)) {
    if (/^\d+$/.test(key)) return obj[Number(key)];
    return obj.find((x) => x && (x.channel === key || x.id === key));
  }
  return obj[key];
}

export function getPath(doc, path) {
  return String(path).split(".").reduce((o, k) => step(o, k), doc);
}

export function setPath(doc, path, value) {
  const keys = String(path).split(".");
  let o = doc;
  for (let i = 0; i < keys.length - 1; i++) {
    o = step(o, keys[i]);
    if (o == null || typeof o !== "object") return false;
  }
  const last = keys[keys.length - 1];
  if (Array.isArray(o) && !/^\d+$/.test(last)) return false;
  if (typeof (Array.isArray(o) ? o[Number(last)] : o[last]) !== "string") return false;
  if (Array.isArray(o)) o[Number(last)] = value;
  else o[last] = value;
  return true;
}

/* A copy of the campaign with every approved Swedish text in place of the machine text.
   approved: {fieldPath: text}. Paths that no longer exist are ignored. */
export function applyApproved(doc, approved) {
  const copy = JSON.parse(JSON.stringify(doc));
  Object.keys(approved || {}).forEach((p) => setPath(copy, p, approved[p]));
  return copy;
}

/* Parts of a text a reviewer may not change: links, offer codes and {{placeholders}}. */
export function lockedChips(text) {
  const s = String(text || "");
  const found = [];
  const add = (re) => { (s.match(re) || []).forEach((x) => { if (!found.includes(x)) found.push(x); }); };
  add(/https?:\/\/[^\s<>"']+/g);
  add(/\b[A-Z]{2,8}-(?:IG|FB|TT|LI|GB|EM|QR|VID|BIO|WEB)\b/g);
  add(/\{\{[A-Z_]+\}\}/g);
  return found;
}

/* The checks before Done: within the limit, no em-dash, no word to avoid, chips intact. */
export function checkReviewed(text, machine, { maxLen, avoid } = {}) {
  const problems = [];
  const s = String(text || "");
  if (!s.trim()) problems.push({ code: "empty", en: "The text is empty.", sv: "Texten är tom." });
  if (maxLen && s.length > maxLen) problems.push({ code: "length", en: "Too long: " + s.length + " of " + maxLen + " characters.", sv: "För lång: " + s.length + " av " + maxLen + " tecken." });
  if (/\u2014/.test(s)) problems.push({ code: "dash", en: "Contains an em-dash. Use a comma or a full stop.", sv: "Innehåller tankstreck (em-dash). Använd komma eller punkt." });
  const lower = s.toLowerCase();
  (avoid || []).filter(Boolean).forEach((w) => {
    if (lower.includes(String(w).toLowerCase())) problems.push({ code: "avoid", en: "Contains a word to avoid: " + w, sv: "Innehåller ett ord att undvika: " + w });
  });
  lockedChips(machine).forEach((c) => {
    if (!s.includes(c)) problems.push({ code: "chip", en: "This must stay exactly as it is: " + c, sv: "Det här måste stå kvar exakt: " + c });
  });
  return problems;
}

/* Word by word difference between two texts, for the side-by-side view. */
export function wordDiff(a, b) {
  const A = String(a || "").split(/(\s+)/);
  const B = String(b || "").split(/(\s+)/);
  const n = A.length, m = B.length;
  if (n * m > 4000000) return [{ op: "del", text: a }, { op: "add", text: b }];
  const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = [];
  const push = (op, text) => { const last = out[out.length - 1]; if (last && last.op === op) last.text += text; else out.push({ op, text }); };
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { push("same", A[i]); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) { push("del", A[i]); i++; }
    else { push("add", B[j]); j++; }
  }
  while (i < n) push("del", A[i++]);
  while (j < m) push("add", B[j++]);
  return out;
}
