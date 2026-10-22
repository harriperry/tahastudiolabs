// src/config.js
function int(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
function list(value) {
  return String(value || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}
var PACKAGES = {
  starter: {
    label: "Starter",
    usage: "organic social media usage and 30-day paid advertising usage",
    usageShort: "Organic social media usage plus 30-day paid advertising usage",
    revisionRounds: 1,
    revisionLabel: "one revision round"
  },
  growth: {
    label: "Growth",
    usage: "60-day paid advertising usage",
    usageShort: "60-day paid advertising usage",
    revisionRounds: 2,
    revisionLabel: "two revision rounds"
  },
  scale: {
    label: "Scale",
    usage: "90-day paid advertising usage",
    usageShort: "90-day paid advertising usage",
    revisionRounds: 3,
    revisionLabel: "three revision rounds"
  },
  retainer: {
    label: "Retainer",
    usage: "flexible monthly usage rights, including paid advertising usage",
    usageShort: "Flexible monthly usage rights, including paid advertising usage",
    revisionRounds: 2,
    revisionLabel: "two revisions per video and priority delivery"
  }
};
var EXTRA_USAGE_NOTE = "Paid ads, whitelisting and extended usage beyond the included period are priced separately and agreed in writing before delivery.";
var CHANGE_ROUNDS_INCLUDED = 2;
var REVISION_DAYS = 7;
var GOALS = {
  sales: { label: "Sales", phrase: "drive sales" },
  leads: { label: "Leads", phrase: "generate leads" },
  awareness: { label: "Awareness", phrase: "build awareness" },
  app_installs: { label: "App installs", phrase: "get more app installs" },
  sign_ups: { label: "Sign-ups", phrase: "get more sign-ups" },
  other: { label: "Other", phrase: "" }
};
var PLATFORMS = {
  tiktok: "TikTok",
  reels: "Instagram Reels",
  meta_ads: "Meta Ads",
  shorts: "YouTube Shorts",
  other: "Other"
};
var LENGTHS = { "15_30": "15 to 30 seconds", "30_45": "30 to 45 seconds" };
var FIELDS = [
  { key: "brand", label: "Client or brand name", type: "text", required: true, max: 120, group: "About you" },
  { key: "contact_name", label: "Contact person", type: "text", required: true, max: 120, group: "About you" },
  { key: "email", label: "Email address", type: "email", required: true, max: 200, group: "About you", help: "Your private project link is sent here." },
  { key: "website", label: "Website", type: "text", required: false, max: 300, group: "About you" },
  { key: "socials", label: "Social media links", type: "textarea", required: false, max: 600, group: "About you" },
  { key: "product", label: "Product or service", type: "textarea", required: true, max: 800, group: "The campaign" },
  { key: "goal", label: "Campaign goal", type: "select", required: true, group: "The campaign", options: Object.fromEntries(Object.entries(GOALS).map(([k, v]) => [k, v.label])) },
  { key: "goal_other", label: "Describe the goal", type: "text", required: true, max: 160, group: "The campaign", showIf: { key: "goal", value: "other" } },
  { key: "audience", label: "Target audience", type: "textarea", required: true, max: 800, group: "The campaign" },
  { key: "problem", label: "Main problem the product solves", type: "textarea", required: true, max: 800, group: "The campaign" },
  { key: "benefits", label: "Key benefits or unique selling points", type: "textarea", required: true, max: 1e3, group: "The campaign" },
  { key: "platform", label: "Preferred platform", type: "select", required: true, group: "Format", options: PLATFORMS },
  { key: "platform_other", label: "Which platform?", type: "text", required: true, max: 120, group: "Format", showIf: { key: "platform", value: "other" } },
  { key: "length", label: "Preferred video length", type: "select", required: true, group: "Format", options: LENGTHS },
  { key: "delivery_date", label: "Desired delivery date", type: "date", required: false, group: "Format" },
  { key: "guidelines", label: "Brand guidelines, tone of voice, colors, fonts or content examples", type: "textarea", required: false, max: 1200, group: "Your brand" },
  { key: "claims", label: "Required claims, disclaimers, restricted words or compliance notes", type: "textarea", required: false, max: 1200, group: "Your brand" },
  { key: "package", label: "Package", type: "package", required: true, group: "Package" },
  { key: "notes", label: "Anything else we should know", type: "textarea", required: false, max: 1500, group: "Package" }
];
function getConfig(env) {
  const siteOrigin = (env.SITE_ORIGIN || "https://ugc.tahastudiolabs.com").replace(/\/+$/, "");
  const tahaEmail = String(env.TAHA_EMAIL || "hej@tahastudiolabs.com").trim().toLowerCase();
  const adminEmails = list(env.ADMIN_EMAILS);
  return {
    environment: env.ENVIRONMENT || "production",
    siteOrigin,
    tahaEmail,
    adminEmails: adminEmails.length ? adminEmails : [tahaEmail],
    fromName: env.MAIL_FROM_NAME || "TAHA Studio Labs",
    mailProvider: env.MAIL_PROVIDER || "resend",
    resendKey: env.RESEND_API_KEY || "",
    linkSecret: env.LINK_SECRET || "",
    privacyUrl: env.PRIVACY_URL || "https://tahastudiolabs.com/privacy.html",
    tokenTtlMinutes: int(env.LOGIN_TOKEN_TTL_MINUTES, 15),
    sessionDays: int(env.SESSION_DAYS, 14),
    submitsPerIpHour: int(env.SUBMITS_PER_IP_HOUR, 6),
    linkRequestsPerEmailHour: int(env.LINK_REQUESTS_PER_EMAIL_HOUR, 4),
    clientBase: siteOrigin + "/brief/",
    studioBase: siteOrigin + "/brief/studio"
  };
}
var ADMIN_COOKIE = "__Host-ugc_admin";
function stepOf(status) {
  if (status === "draft" || status === "brief_received") return 1;
  if (status === "script_review" || status === "changes_requested" || status === "approved") return 2;
  return 3;
}
var STATUS_LABELS = {
  draft: "Sending your brief",
  brief_received: "Brief received",
  script_review: "Hooks and script ready for your approval",
  changes_requested: "Changes requested, updated version coming",
  approved: "Approved, production starting",
  in_production: "In production",
  delivered: "Delivered",
  closed: "Closed"
};

// src/migrations.js
var MIGRATIONS = [
  {
    id: 1,
    name: "init",
    statements: [
      `CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        key_version INTEGER NOT NULL DEFAULT 1,
        brand TEXT NOT NULL,
        contact_name TEXT NOT NULL,
        email TEXT NOT NULL,
        package TEXT NOT NULL CHECK (package IN ('starter','growth','scale','retainer')),
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','brief_received','script_review','changes_requested','approved','in_production','delivered','closed')),
        brief TEXT NOT NULL,
        delivery_date TEXT,
        consent_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        finalized_at TEXT,
        change_rounds_used INTEGER NOT NULL DEFAULT 0,
        extra_rounds INTEGER NOT NULL DEFAULT 0,
        approved_proposal_id TEXT,
        approved_hook INTEGER,
        approved_at TEXT,
        production_started_at TEXT,
        delivered_at TEXT,
        revision_until TEXT,
        revisions_used INTEGER NOT NULL DEFAULT 0,
        videos_delivered INTEGER,
        delivery_link TEXT,
        delivery_note TEXT
      )`,
      `CREATE INDEX IF NOT EXISTS idx_projects_email ON projects (email)`,
      `CREATE INDEX IF NOT EXISTS idx_projects_status ON projects (status, updated_at)`,
      `CREATE TABLE IF NOT EXISTS proposals (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        hooks TEXT NOT NULL,
        recommended INTEGER NOT NULL,
        script TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','superseded','approved')),
        created_at TEXT NOT NULL,
        published_at TEXT
      )`,
      `CREATE INDEX IF NOT EXISTS idx_proposals_project ON proposals (project_id, version)`,
      `CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        author TEXT NOT NULL CHECK (author IN ('client','admin','system')),
        kind TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_messages_project ON messages (project_id, id)`,
      `CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        area TEXT NOT NULL CHECK (area IN ('asset','delivery')),
        name TEXT NOT NULL,
        ext TEXT NOT NULL,
        size INTEGER NOT NULL,
        r2_key TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_files_project ON files (project_id, area)`,
      `CREATE TABLE IF NOT EXISTS login_tokens (
        token_hash TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        used_at INTEGER
      )`,
      `CREATE TABLE IF NOT EXISTS sessions (
        session_hash TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS rate_events (
        bucket TEXT NOT NULL,
        at INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_rate_events_bucket_at ON rate_events (bucket, at)`
    ]
  }
];

// src/db.js
var ready = null;
function ensureSchema(env) {
  if (!ready) {
    ready = migrate(env).catch((e) => {
      ready = null;
      throw e;
    });
  }
  return ready;
}
async function migrate(env) {
  const db = env.DB;
  await db.prepare("CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)").run();
  const done = await db.prepare("SELECT id FROM schema_migrations").all();
  const applied = new Set((done.results || []).map((r) => r.id));
  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue;
    const stmts = m.statements.map((s) => db.prepare(s));
    stmts.push(db.prepare("INSERT OR IGNORE INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)").bind(m.id, m.name, (/* @__PURE__ */ new Date()).toISOString()));
    await db.batch(stmts);
  }
}

// src/util.js
var enc = new TextEncoder();
function nowMs() {
  return Date.now();
}
function nowIso() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function json(data, status = 200, headers = {}) {
  const h = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  for (const [k, v] of Object.entries(headers)) h.append(k, v);
  return new Response(JSON.stringify(data), { status, headers: h });
}
function withCookies(response, cookies) {
  if (!cookies || !cookies.length) return response;
  const r = new Response(response.body, response);
  for (const c of cookies) r.headers.append("Set-Cookie", c);
  return r;
}
function b64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function randomToken(byteLength = 32) {
  const a = new Uint8Array(byteLength);
  crypto.getRandomValues(a);
  return b64url(a);
}
var ID_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";
function newId(prefix, length = 12) {
  const a = new Uint8Array(length);
  crypto.getRandomValues(a);
  let s = "";
  for (const b of a) s += ID_ALPHABET[b % ID_ALPHABET.length];
  return prefix + "_" + s;
}
async function sha256hex(text2) {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(text2));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function hmacB64(secret, message) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return b64url(new Uint8Array(sig));
}
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
function getCookie(request, name) {
  const raw = request.headers.get("Cookie") || "";
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i > -1 && part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch (e) {
        return null;
      }
    }
  }
  return null;
}
function normEmail(e) {
  return typeof e === "string" ? e.trim().toLowerCase() : "";
}
function validEmail(e) {
  return typeof e === "string" && e.length < 255 && /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/.test(e);
}
async function readJson(request, maxBytes = 64 * 1024) {
  const len = parseInt(request.headers.get("Content-Length") || "0", 10);
  if (len > maxBytes) return null;
  const text2 = await request.text();
  if (text2.length > maxBytes) return null;
  try {
    const v = JSON.parse(text2);
    return v && typeof v === "object" ? v : null;
  } catch (e) {
    return null;
  }
}
function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function noDashes(s) {
  return String(s == null ? "" : s).replace(/\u2014/g, ", ").replace(/\u2013/g, "-");
}
function clip(s, max) {
  const t = String(s == null ? "" : s).trim();
  return t.length > max ? t.slice(0, max - 3).trimEnd() + "..." : t;
}
function text(value, max) {
  return typeof value === "string" ? noDashes(value.replace(/\r\n/g, "\n")).trim().slice(0, max) : "";
}

// src/mail.js
var devMails = [];
function devMailList() {
  return devMails;
}
async function sendMail(cfg, env, { to, subject, text: text2, html }) {
  subject = noDashes(subject);
  text2 = noDashes(text2);
  html = noDashes(html);
  if (cfg.mailProvider === "log") {
    if (cfg.environment === "production") throw new Error("MAIL_PROVIDER=log is not allowed in production");
    devMails.push({ to, subject, text: text2, html });
    if (devMails.length > 50) devMails.shift();
    console.log("[dev mail] to=" + to + " subject=" + subject);
    return { ok: true, provider: "log" };
  }
  if (cfg.mailProvider === "resend") {
    if (!cfg.resendKey) throw new Error("RESEND_API_KEY is not set");
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + cfg.resendKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: cfg.fromName + " <" + cfg.tahaEmail + ">",
        to: [to],
        reply_to: cfg.tahaEmail,
        subject,
        text: text2,
        html
      })
    });
    if (!res.ok) throw new Error("Resend failed with " + res.status);
    return { ok: true, provider: "resend" };
  }
  throw new Error("Unknown MAIL_PROVIDER");
}
var SHELL_OPEN = '<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#14161C;max-width:580px;margin:0 auto;padding:24px">';
var SHELL_CLOSE = "</body></html>";
function button(link, label) {
  return '<p style="margin:20px 0"><a href="' + escapeHtml(link) + '" style="display:inline-block;background:#14161C;color:#F6F1E7;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:700">' + escapeHtml(label) + "</a></p>";
}
function sign(cfg) {
  return "TAHA Studio Labs, \xD6rebro. " + cfg.tahaEmail;
}
function composeClientLink(cfg, { contactName, brand, link, again }) {
  const subject = again ? "Your private project link: " + brand : "Your AI UGC project: " + brand;
  const intro = again ? "Here is your private link to the " + brand + " project dashboard." : "Thank you for sharing your brief for " + brand + ". Your project now lives in your private dashboard.";
  const body = "In the dashboard you can see the status, approve your hooks and script, message me, and download your videos when they are ready. Please keep this link, it is how you get back in.";
  const text2 = "Hi " + contactName + ",\n\n" + intro + "\n\n" + body + "\n\nOpen your dashboard: " + link + "\n\n" + sign(cfg) + "\n";
  const html = SHELL_OPEN + '<p style="font-weight:700;font-size:17px;margin:0 0 18px">TAHA Studio Labs AI UGC</p><p>Hi ' + escapeHtml(contactName) + ",</p><p>" + escapeHtml(intro) + "</p><p>" + escapeHtml(body) + "</p>" + button(link, "Open your dashboard") + '<p style="color:#5E6470;font-size:12px;margin-top:28px">' + escapeHtml(sign(cfg)) + "</p>" + SHELL_CLOSE;
  return { subject, text: text2, html };
}
function composeNudge(cfg, { contactName, brand, link, what }) {
  const subject = "Something is waiting in your dashboard: " + brand;
  const text2 = "Hi " + contactName + ",\n\n" + what + "\n\nOpen your dashboard: " + link + "\n\n" + sign(cfg) + "\n";
  const html = SHELL_OPEN + "<p>Hi " + escapeHtml(contactName) + ",</p><p>" + escapeHtml(what) + "</p>" + button(link, "Open your dashboard") + '<p style="color:#5E6470;font-size:12px;margin-top:28px">' + escapeHtml(sign(cfg)) + "</p>" + SHELL_CLOSE;
  return { subject, text: text2, html };
}
function composeAdminLogin(cfg, { link }) {
  const subject = "Your Share Your Brief studio sign-in link";
  const text2 = "Click to sign in to the Share Your Brief studio. The link works once and is valid for " + cfg.tokenTtlMinutes + " minutes.\n\n" + link + "\n\nIf you did not ask for it, ignore this email.\n";
  const html = SHELL_OPEN + "<p>Sign in to the Share Your Brief studio. The link works once and is valid for " + cfg.tokenTtlMinutes + " minutes.</p>" + button(link, "Sign in") + '<p style="color:#5E6470;font-size:13px">If you did not ask for it, ignore this email.</p>' + SHELL_CLOSE;
  return { subject, text: text2, html };
}
function labelOf(f, value) {
  if (f.options) return f.options[value] || value;
  if (f.type === "package") return PACKAGES[value] ? PACKAGES[value].label : value;
  return value;
}
function briefRows(brief) {
  const rows = [];
  for (const f of FIELDS) {
    const v = brief[f.key];
    if (v == null || v === "") continue;
    rows.push([f.label, labelOf(f, v)]);
  }
  return rows;
}
function composeAdminBrief(cfg, { project, brief, files, adminLink }) {
  const subject = "New AI UGC Brief: " + project.brand;
  const rows = briefRows(brief);
  rows.push(["Submitted", project.created_at]);
  const fileLines = files.map((f) => f.name + " (" + Math.round(f.size / 1024) + " KB)");
  const text2 = "New brief from " + project.brand + " (" + project.contact_name + ", " + project.email + ").\n\n" + rows.map(([k, v]) => k + ": " + v).join("\n\n") + "\n\nUploaded assets (" + files.length + "):\n" + (fileLines.length ? fileLines.map((l) => "- " + l).join("\n") : "- none") + "\n\nOpen in the studio (assets download there): " + adminLink + "\n";
  const html = SHELL_OPEN + '<p style="font-weight:700;font-size:17px;margin:0 0 14px">New AI UGC Brief: ' + escapeHtml(project.brand) + '</p><table style="border-collapse:collapse;width:100%">' + rows.map(([k, v]) => '<tr><td style="vertical-align:top;padding:6px 10px 6px 0;color:#5E6470;width:34%">' + escapeHtml(k) + '</td><td style="padding:6px 0;white-space:pre-wrap">' + escapeHtml(v) + "</td></tr>").join("") + "</table><p><b>Uploaded assets (" + files.length + ")</b></p>" + (fileLines.length ? "<ul>" + fileLines.map((l) => "<li>" + escapeHtml(l) + "</li>").join("") + "</ul>" : "<p>None</p>") + button(adminLink, "Open in the studio") + SHELL_CLOSE;
  return { subject, text: text2, html };
}
function composeAdminEvent(cfg, { brand, what, adminLink }) {
  const subject = brand + ": " + what;
  const text2 = brand + ": " + what + "\n\n" + adminLink + "\n";
  const html = SHELL_OPEN + "<p><b>" + escapeHtml(brand) + "</b>: " + escapeHtml(what) + "</p>" + button(adminLink, "Open in the studio") + SHELL_CLOSE;
  return { subject, text: text2, html };
}

// src/auth.js
async function makeKey(cfg, projectId, version) {
  if (!cfg.linkSecret) throw new Error("LINK_SECRET is not set");
  return projectId + "." + await hmacB64(cfg.linkSecret, "pk|" + projectId + "|" + version);
}
function clientLink(cfg, key) {
  return cfg.clientBase + "#k=" + key;
}
async function authProject(request, env, cfg) {
  const header = request.headers.get("X-Project-Key") || "";
  const dot = header.indexOf(".");
  if (dot < 4 || header.length > 120) return null;
  const id = header.slice(0, dot);
  if (!/^pj_[a-z0-9]{4,32}$/.test(id)) return null;
  const project = await env.DB.prepare("SELECT * FROM projects WHERE id = ?").bind(id).first();
  if (!project) return null;
  const expected = await makeKey(cfg, id, project.key_version);
  return safeEqual(expected, header) ? project : null;
}
function isAdminEmail(cfg, email) {
  return cfg.adminEmails.includes(normEmail(email));
}
function adminCookie(cfg, token) {
  return ADMIN_COOKIE + "=" + token + "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=" + cfg.sessionDays * 86400;
}
function clearAdminCookie() {
  return ADMIN_COOKIE + "=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0";
}
async function allow(env, bucketName, max, windowMs = 3600 * 1e3) {
  const bucket = "b:" + await sha256hex(bucketName);
  const since = nowMs() - windowMs;
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM rate_events WHERE bucket = ? AND at > ?").bind(bucket, since).first();
  if (row.n >= max) return false;
  await env.DB.prepare("INSERT INTO rate_events (bucket, at) VALUES (?, ?)").bind(bucket, nowMs()).run();
  return true;
}
async function issueAdminLink(env, cfg, email) {
  if (!isAdminEmail(cfg, email)) return;
  const token = randomToken(32);
  const t = nowMs();
  await env.DB.prepare("INSERT INTO login_tokens (token_hash, email, created_at, expires_at) VALUES (?, ?, ?, ?)").bind(await sha256hex(token), email, t, t + cfg.tokenTtlMinutes * 60 * 1e3).run();
  const mail = composeAdminLogin(cfg, { link: cfg.studioBase + "/verify#t=" + token });
  try {
    await sendMail(cfg, env, { to: email, ...mail });
  } catch (e) {
    console.error("admin login email failed: " + e.message);
  }
}
async function consumeToken(env, token) {
  if (!token || token.length > 100) return null;
  const t = nowMs();
  return await env.DB.prepare("UPDATE login_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ? RETURNING email").bind(t, await sha256hex(token), t).first() || null;
}
async function createSession(env, cfg, email) {
  const token = randomToken(32);
  const t = nowMs();
  await env.DB.prepare("INSERT INTO sessions (session_hash, email, created_at, expires_at) VALUES (?, ?, ?, ?)").bind(await sha256hex(token), email, t, t + cfg.sessionDays * 86400 * 1e3).run();
  return token;
}
async function destroySession(env, request) {
  const token = getCookie(request, ADMIN_COOKIE);
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE session_hash = ?").bind(await sha256hex(token)).run();
}
async function getAdmin(request, env, cfg) {
  const token = getCookie(request, ADMIN_COOKIE);
  if (!token || token.length > 100) return null;
  const s = await env.DB.prepare("SELECT email FROM sessions WHERE session_hash = ? AND expires_at > ?").bind(await sha256hex(token), nowMs()).first();
  return s && isAdminEmail(cfg, s.email) ? s.email : null;
}
async function cleanup(env) {
  const t = nowMs();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM login_tokens WHERE expires_at < ?").bind(t - 86400 * 1e3),
    env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(t),
    env.DB.prepare("DELETE FROM rate_events WHERE at < ?").bind(t - 2 * 3600 * 1e3)
  ]);
}

// src/files.js
var MB = 1024 * 1024;
var CLIENT_TYPES = {
  jpg: { mime: "image/jpeg", magic: "jpeg", max: 15 * MB },
  jpeg: { mime: "image/jpeg", magic: "jpeg", max: 15 * MB },
  png: { mime: "image/png", magic: "png", max: 15 * MB },
  webp: { mime: "image/webp", magic: "webp", max: 15 * MB },
  pdf: { mime: "application/pdf", magic: "pdf", max: 15 * MB },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", magic: "zip", max: 15 * MB },
  txt: { mime: "text/plain", magic: "text", max: 5 * MB },
  mp4: { mime: "video/mp4", magic: "ftyp", max: 50 * MB },
  mov: { mime: "video/quicktime", magic: "ftyp", max: 50 * MB }
};
var ADMIN_MAX = 95 * MB;
var ADMIN_TYPES = Object.assign({}, CLIENT_TYPES, {
  srt: { mime: "text/plain", max: ADMIN_MAX },
  vtt: { mime: "text/vtt", max: ADMIN_MAX },
  zip: { mime: "application/zip", max: ADMIN_MAX },
  mp4: { mime: "video/mp4", max: ADMIN_MAX },
  mov: { mime: "video/quicktime", max: ADMIN_MAX },
  pdf: { mime: "application/pdf", max: ADMIN_MAX },
  png: { mime: "image/png", max: ADMIN_MAX },
  jpg: { mime: "image/jpeg", max: ADMIN_MAX },
  jpeg: { mime: "image/jpeg", max: ADMIN_MAX },
  webp: { mime: "image/webp", max: ADMIN_MAX },
  docx: { mime: CLIENT_TYPES.docx.mime, max: ADMIN_MAX },
  txt: { mime: "text/plain", max: ADMIN_MAX }
});
var MAX_CLIENT_ASSETS = 12;
var MAX_DELIVERY_FILES = 30;
function extOf(name) {
  const m = /\.([a-z0-9]{1,5})$/i.exec(String(name || ""));
  return m ? m[1].toLowerCase() : "";
}
function safeName(name) {
  const base = String(name || "file").split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f"<>|?*:]/g, "").trim();
  return (base || "file").slice(0, 120);
}
function magicOk(kind, b) {
  const at = (i, arr) => arr.every((v, k) => b[i + k] === v);
  if (kind === "jpeg") return b.length > 3 && at(0, [255, 216, 255]);
  if (kind === "png") return b.length > 8 && at(0, [137, 80, 78, 71, 13, 10, 26, 10]);
  if (kind === "webp") return b.length > 12 && at(0, [82, 73, 70, 70]) && at(8, [87, 69, 66, 80]);
  if (kind === "pdf") return b.length > 4 && at(0, [37, 80, 68, 70]);
  if (kind === "zip") return b.length > 4 && at(0, [80, 75, 3, 4]);
  if (kind === "ftyp") return b.length > 12 && at(4, [102, 116, 121, 112]);
  if (kind === "text") {
    const n = Math.min(b.length, 4096);
    for (let i = 0; i < n; i++) if (b[i] === 0) return false;
    return true;
  }
  return false;
}
function r2Key(projectId, fileId) {
  return "p/" + projectId + "/" + fileId;
}
function downloadResponse(object, file) {
  const type = (ADMIN_TYPES[file.ext] || {}).mime || "application/octet-stream";
  const ascii = file.name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
  return new Response(object.body, {
    headers: {
      "Content-Type": type,
      "Content-Length": String(object.size),
      "Content-Disposition": 'attachment; filename="' + ascii + `"; filename*=UTF-8''` + encodeURIComponent(file.name),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

// src/projects.js
var MSG = {
  bad: "Bad request.",
  notFound: "Not found.",
  tooMany: "Too many attempts. Please wait a while and try again.",
  locked: "That is not possible at this stage of the project.",
  server: "Something went wrong on our side. Please try again."
};
function ipOf(request) {
  return request.headers.get("CF-Connecting-IP") || "local";
}
function mailLater(ctx, cfg, env, to, mail) {
  const run = sendMail(cfg, env, { to, ...mail }).catch((e) => console.error("mail failed: " + e.message));
  if (ctx && ctx.waitUntil) ctx.waitUntil(run);
  return run;
}
function alertAdmin(ctx, cfg, env, project, what) {
  const mail = composeAdminEvent(cfg, { brand: project.brand, what, adminLink: cfg.studioBase + "#" + project.id });
  return mailLater(ctx, cfg, env, cfg.tahaEmail, mail);
}
async function nudgeClient(ctx, cfg, env, project, what) {
  const link = clientLink(cfg, await makeKey(cfg, project.id, project.key_version));
  const mail = composeNudge(cfg, { contactName: project.contact_name, brand: project.brand, link, what });
  return mailLater(ctx, cfg, env, project.email, mail);
}
async function addMessage(env, projectId, author, kind, body) {
  await env.DB.prepare("INSERT INTO messages (project_id, author, kind, body, created_at) VALUES (?, ?, ?, ?, ?)").bind(projectId, author, kind, body, nowIso()).run();
  await env.DB.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").bind(nowIso(), projectId).run();
}
function meta(cfg) {
  return json({
    fields: FIELDS,
    packages: Object.fromEntries(
      Object.entries(PACKAGES).map(([k, p]) => [k, { label: p.label, usage: p.usageShort, revision: p.revisionLabel }])
    ),
    usageNote: EXTRA_USAGE_NOTE,
    changeRounds: CHANGE_ROUNDS_INCLUDED,
    revisionDays: REVISION_DAYS,
    maxAssets: MAX_CLIENT_ASSETS,
    accept: Object.keys(CLIENT_TYPES),
    privacyUrl: cfg.privacyUrl
  });
}
function validDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = /* @__PURE__ */ new Date(s + "T00:00:00Z");
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return false;
  const now = Date.now();
  return d.getTime() > now - 2 * 864e5 && d.getTime() < now + 3 * 365 * 864e5;
}
function validateBrief(body) {
  const values = {};
  const errors = {};
  for (const f of FIELDS) {
    if (f.showIf && body[f.showIf.key] !== f.showIf.value) continue;
    const raw = body[f.key];
    if (f.type === "text" || f.type === "textarea") {
      const v = text(raw, f.max);
      if (!v && f.required) errors[f.key] = "Please fill this in.";
      if (v) values[f.key] = v;
    } else if (f.type === "email") {
      const v = normEmail(raw);
      if (!validEmail(v)) errors[f.key] = "Enter a valid email address.";
      else values[f.key] = v;
    } else if (f.type === "select") {
      if (typeof raw === "string" && Object.prototype.hasOwnProperty.call(f.options, raw)) values[f.key] = raw;
      else if (f.required) errors[f.key] = "Please choose one.";
    } else if (f.type === "package") {
      if (typeof raw === "string" && Object.prototype.hasOwnProperty.call(PACKAGES, raw)) values[f.key] = raw;
      else errors[f.key] = "Please choose a package.";
    } else if (f.type === "date") {
      if (typeof raw === "string" && raw) {
        if (validDate(raw)) values[f.key] = raw;
        else errors[f.key] = "Enter a valid date.";
      }
    }
  }
  if (body.consent !== true) errors.consent = "Please confirm that you have read the privacy policy.";
  return { values, errors };
}
async function submitBrief(request, env, cfg) {
  if (!await allow(env, "attempt:" + ipOf(request), 60)) return json({ error: "rate_limited", message: MSG.tooMany }, 429);
  const body = await readJson(request, 64 * 1024);
  if (!body) return json({ error: "bad_request", message: MSG.bad }, 400);
  if (body.company_url) return json({ ok: true, key: "pj_fake.fake" }, 201);
  const { values, errors } = validateBrief(body);
  if (Object.keys(errors).length) return json({ error: "validation", fields: errors }, 400);
  if (!await allow(env, "submit:" + ipOf(request), cfg.submitsPerIpHour)) return json({ error: "rate_limited", message: MSG.tooMany }, 429);
  const id = newId("pj", 10);
  const t = nowIso();
  await env.DB.prepare(
    `INSERT INTO projects (id, key_version, brand, contact_name, email, package, status, brief, delivery_date, consent_at, created_at, updated_at)
     VALUES (?, 1, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?)`
  ).bind(id, values.brand, values.contact_name, values.email, values.package, JSON.stringify(values), values.delivery_date || null, t, t, t).run();
  return json({ ok: true, key: await makeKey(cfg, id, 1) }, 201);
}
async function uploadAsset(request, env, cfg, url) {
  const project = await authProject(request, env, cfg);
  if (!project) return json({ error: "unauthorized", message: MSG.notFound }, 401);
  if (project.status === "in_production" || project.status === "delivered" || project.status === "closed")
    return json({ error: "locked", message: MSG.locked }, 409);
  const name = safeName(url.searchParams.get("name"));
  const ext = extOf(name);
  const rule = CLIENT_TYPES[ext];
  if (!rule) return json({ error: "type", message: "This file type is not accepted." }, 415);
  const len = parseInt(request.headers.get("Content-Length") || "0", 10);
  if (!len) return json({ error: "length", message: "Empty file." }, 411);
  if (len > rule.max) return json({ error: "too_large", message: "This file is too large." }, 413);
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM files WHERE project_id = ? AND area = 'asset'").bind(project.id).first();
  if (count.n >= MAX_CLIENT_ASSETS) return json({ error: "too_many", message: "File limit reached." }, 409);
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.length || bytes.length > rule.max) return json({ error: "too_large", message: "This file is too large." }, 413);
  if (!magicOk(rule.magic, bytes)) return json({ error: "type", message: "The file does not match its type." }, 415);
  const fileId = newId("f", 14);
  await env.FILES.put(r2Key(project.id, fileId), bytes, { httpMetadata: { contentType: rule.mime } });
  await env.DB.prepare("INSERT INTO files (id, project_id, area, name, ext, size, r2_key, created_at) VALUES (?, ?, 'asset', ?, ?, ?, ?, ?)").bind(fileId, project.id, name, ext, bytes.length, r2Key(project.id, fileId), nowIso()).run();
  return json({ ok: true, file: { id: fileId, name, size: bytes.length } }, 201);
}
async function finalizeProject(env, cfg, ctx, projectId) {
  const t = nowIso();
  const row = await env.DB.prepare(
    "UPDATE projects SET status = 'brief_received', finalized_at = ?, updated_at = ? WHERE id = ? AND status = 'draft' RETURNING *"
  ).bind(t, t, projectId).first();
  if (!row) return false;
  await addMessage(env, projectId, "system", "brief", "Brief received. You will get hook options and a script here within 24 to 48 hours.");
  const link = clientLink(cfg, await makeKey(cfg, row.id, row.key_version));
  mailLater(ctx, cfg, env, row.email, composeClientLink(cfg, { contactName: row.contact_name, brand: row.brand, link }));
  const files = (await env.DB.prepare("SELECT name, size FROM files WHERE project_id = ? AND area = 'asset' ORDER BY created_at").bind(row.id).all()).results || [];
  mailLater(ctx, cfg, env, cfg.tahaEmail, composeAdminBrief(cfg, { project: row, brief: JSON.parse(row.brief), files, adminLink: cfg.studioBase + "#" + row.id }));
  return true;
}
async function finalize(request, env, cfg, ctx) {
  const project = await authProject(request, env, cfg);
  if (!project) return json({ error: "unauthorized", message: MSG.notFound }, 401);
  await finalizeProject(env, cfg, ctx, project.id);
  return json({ ok: true });
}
async function sweepDrafts(env, cfg, ctx) {
  const cutoff = new Date(nowMs() - 10 * 60 * 1e3).toISOString();
  const rows = (await env.DB.prepare("SELECT id FROM projects WHERE status = 'draft' AND created_at < ?").bind(cutoff).all()).results || [];
  for (const r of rows) await finalizeProject(env, cfg, ctx, r.id);
}
async function requestLink(request, env, cfg, ctx) {
  const body = await readJson(request, 2 * 1024);
  const email = body ? normEmail(body.email) : "";
  if (!validEmail(email)) return json({ error: "email", message: "Enter a valid email address." }, 400);
  const okIp = await allow(env, "link-ip:" + ipOf(request), 20);
  const okEmail = await allow(env, "link-email:" + email, cfg.linkRequestsPerEmailHour);
  if (!okIp || !okEmail) return json({ error: "rate_limited", message: MSG.tooMany }, 429);
  const run = (async () => {
    const rows = (await env.DB.prepare("SELECT * FROM projects WHERE email = ? AND status NOT IN ('draft','closed') ORDER BY created_at DESC LIMIT 5").bind(email).all()).results || [];
    for (const p of rows) {
      const link = clientLink(cfg, await makeKey(cfg, p.id, p.key_version));
      await sendMail(cfg, env, { to: p.email, ...composeClientLink(cfg, { contactName: p.contact_name, brand: p.brand, link, again: true }) }).catch(
        (e) => console.error("mail failed: " + e.message)
      );
    }
  })();
  if (ctx && ctx.waitUntil) ctx.waitUntil(run);
  return json({ ok: true, message: "If a project exists for that address, we have sent the private link again. Check your inbox." });
}
function goalPhrase(brief) {
  const g = GOALS[brief.goal];
  if (!g) return "reach your goal";
  return brief.goal === "other" ? clip(brief.goal_other || "reach your goal", 120) : g.phrase;
}
function productLine(brief) {
  return clip(String(brief.product || "").split("\n")[0], 100);
}
function proposalIntro(brief, contactName) {
  return "Hi " + contactName + ", thank you for sharing your brief for " + productLine(brief) + ". Based on your goal to " + goalPhrase(brief) + " and your target audience of " + clip(brief.audience || "", 140) + ", here are three hook directions for your AI UGC video:";
}
function shapeProposal(r) {
  return {
    id: r.id,
    version: r.version,
    status: r.status,
    hooks: JSON.parse(r.hooks),
    recommended: r.recommended,
    script: JSON.parse(r.script),
    publishedAt: r.published_at
  };
}
function revisionOpen(p, now = Date.now()) {
  const pkg = PACKAGES[p.package];
  return p.status === "delivered" && !!p.revision_until && now <= Date.parse(p.revision_until) && p.revisions_used < pkg.revisionRounds;
}
async function loadBundle(env, id) {
  const project = await env.DB.prepare("SELECT * FROM projects WHERE id = ?").bind(id).first();
  if (!project) return null;
  const [proposals, messages, files] = await env.DB.batch([
    env.DB.prepare("SELECT * FROM proposals WHERE project_id = ? ORDER BY version").bind(id),
    env.DB.prepare("SELECT id, author, kind, body, created_at FROM messages WHERE project_id = ? ORDER BY id").bind(id),
    env.DB.prepare("SELECT id, area, name, ext, size, created_at FROM files WHERE project_id = ? ORDER BY created_at").bind(id)
  ]);
  return { project, proposals: proposals.results || [], messages: messages.results || [], files: files.results || [] };
}
function clientView(cfg, b) {
  const p = b.project;
  const pkg = PACKAGES[p.package];
  const brief = JSON.parse(p.brief);
  const visible = b.proposals.filter((x) => x.status === "published" || x.status === "approved");
  const current = visible.length ? shapeProposal(visible[visible.length - 1]) : null;
  const allowed = CHANGE_ROUNDS_INCLUDED + p.extra_rounds;
  const approvedProposal = b.proposals.find((x) => x.id === p.approved_proposal_id);
  const hookUsed = approvedProposal ? JSON.parse(approvedProposal.hooks)[p.approved_hook - 1] : null;
  return {
    project: {
      id: p.id,
      brand: p.brand,
      contactName: p.contact_name,
      email: p.email,
      status: p.status,
      statusLabel: STATUS_LABELS[p.status],
      step: stepOf(p.status),
      createdAt: p.created_at,
      deliveryDate: p.delivery_date,
      package: { key: p.package, label: pkg.label, usage: pkg.usageShort, revision: pkg.revisionLabel }
    },
    brief: FIELDS.filter((f) => brief[f.key]).map((f) => ({
      label: f.label,
      value: f.options ? f.options[brief[f.key]] || brief[f.key] : f.type === "package" ? PACKAGES[brief[f.key]].label : brief[f.key]
    })),
    files: {
      assets: b.files.filter((f) => f.area === "asset").map((f) => ({ id: f.id, name: f.name, size: f.size })),
      delivery: b.files.filter((f) => f.area === "delivery").map((f) => ({ id: f.id, name: f.name, size: f.size }))
    },
    proposal: current && { ...current, intro: proposalIntro(brief, p.contact_name) },
    approval: p.approved_at ? { hook: p.approved_hook, hookText: hookUsed, at: p.approved_at } : null,
    rounds: { used: p.change_rounds_used, allowed, left: Math.max(0, allowed - p.change_rounds_used) },
    production: { locked: !p.approved_at, started: !!p.production_started_at },
    delivery: p.delivered_at && {
      videos: p.videos_delivered,
      link: p.delivery_link,
      note: p.delivery_note,
      deliveredAt: p.delivered_at,
      revisionUntil: p.revision_until,
      revisionOpen: revisionOpen(p),
      revisionsUsed: p.revisions_used,
      revisionsAllowed: pkg.revisionRounds,
      usage: pkg.usage,
      usageNote: EXTRA_USAGE_NOTE
    },
    messages: b.messages.map((m) => ({ id: m.id, author: m.author, kind: m.kind, body: m.body, at: m.created_at }))
  };
}
async function getProject(request, env, cfg) {
  const project = await authProject(request, env, cfg);
  if (!project) return json({ error: "unauthorized", message: MSG.notFound }, 401);
  return json(clientView(cfg, await loadBundle(env, project.id)));
}
async function guard(request, env, cfg) {
  const project = await authProject(request, env, cfg);
  if (!project) return { res: json({ error: "unauthorized", message: MSG.notFound }, 401) };
  const body = await readJson(request, 16 * 1024);
  if (!body) return { res: json({ error: "bad_request", message: MSG.bad }, 400) };
  return { project, body };
}
async function approve(request, env, cfg, ctx) {
  const g = await guard(request, env, cfg);
  if (g.res) return g.res;
  const { project, body } = g;
  const hook = parseInt(body.hook, 10);
  if (project.status !== "script_review") return json({ error: "locked", message: MSG.locked }, 409);
  if (![1, 2, 3].includes(hook)) return json({ error: "hook", message: "Choose one of the three hooks." }, 400);
  if (body.confirmScript !== true) return json({ error: "confirm", message: "Please confirm the script." }, 400);
  const prop = await env.DB.prepare("SELECT * FROM proposals WHERE id = ? AND project_id = ? AND status = 'published'").bind(String(body.proposalId || ""), project.id).first();
  if (!prop) return json({ error: "stale", message: "That version is no longer current. Refresh the page." }, 409);
  const t = nowIso();
  await env.DB.batch([
    env.DB.prepare("UPDATE proposals SET status = 'approved' WHERE id = ?").bind(prop.id),
    env.DB.prepare("UPDATE projects SET status = 'approved', approved_proposal_id = ?, approved_hook = ?, approved_at = ?, updated_at = ? WHERE id = ?").bind(prop.id, hook, t, t, project.id)
  ]);
  await addMessage(env, project.id, "client", "approval", "Approved hook " + hook + " and the script (version " + prop.version + ").");
  alertAdmin(ctx, cfg, env, project, "approved hook " + hook + " and the script. Production can start.");
  return json({ ok: true });
}
async function requestChanges(request, env, cfg, ctx) {
  const g = await guard(request, env, cfg);
  if (g.res) return g.res;
  const { project, body } = g;
  const note = text(body.text, 2e3);
  if (project.status !== "script_review") return json({ error: "locked", message: MSG.locked }, 409);
  if (note.length < 3) return json({ error: "text", message: "Tell us what you would like changed." }, 400);
  const allowed = CHANGE_ROUNDS_INCLUDED + project.extra_rounds;
  if (project.change_rounds_used >= allowed)
    return json({ error: "no_rounds", message: "Both included change rounds are used. You can still approve this version, or ask in the messages about an extra concept round." }, 409);
  const moved = await env.DB.prepare(
    "UPDATE projects SET status = 'changes_requested', change_rounds_used = change_rounds_used + 1, updated_at = ? WHERE id = ? AND status = 'script_review' AND change_rounds_used < ? RETURNING id"
  ).bind(nowIso(), project.id, allowed).first();
  if (!moved) return json({ error: "locked", message: MSG.locked }, 409);
  await addMessage(env, project.id, "client", "changes_request", note);
  alertAdmin(ctx, cfg, env, project, "requested changes to the hooks or script (round " + (project.change_rounds_used + 1) + " of " + allowed + ").");
  return json({ ok: true });
}
async function postClientMessage(request, env, cfg, ctx) {
  const g = await guard(request, env, cfg);
  if (g.res) return g.res;
  const { project, body } = g;
  const note = text(body.text, 2e3);
  if (!note) return json({ error: "text", message: "Write a message first." }, 400);
  if (project.status === "draft") return json({ error: "locked", message: MSG.locked }, 409);
  if (!await allow(env, "msg:" + project.id, 30)) return json({ error: "rate_limited", message: MSG.tooMany }, 429);
  await addMessage(env, project.id, "client", "message", note);
  alertAdmin(ctx, cfg, env, project, "sent a message.");
  return json({ ok: true });
}
async function requestRevision(request, env, cfg, ctx) {
  const g = await guard(request, env, cfg);
  if (g.res) return g.res;
  const { project, body } = g;
  const note = text(body.text, 2e3);
  if (project.status !== "delivered") return json({ error: "locked", message: MSG.locked }, 409);
  if (!revisionOpen(project))
    return json({ error: "closed", message: "The " + REVISION_DAYS + " day revision window has ended or all included revision rounds are used." }, 409);
  if (note.length < 3) return json({ error: "text", message: "Tell us what you would like revised." }, 400);
  const counted = await env.DB.prepare(
    "UPDATE projects SET revisions_used = revisions_used + 1, updated_at = ? WHERE id = ? AND status = 'delivered' AND revisions_used < ? RETURNING id"
  ).bind(nowIso(), project.id, PACKAGES[project.package].revisionRounds).first();
  if (!counted) return json({ error: "closed", message: "All included revision rounds are used." }, 409);
  await addMessage(env, project.id, "client", "revision_request", note);
  alertAdmin(ctx, cfg, env, project, "requested a revision (" + (project.revisions_used + 1) + " of " + PACKAGES[project.package].revisionRounds + ").");
  return json({ ok: true });
}
async function downloadClientFile(request, env, cfg, fileId) {
  const project = await authProject(request, env, cfg);
  if (!project) return json({ error: "unauthorized", message: MSG.notFound }, 401);
  const file = await env.DB.prepare("SELECT * FROM files WHERE id = ? AND project_id = ?").bind(fileId, project.id).first();
  if (!file) return json({ error: "not_found", message: MSG.notFound }, 404);
  const object = await env.FILES.get(file.r2_key);
  if (!object) return json({ error: "not_found", message: MSG.notFound }, 404);
  return downloadResponse(object, file);
}

// src/admin.js
var BAD = { error: "bad_request", message: "Bad request." };
var WARN = [
  /\bguarantee(d|s)?\b/i,
  /\b100 ?%/,
  /\bcures?\b/i,
  /\bclinically proven\b/i,
  /\bscientifically proven\b/i,
  /\bdoctor[- ]approved\b/i,
  /\brisk[- ]free\b/i,
  /\bmiracle\b/i,
  /\bno side effects\b/i,
  /\bget rich\b/i,
  /\b(lose|drop) \d+ ?(kg|lbs?|pounds|kilos)\b/i,
  /(^|\s)#1(\s|$)/,
  /\bbest in the world\b/i,
  /\bovernight results?\b/i
];
function lint(strings) {
  const hits = /* @__PURE__ */ new Set();
  for (const s of strings) for (const re of WARN) {
    const m = re.exec(s);
    if (m) hits.add(m[0].trim());
  }
  return [...hits];
}
function parseProposal(body) {
  const hooksIn = Array.isArray(body.hooks) ? body.hooks : [];
  const hooks = hooksIn.slice(0, 3).map((h) => text(h, 300));
  const s = body.script && typeof body.script === "object" ? body.script : {};
  const script = {
    hook: text(s.hook, 600),
    problem: text(s.problem, 600),
    solution: text(s.solution, 600),
    benefit: text(s.benefit, 600),
    cta: text(s.cta, 400)
  };
  const recommended = parseInt(body.recommended, 10);
  if (hooks.length !== 3 || hooks.some((h) => !h)) return { error: "Write all three hook options." };
  if (![1, 2, 3].includes(recommended)) return { error: "Choose the recommended hook (1 to 3)." };
  if (Object.values(script).some((v) => !v)) return { error: "Fill in every part of the script: hook, problem, solution, benefit, call to action." };
  return { hooks, recommended, script, warnings: lint([...hooks, ...Object.values(script)]) };
}
function needsYou(row) {
  return ["brief_received", "changes_requested", "approved"].includes(row.status) || row.last_author === "client";
}
async function listProjects(env) {
  const rows = (await env.DB.prepare(
    `SELECT p.id, p.brand, p.contact_name, p.email, p.package, p.status, p.delivery_date, p.created_at, p.updated_at,
            (SELECT author FROM messages m WHERE m.project_id = p.id ORDER BY m.id DESC LIMIT 1) AS last_author
     FROM projects p WHERE p.status != 'draft' ORDER BY p.updated_at DESC LIMIT 300`
  ).all()).results || [];
  return json({
    projects: rows.map((r) => ({
      id: r.id,
      brand: r.brand,
      contactName: r.contact_name,
      email: r.email,
      package: PACKAGES[r.package].label,
      status: r.status,
      deliveryDate: r.delivery_date,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      needsYou: needsYou(r)
    }))
  });
}
async function getProjectAdmin(env, cfg, id) {
  const b = await loadBundle(env, id);
  if (!b) return json({ error: "not_found", message: "Not found." }, 404);
  const p = b.project;
  const brief = JSON.parse(p.brief);
  return json({
    project: {
      id: p.id,
      brand: p.brand,
      contactName: p.contact_name,
      email: p.email,
      status: p.status,
      package: { key: p.package, ...PACKAGES[p.package] },
      createdAt: p.created_at,
      deliveryDate: p.delivery_date,
      approvedAt: p.approved_at,
      approvedHook: p.approved_hook,
      approvedProposalId: p.approved_proposal_id,
      productionStartedAt: p.production_started_at,
      deliveredAt: p.delivered_at,
      revisionUntil: p.revision_until,
      revisionOpen: revisionOpen(p),
      revisionsUsed: p.revisions_used,
      videos: p.videos_delivered,
      deliveryLink: p.delivery_link,
      deliveryNote: p.delivery_note,
      rounds: { used: p.change_rounds_used, allowed: CHANGE_ROUNDS_INCLUDED + p.extra_rounds },
      productionLocked: !p.approved_at,
      clientLink: clientLink(cfg, await makeKey(cfg, p.id, p.key_version))
    },
    brief: FIELDS.filter((f) => brief[f.key]).map((f) => ({
      label: f.label,
      value: f.options ? f.options[brief[f.key]] || brief[f.key] : f.type === "package" ? PACKAGES[brief[f.key]].label : brief[f.key]
    })),
    briefRaw: brief,
    intro: proposalIntro(brief, p.contact_name),
    proposals: b.proposals.map(shapeProposal),
    files: b.files,
    messages: b.messages.map((m) => ({ id: m.id, author: m.author, kind: m.kind, body: m.body, at: m.created_at })),
    revisionDays: REVISION_DAYS
  });
}
async function createProposal(request, env, id) {
  const body = await readJson(request, 32 * 1024);
  if (!body) return json(BAD, 400);
  const project = await env.DB.prepare("SELECT status FROM projects WHERE id = ?").bind(id).first();
  if (!project) return json({ error: "not_found", message: "Not found." }, 404);
  if (!["brief_received", "changes_requested", "script_review"].includes(project.status))
    return json({ error: "locked", message: "A proposal cannot be added at this stage." }, 409);
  const parsed = parseProposal(body);
  if (parsed.error) return json({ error: "validation", message: parsed.error }, 400);
  const n = await env.DB.prepare("SELECT COALESCE(MAX(version), 0) AS v FROM proposals WHERE project_id = ?").bind(id).first();
  const pid = newId("pp", 10);
  await env.DB.prepare("INSERT INTO proposals (id, project_id, version, hooks, recommended, script, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'draft', ?)").bind(pid, id, n.v + 1, JSON.stringify(parsed.hooks), parsed.recommended, JSON.stringify(parsed.script), nowIso()).run();
  return json({ ok: true, id: pid, version: n.v + 1, warnings: parsed.warnings }, 201);
}
async function updateProposal(request, env, pid) {
  const body = await readJson(request, 32 * 1024);
  if (!body) return json(BAD, 400);
  const parsed = parseProposal(body);
  if (parsed.error) return json({ error: "validation", message: parsed.error }, 400);
  const r = await env.DB.prepare("UPDATE proposals SET hooks = ?, recommended = ?, script = ? WHERE id = ? AND status = 'draft' RETURNING id").bind(JSON.stringify(parsed.hooks), parsed.recommended, JSON.stringify(parsed.script), pid).first();
  if (!r) return json({ error: "locked", message: "Only a draft can be edited." }, 409);
  return json({ ok: true, warnings: parsed.warnings });
}
async function publishProposal(request, env, cfg, ctx, pid) {
  const body = await readJson(request, 2 * 1024) || {};
  const prop = await env.DB.prepare("SELECT * FROM proposals WHERE id = ?").bind(pid).first();
  if (!prop || prop.status !== "draft") return json({ error: "locked", message: "Only a draft can be published." }, 409);
  const project = await env.DB.prepare("SELECT * FROM projects WHERE id = ?").bind(prop.project_id).first();
  if (!["brief_received", "changes_requested", "script_review"].includes(project.status))
    return json({ error: "locked", message: "A proposal cannot be published at this stage." }, 409);
  const warnings = lint([...JSON.parse(prop.hooks), ...Object.values(JSON.parse(prop.script))]);
  if (warnings.length && body.ackWarnings !== true)
    return json({ error: "warnings", message: "Check these phrases before publishing: " + warnings.join(", "), warnings }, 409);
  const t = nowIso();
  await env.DB.batch([
    env.DB.prepare("UPDATE proposals SET status = 'superseded' WHERE project_id = ? AND status = 'published'").bind(project.id),
    env.DB.prepare("UPDATE proposals SET status = 'published', published_at = ? WHERE id = ?").bind(t, pid),
    env.DB.prepare("UPDATE projects SET status = 'script_review', updated_at = ? WHERE id = ?").bind(t, project.id)
  ]);
  await addMessage(env, project.id, "system", "proposal", prop.version === 1 ? "Your hooks and script are ready for your approval." : "An updated version of your hooks and script is ready (version " + prop.version + ").");
  if (body.notify === true) await nudgeClient(ctx, cfg, env, project, "Your hooks and script are ready for your approval.");
  return json({ ok: true });
}
async function startProduction(env, cfg, ctx, id, body) {
  const p = await env.DB.prepare("SELECT * FROM projects WHERE id = ?").bind(id).first();
  if (!p) return json({ error: "not_found", message: "Not found." }, 404);
  if (!p.approved_at || !p.approved_proposal_id)
    return json({ error: "production_locked", message: "Production stays locked until the client approves one hook and one script." }, 409);
  const t = nowIso();
  const r = await env.DB.prepare("UPDATE projects SET status = 'in_production', production_started_at = ?, updated_at = ? WHERE id = ? AND status = 'approved' RETURNING id").bind(t, t, id).first();
  if (!r) return json({ error: "locked", message: "Production can start only from the approved stage." }, 409);
  await addMessage(env, id, "system", "production", "Production has started.");
  if (body.notify === true) await nudgeClient(ctx, cfg, env, p, "Production on your videos has started.");
  return json({ ok: true });
}
async function grantExtraRound(env, id) {
  const r = await env.DB.prepare("UPDATE projects SET extra_rounds = extra_rounds + 1, updated_at = ? WHERE id = ? AND status IN ('script_review','changes_requested','brief_received') RETURNING id").bind(nowIso(), id).first();
  if (!r) return json({ error: "locked", message: "Extra rounds apply before approval." }, 409);
  await addMessage(env, id, "system", "round", "An extra concept change round was added to your project.");
  return json({ ok: true });
}
async function adminMessage(request, env, cfg, ctx, id) {
  const body = await readJson(request, 8 * 1024);
  const note = body ? text(body.text, 2e3) : "";
  if (!note) return json({ error: "text", message: "Write a message first." }, 400);
  const p = await env.DB.prepare("SELECT * FROM projects WHERE id = ?").bind(id).first();
  if (!p) return json({ error: "not_found", message: "Not found." }, 404);
  await addMessage(env, id, "admin", "message", note);
  if (body.notify === true) await nudgeClient(ctx, cfg, env, p, "You have a new message in your dashboard.");
  return json({ ok: true });
}
async function uploadDeliveryFile(request, env, id, url) {
  const p = await env.DB.prepare("SELECT status FROM projects WHERE id = ?").bind(id).first();
  if (!p) return json({ error: "not_found", message: "Not found." }, 404);
  const name = safeName(url.searchParams.get("name"));
  const ext = extOf(name);
  if (!ADMIN_TYPES[ext]) return json({ error: "type", message: "This file type is not accepted." }, 415);
  const len = parseInt(request.headers.get("Content-Length") || "0", 10);
  if (!len || !request.body) return json({ error: "length", message: "Empty file." }, 411);
  if (len > ADMIN_MAX) return json({ error: "too_large", message: "Files over 95 MB: paste a delivery link instead." }, 413);
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM files WHERE project_id = ? AND area = 'delivery'").bind(id).first();
  if (n.n >= MAX_DELIVERY_FILES) return json({ error: "too_many", message: "File limit reached." }, 409);
  const fileId = newId("f", 14);
  await env.FILES.put(r2Key(id, fileId), request.body, { httpMetadata: { contentType: ADMIN_TYPES[ext].mime } });
  await env.DB.prepare("INSERT INTO files (id, project_id, area, name, ext, size, r2_key, created_at) VALUES (?, ?, 'delivery', ?, ?, ?, ?, ?)").bind(fileId, id, name, ext, len, r2Key(id, fileId), nowIso()).run();
  return json({ ok: true, file: { id: fileId, name, size: len } }, 201);
}
async function deleteFile(env, fid) {
  const f = await env.DB.prepare("SELECT * FROM files WHERE id = ?").bind(fid).first();
  if (!f) return json({ error: "not_found", message: "Not found." }, 404);
  await env.FILES.delete(f.r2_key);
  await env.DB.prepare("DELETE FROM files WHERE id = ?").bind(fid).run();
  return json({ ok: true });
}
async function downloadAdminFile(env, fid) {
  const f = await env.DB.prepare("SELECT * FROM files WHERE id = ?").bind(fid).first();
  if (!f) return json({ error: "not_found", message: "Not found." }, 404);
  const object = await env.FILES.get(f.r2_key);
  if (!object) return json({ error: "not_found", message: "Not found." }, 404);
  return downloadResponse(object, f);
}
function deliveryMessage({ contactName, brief, pkg, videos, hookText, link }) {
  const lines = [
    "Hi " + contactName + ",",
    "",
    "Your AI UGC video for " + productLine(brief) + " is ready.",
    "",
    "Package: " + pkg.label,
    "Videos delivered: " + videos,
    "Approved hook used: " + hookText
  ];
  if (link) lines.push("Delivery link: " + link);
  lines.push(
    "",
    "Your final vertical video files, captions, and usage details are available in this dashboard.",
    "",
    "This delivery includes " + pkg.revisionLabel + ", depending on your package. Please send any revision requests within " + REVISION_DAYS + " days of delivery.",
    "",
    "Your included usage rights are: " + pkg.usage + ". " + EXTRA_USAGE_NOTE,
    "",
    "Thank you for working with TAHA Studio Labs."
  );
  return lines.join("\n");
}
async function deliver(request, env, cfg, ctx, id) {
  const body = await readJson(request, 8 * 1024);
  if (!body) return json(BAD, 400);
  const p = await env.DB.prepare("SELECT * FROM projects WHERE id = ?").bind(id).first();
  if (!p) return json({ error: "not_found", message: "Not found." }, 404);
  if (p.status !== "in_production") return json({ error: "locked", message: "Delivery needs a project that is in production." }, 409);
  if (!p.approved_proposal_id) return json({ error: "production_locked", message: "No approved hook and script on record." }, 409);
  const videos = parseInt(body.videos, 10);
  if (!(videos >= 1 && videos <= 50)) return json({ error: "videos", message: "Enter the number of videos delivered (1 to 50)." }, 400);
  let link = text(body.link, 500);
  if (link && !/^https:\/\/[^\s]+$/i.test(link)) return json({ error: "link", message: "The delivery link must start with https://" }, 400);
  const files = await env.DB.prepare("SELECT COUNT(*) AS n FROM files WHERE project_id = ? AND area = 'delivery'").bind(id).first();
  if (!files.n && !link) return json({ error: "nothing", message: "Upload at least one file or add a delivery link." }, 400);
  const note = text(body.note, 1e3);
  const prop = await env.DB.prepare("SELECT hooks FROM proposals WHERE id = ?").bind(p.approved_proposal_id).first();
  const hookText = JSON.parse(prop.hooks)[p.approved_hook - 1];
  const t = nowIso();
  const until = new Date(nowMs() + REVISION_DAYS * 864e5).toISOString();
  const r = await env.DB.prepare(
    "UPDATE projects SET status = 'delivered', delivered_at = ?, revision_until = ?, videos_delivered = ?, delivery_link = ?, delivery_note = ?, updated_at = ? WHERE id = ? AND status = 'in_production' RETURNING id"
  ).bind(t, until, videos, link || null, note || null, t, id).first();
  if (!r) return json({ error: "locked", message: "Delivery needs a project that is in production." }, 409);
  await addMessage(env, id, "admin", "delivery", deliveryMessage({ contactName: p.contact_name, brief: JSON.parse(p.brief), pkg: PACKAGES[p.package], videos, hookText, link }));
  if (body.notify === true) await nudgeClient(ctx, cfg, env, p, "Your AI UGC videos are ready.");
  return json({ ok: true, revisionUntil: until });
}
async function extendRevisions(request, env, id) {
  const body = await readJson(request, 1024);
  const days = body ? parseInt(body.days, 10) : 0;
  if (!(days >= 1 && days <= 30)) return json({ error: "days", message: "Choose 1 to 30 days." }, 400);
  const p = await env.DB.prepare("SELECT revision_until, status FROM projects WHERE id = ?").bind(id).first();
  if (!p || p.status !== "delivered") return json({ error: "locked", message: "Only a delivered project has a revision window." }, 409);
  const from = Math.max(nowMs(), Date.parse(p.revision_until));
  await env.DB.prepare("UPDATE projects SET revision_until = ?, updated_at = ? WHERE id = ?").bind(new Date(from + days * 864e5).toISOString(), nowIso(), id).run();
  await addMessage(env, id, "system", "window", "The revision window was extended by " + days + " day" + (days === 1 ? "" : "s") + ".");
  return json({ ok: true });
}
async function resetLink(env, cfg, id) {
  const p = await env.DB.prepare("UPDATE projects SET key_version = key_version + 1 WHERE id = ? RETURNING *").bind(id).first();
  if (!p) return json({ error: "not_found", message: "Not found." }, 404);
  return json({ ok: true, clientLink: clientLink(cfg, await makeKey(cfg, p.id, p.key_version)) });
}
async function closeProject(env, id) {
  const r = await env.DB.prepare("UPDATE projects SET status = 'closed', updated_at = ? WHERE id = ? AND status != 'draft' RETURNING id").bind(nowIso(), id).first();
  if (!r) return json({ error: "not_found", message: "Not found." }, 404);
  await addMessage(env, id, "system", "closed", "This project is closed. Thank you for working with TAHA Studio Labs.");
  return json({ ok: true });
}
async function eraseProject(env, id) {
  const rows = (await env.DB.prepare("SELECT r2_key FROM files WHERE project_id = ?").bind(id).all()).results || [];
  for (let i = 0; i < rows.length; i += 100) await env.FILES.delete(rows.slice(i, i + 100).map((r2) => r2.r2_key));
  const r = await env.DB.prepare("DELETE FROM projects WHERE id = ? RETURNING id").bind(id).first();
  if (!r) return json({ error: "not_found", message: "Not found." }, 404);
  return json({ ok: true, erased: id, filesRemoved: rows.length });
}

// src/public/brief.html
var brief_default = '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<meta name="robots" content="noindex, nofollow">\n<meta name="referrer" content="same-origin">\n<meta name="theme-color" content="#14161C">\n<title>Share Your Brief | TAHA Studio Labs AI UGC</title>\n<link rel="stylesheet" href="/brief/app.css?v=1">\n</head>\n<body>\n<header class="top">\n  <div class="brand"><span class="brand-top">TAHA Studio Labs</span><span class="brand-sub">AI UGC creator</span></div>\n  <a class="small" id="homeLink" href="/">Back to home</a>\n</header>\n<main id="app" class="wrap"><p class="muted">Loading...</p></main>\n<footer class="foot" id="foot"></footer>\n<noscript><p class="wrap">JavaScript is needed for this page.</p></noscript>\n<script src="/brief/app.js?v=1"><\/script>\n</body>\n</html>\n';

// src/public/brief.js
var brief_default2 = `/* Share Your Brief: client page. One file, no libraries. All text goes in through textContent,
   never innerHTML, so nothing a client types can run as code. */
(function () {
  "use strict";
  var API = "/api/brief";
  var STORE = "ugc_brief_key";
  var app = document.getElementById("app");
  var KEY = null;
  var META = null;
  var STATE = null;
  var drafts = {};
  var notice = "";
  var picked = [];
  var timer = null;
  var fingerprint = "";

  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null || v === false) return;
        if (k === "class") el.className = v;
        else if (k === "text") el.textContent = v;
        else if (k.indexOf("on") === 0) el.addEventListener(k.slice(2), v);
        else if (v === true) el.setAttribute(k, "");
        else el.setAttribute(k, v);
      });
    }
    for (var i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  function add(el, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach(function (x) { add(el, x); });
    else el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

  function call(path, opts) {
    opts = opts || {};
    var headers = opts.headers || {};
    if (KEY) headers["X-Project-Key"] = KEY;
    if (opts.json) { headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(opts.json); }
    return fetch(API + path, { method: opts.method || "GET", headers: headers, body: opts.body })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, status: r.status, data: d }; }); })
      .catch(function () { return { ok: false, status: 0, data: { message: "Could not reach the server. Check your connection and try again." } }; });
  }

  function fmtDate(iso) {
    try { return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }); } catch (e) { return iso; }
  }
  function fmtTime(iso) {
    try { return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); } catch (e) { return iso; }
  }
  function kb(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB"; }

  function saveKey(k) { KEY = k; try { localStorage.setItem(STORE, k); } catch (e) { /* private window */ } }
  function forgetKey() { KEY = null; try { localStorage.removeItem(STORE); } catch (e) { /* ignore */ } }
  function readKey() {
    var m = /[#&]k=([A-Za-z0-9_.\\-]+)/.exec(location.hash);
    if (m) { saveKey(m[1]); history.replaceState(null, "", location.pathname + location.search); return; }
    try { KEY = localStorage.getItem(STORE) || null; } catch (e) { KEY = null; }
  }

  /* ------------------------------------------------------------ steps strip */
  function stepsStrip(cur) {
    var names = ["Share your brief", "Approve hooks and script", "Receive your AI UGC videos"];
    return h("ol", { class: "steps", "aria-label": "Your project in three steps" },
      names.map(function (n, i) {
        var cls = i + 1 < cur ? "done" : i + 1 === cur ? "cur" : "";
        return h("li", { class: cls, "aria-current": i + 1 === cur ? "step" : null }, h("span", { class: "num" }, i + 1 < cur ? "\u2713" : String(i + 1)), n);
      }));
  }

  /* ------------------------------------------------------------ intake */
  function showIntake() {
    clear(app);
    document.title = "Share Your Brief | TAHA Studio Labs AI UGC";
    var form = buildForm();
    app.appendChild(h("div", null,
      h("div", { class: "kicker" }, "AI UGC for your brand"),
      h("h1", null, "Share Your Brief"),
      h("p", { class: "lede" }, "Tell me about your product and goal. Everything that follows happens in your private project dashboard: hook and script approval, revisions and delivery. No email threads.")));
    app.appendChild(stepsStrip(1));
    app.appendChild(form);
    app.appendChild(linkAgainCard());
  }

  function field(f, children) {
    return h("div", { class: "field", id: "w_" + f.key },
      f.type === "package" ? h("span", { class: "lab" }, f.label, f.required ? h("span", { class: "req" }, " *") : null) : h("label", { for: "f_" + f.key }, f.label, f.required ? h("span", { class: "req" }, " *") : null),
      children,
      f.help ? h("span", { class: "help" }, f.help) : null,
      h("span", { class: "err-text", id: "e_" + f.key, role: "alert" }));
  }

  function control(f) {
    if (f.type === "textarea") return h("textarea", { id: "f_" + f.key, name: f.key, maxlength: String(f.max || 1000), rows: "3" });
    if (f.type === "select") {
      var s = h("select", { id: "f_" + f.key, name: f.key }, h("option", { value: "" }, "Choose..."));
      Object.keys(f.options).forEach(function (k) { s.appendChild(h("option", { value: k }, f.options[k])); });
      return s;
    }
    if (f.type === "package") {
      var wrap = h("div", null);
      var grid = h("div", { class: "pkgs", role: "radiogroup" });
      var detail = h("div", { class: "pkgdetail hidden", id: "pkgDetail", "aria-live": "polite" });
      Object.keys(META.packages).forEach(function (k) {
        var p = META.packages[k];
        var input = h("input", { type: "radio", name: "package", value: k, onchange: function () {
          clear(detail);
          detail.classList.remove("hidden");
          detail.appendChild(h("b", null, p.label + " includes"));
          detail.appendChild(h("p", null, "Usage rights: " + p.usage + "."));
          detail.appendChild(h("p", null, "Revisions: " + p.revision + " within " + META.revisionDays + " days of delivery. Up to " + META.changeRounds + " rounds of changes to the hooks and script before production."));
          detail.appendChild(h("p", { class: "small muted" }, META.usageNote));
        } });
        grid.appendChild(h("label", { class: "pkg" }, input, h("b", null, p.label), h("span", { class: "small muted" }, p.usage)));
      });
      wrap.appendChild(grid);
      wrap.appendChild(detail);
      return wrap;
    }
    return h("input", { id: "f_" + f.key, name: f.key, type: f.type === "email" ? "email" : f.type === "date" ? "date" : "text", maxlength: String(f.max || 200), autocomplete: f.type === "email" ? "email" : "off" });
  }

  function buildForm() {
    var groups = [];
    META.fields.forEach(function (f) {
      var g = groups.filter(function (x) { return x.name === f.group; })[0];
      if (!g) { g = { name: f.group, items: [] }; groups.push(g); }
      g.items.push(f);
    });
    var form = h("form", { id: "intake", novalidate: true, autocomplete: "on" });
    groups.forEach(function (g) {
      var fs = h("fieldset", null, h("legend", null, g.name));
      g.items.forEach(function (f) { fs.appendChild(field(f, control(f))); });
      if (g.name === "Your brand") fs.appendChild(assetsField());
      form.appendChild(h("div", { class: "card" }, fs));
    });
    META.fields.forEach(function (f) {
      if (!f.showIf) return;
      var w = form.querySelector("#w_" + f.key);
      var src = form.querySelector("#f_" + f.showIf.key);
      var sync = function () { w.classList.toggle("hidden", src.value !== f.showIf.value); };
      src.addEventListener("change", sync);
      sync();
    });
    form.appendChild(h("div", { class: "hp", "aria-hidden": "true" }, h("label", null, "Leave this empty", h("input", { type: "text", name: "company_url", tabindex: "-1", autocomplete: "off" }))));
    form.appendChild(h("div", { class: "card" },
      h("label", { class: "row" }, h("input", { type: "checkbox", id: "consent" }), h("span", null, "I have read the ", h("a", { href: META.privacyUrl, target: "_blank", rel: "noopener noreferrer" }, "privacy policy"), " and agree that my brief and files are stored to produce my videos.")),
      h("span", { class: "err-text", id: "e_consent", role: "alert" }),
      h("div", { class: "row" }, h("button", { class: "btn gold", type: "submit", id: "sendBtn" }, "Share your brief"), h("span", { class: "muted small", id: "sendState", role: "status", "aria-live": "polite" }))));
    form.addEventListener("submit", onSubmit);
    return form;
  }

  function assetsField() {
    var list = h("ul", { class: "files", id: "pickedList" });
    var input = h("input", { type: "file", id: "assetInput", multiple: true, accept: META.accept.map(function (e) { return "." + e; }).join(",") });
    input.addEventListener("change", function () {
      addPicked(input.files, list);
      input.value = "";
    });
    return h("div", { class: "field" },
      h("label", { for: "assetInput" }, "Product images, demo video or other brand assets"),
      input,
      h("span", { class: "help" }, "Up to " + META.maxAssets + " files. Images, PDF, DOCX, TXT up to 15 MB. MP4 or MOV up to 50 MB."),
      list);
  }

  function extOf(n) { var m = /\\.([a-z0-9]{1,5})$/i.exec(n); return m ? m[1].toLowerCase() : ""; }
  function addPicked(files, list) {
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      var ext = extOf(f.name);
      var limit = ext === "mp4" || ext === "mov" ? 50 * 1048576 : ext === "txt" ? 5 * 1048576 : 15 * 1048576;
      if (META.accept.indexOf(ext) < 0) { notice = f.name + " was skipped: this file type is not accepted."; continue; }
      if (f.size > limit) { notice = f.name + " was skipped: it is too large."; continue; }
      if (picked.length >= META.maxAssets) { notice = "Only " + META.maxAssets + " files can be added."; break; }
      picked.push(f);
    }
    renderPicked(list);
    var s = document.getElementById("sendState");
    if (s && notice) { s.textContent = notice; notice = ""; }
  }
  function renderPicked(list) {
    clear(list);
    picked.forEach(function (f, i) {
      list.appendChild(h("li", null, h("span", null, f.name + " (" + kb(f.size) + ")"),
        h("button", { type: "button", class: "btn small ghost", onclick: function () { picked.splice(i, 1); renderPicked(list); } }, "Remove")));
    });
  }

  function fieldErrors(errs) {
    var first = null;
    META.fields.concat([{ key: "consent" }]).forEach(function (f) {
      var e = document.getElementById("e_" + f.key);
      var w = document.getElementById("w_" + f.key);
      if (!e) return;
      e.textContent = errs[f.key] || "";
      if (w) w.classList.toggle("bad", !!errs[f.key]);
      if (errs[f.key] && !first) first = e;
    });
    if (first) first.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function collect(form) {
    var body = { consent: document.getElementById("consent").checked, company_url: form.elements.company_url.value };
    META.fields.forEach(function (f) {
      if (f.type === "package") { var r = form.querySelector('input[name="package"]:checked'); body.package = r ? r.value : ""; return; }
      var el = form.querySelector("#f_" + f.key);
      if (el) body[f.key] = el.value;
    });
    return body;
  }

  function onSubmit(ev) {
    ev.preventDefault();
    var form = ev.target;
    var btn = document.getElementById("sendBtn");
    var state = document.getElementById("sendState");
    fieldErrors({});
    btn.disabled = true;
    state.textContent = "Sending your brief...";
    call("/submit", { method: "POST", json: collect(form) }).then(function (res) {
      if (!res.ok) {
        btn.disabled = false;
        if (res.data && res.data.fields) { fieldErrors(res.data.fields); state.textContent = "Please check the highlighted fields."; }
        else state.textContent = (res.data && res.data.message) || "Something went wrong. Please try again.";
        return;
      }
      if (res.data.key === "pj_fake.fake") { state.textContent = "Thank you."; return; }
      saveKey(res.data.key);
      uploadAll(state).then(function (failed) {
        return call("/finalize", { method: "POST", json: {} }).then(function () {
          if (failed.length) notice = failed.length + " file(s) could not be uploaded: " + failed.join(", ") + ". You can add them from your dashboard.";
          picked = [];
          return load(true);
        });
      });
    });
  }

  function uploadAll(state) {
    var failed = [];
    var chain = Promise.resolve();
    picked.forEach(function (f, i) {
      chain = chain.then(function () {
        state.textContent = "Uploading file " + (i + 1) + " of " + picked.length + "...";
        return upload(f).then(function (ok) { if (!ok) failed.push(f.name); });
      });
    });
    return chain.then(function () { return failed; });
  }
  function upload(file) {
    return call("/files?name=" + encodeURIComponent(file.name), { method: "POST", body: file, headers: { "Content-Type": "application/octet-stream" } }).then(function (r) { return r.ok; });
  }

  function linkAgainCard() {
    var msg = h("p", { class: "small", role: "status", "aria-live": "polite" });
    var input = h("input", { type: "email", id: "againEmail", autocomplete: "email", placeholder: "you@company.com" });
    return h("div", { class: "card" },
      h("h2", null, "Already shared a brief?"),
      h("p", { class: "muted" }, "Enter your email and we will send your private dashboard link again."),
      h("div", { class: "row" }, h("label", { class: "sr", for: "againEmail" }, "Email address"), input,
        h("button", { class: "btn ghost", type: "button", onclick: function () {
          call("/request-link", { method: "POST", json: { email: input.value } }).then(function (r) { msg.textContent = (r.data && r.data.message) || "Done."; });
        } }, "Send my link")),
      msg);
  }

  /* ------------------------------------------------------------ dashboard */
  function load(force) {
    return call("/project").then(function (res) {
      if (res.status === 401) { forgetKey(); stopPoll(); showIntake(); return; }
      if (!res.ok) { clear(app); app.appendChild(h("div", { class: "callout err" }, (res.data && res.data.message) || "Could not load your project.", " ", h("button", { class: "btn small ghost", type: "button", onclick: function () { load(true); } }, "Try again"))); return; }
      var fp = res.data.project.status + "|" + res.data.messages.length + "|" + (res.data.proposal ? res.data.proposal.id : "") + "|" + res.data.files.assets.length + "|" + res.data.files.delivery.length;
      var changed = fp !== fingerprint;
      STATE = res.data;
      fingerprint = fp;
      if (force || changed) render();
      startPoll();
    });
  }
  function startPoll() {
    if (timer) return;
    timer = setInterval(function () { if (!document.hidden && KEY) load(false); }, 60000);
  }
  function stopPoll() { if (timer) clearInterval(timer); timer = null; }

  function keepDrafts() {
    document.querySelectorAll("[data-draft]").forEach(function (el) { drafts[el.getAttribute("data-draft")] = el.value; });
  }
  function restoreDrafts() {
    document.querySelectorAll("[data-draft]").forEach(function (el) { var v = drafts[el.getAttribute("data-draft")]; if (v) el.value = v; });
  }

  function render() {
    keepDrafts();
    var s = STATE;
    var p = s.project;
    document.title = p.brand + " | Share Your Brief";
    clear(app);
    app.appendChild(h("div", null,
      h("div", { class: "kicker" }, "Your project dashboard"),
      h("h1", null, p.brand),
      h("div", { class: "row" }, h("span", { class: "chip gold" }, p.statusLabel), h("span", { class: "chip" }, p.package.label + " package"))));
    if (notice) { app.appendChild(h("div", { class: "callout" }, notice)); }
    app.appendChild(stepsStrip(p.step));
    app.appendChild(nextCallout());
    if (s.proposal) app.appendChild(proposalCard());
    if (s.delivery) app.appendChild(deliveryCard());
    app.appendChild(messagesCard());
    app.appendChild(briefCard());
    app.appendChild(termsCard());
    restoreDrafts();
    var foot = document.getElementById("foot");
    clear(foot);
    foot.appendChild(h("button", { class: "btn small ghost", type: "button", onclick: function () { forgetKey(); stopPoll(); fingerprint = ""; showIntake(); } }, "Not you? Forget this device"));
  }

  function nextCallout() {
    var s = STATE, p = s.project, d = s.delivery;
    var text, cls = "callout";
    if (p.status === "brief_received" || p.status === "draft") text = "Your brief is in. Hook options and a script arrive here within 24 to 48 hours.";
    else if (p.status === "script_review") { text = "Your hooks and script are ready below. Approve one hook and the script, or ask for small changes."; }
    else if (p.status === "changes_requested") text = "Your change request is with me. An updated version will appear here. Change rounds used: " + s.rounds.used + " of " + s.rounds.allowed + ".";
    else if (p.status === "approved") { text = "Approved. Production is being prepared."; cls += " ok"; }
    else if (p.status === "in_production") { text = "Your videos are in production."; cls += " ok"; }
    else if (p.status === "delivered") { text = d && d.revisionOpen ? "Your videos are delivered. Revisions are open until " + fmtDate(d.revisionUntil) + "." : "Your videos are delivered."; cls += " ok"; }
    else text = "This project is closed. Thank you for working with TAHA Studio Labs.";
    return h("div", { class: cls, role: "status" }, h("b", null, "What is next. "), text);
  }

  function proposalCard() {
    var s = STATE, pr = s.proposal, open = s.project.status === "script_review";
    var approvedHook = s.approval ? s.approval.hook : null;
    var card = h("section", { class: "card", "aria-labelledby": "ph" }, h("h2", { id: "ph" }, "Hooks and script"), h("p", { class: "muted" }, pr.intro));
    var hooksWrap = h("div", { class: "list", role: open ? "radiogroup" : null });
    pr.hooks.forEach(function (t, i) {
      var n = i + 1;
      var input = open ? h("input", { type: "radio", name: "hook", value: String(n), checked: n === pr.recommended }) : null;
      var cls = "hook" + (approvedHook && approvedHook !== n ? " dim" : "") + (approvedHook === n ? " sel" : "");
      hooksWrap.appendChild(h("label", { class: cls }, input, h("span", null, h("b", null, "Hook option " + n + (n === pr.recommended ? " (recommended)" : "") + (approvedHook === n ? " (approved)" : "")), h("br"), t)));
    });
    card.appendChild(hooksWrap);
    var sc = pr.script;
    card.appendChild(h("h3", null, "Script based on hook option " + pr.recommended));
    card.appendChild(h("dl", { class: "script" },
      h("dt", null, "Hook"), h("dd", null, sc.hook), h("dt", null, "Problem"), h("dd", null, sc.problem), h("dt", null, "Solution"), h("dd", null, sc.solution),
      h("dt", null, "Benefit"), h("dd", null, sc.benefit), h("dt", null, "Call to action"), h("dd", null, sc.cta)));
    if (s.approval) {
      card.appendChild(h("div", { class: "callout ok" }, "You approved hook " + s.approval.hook + " and this script on " + fmtDate(s.approval.at) + ". Production is unlocked."));
      return card;
    }
    if (!open) return card;
    var confirm = h("input", { type: "checkbox", id: "confirmScript" });
    var okBtn = h("button", { class: "btn gold", type: "button", disabled: true, onclick: function () {
      var r = document.querySelector('input[name="hook"]:checked');
      okBtn.disabled = true;
      call("/approve", { method: "POST", json: { proposalId: pr.id, hook: r ? r.value : 0, confirmScript: true } }).then(function (res) {
        if (!res.ok) { notice = (res.data && res.data.message) || "Could not approve."; }
        load(true);
      });
    } }, "Approve this hook and script");
    confirm.addEventListener("change", function () { okBtn.disabled = !confirm.checked; });
    card.appendChild(h("label", { class: "row" }, confirm, h("span", null, "I confirm the script above and the hook I selected.")));
    card.appendChild(okBtn);
    var left = s.rounds.left;
    var ta = h("textarea", { "data-draft": "changes", "aria-label": "What would you like changed?", placeholder: "Tell me what to change. Small changes only, for example a different tone, a different opening line, or a claim to remove.", disabled: left === 0 });
    var chBtn = h("button", { class: "btn ghost", type: "button", disabled: left === 0, onclick: function () {
      chBtn.disabled = true;
      call("/changes", { method: "POST", json: { proposalId: pr.id, text: ta.value } }).then(function (res) {
        if (!res.ok) { notice = (res.data && res.data.message) || "Could not send."; } else { drafts.changes = ""; notice = ""; }
        load(true);
      });
    } }, "Request changes");
    card.appendChild(h("h3", null, "Or request changes"));
    card.appendChild(h("p", { class: "small muted" }, left > 0 ? "Change round " + (s.rounds.used + 1) + " of " + s.rounds.allowed + ". Production starts only after you approve one hook and one script." : "Both included change rounds are used. You can still approve this version, or ask in the messages about an extra concept round."));
    card.appendChild(ta);
    card.appendChild(chBtn);
    return card;
  }

  function download(file) {
    fetch(API + "/files/" + file.id, { headers: { "X-Project-Key": KEY } }).then(function (r) {
      if (!r.ok) throw new Error("x");
      return r.blob();
    }).then(function (b) {
      var a = document.createElement("a");
      a.href = URL.createObjectURL(b);
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    }).catch(function () { notice = "That download did not work. Please try again."; render(); });
  }

  function fileList(files) {
    return h("ul", { class: "files" }, files.map(function (f) {
      return h("li", null, h("span", null, f.name + " (" + kb(f.size) + ")"), h("button", { class: "btn small ghost", type: "button", onclick: function () { download(f); } }, "Download"));
    }));
  }

  function deliveryCard() {
    var s = STATE, d = s.delivery;
    var card = h("section", { class: "card", "aria-labelledby": "dh" }, h("h2", { id: "dh" }, "Your delivery"));
    card.appendChild(h("dl", { class: "kv" },
      h("dt", null, "Package"), h("dd", null, s.project.package.label),
      h("dt", null, "Videos delivered"), h("dd", null, String(d.videos)),
      h("dt", null, "Approved hook used"), h("dd", null, s.approval && s.approval.hookText ? s.approval.hookText : ""),
      h("dt", null, "Delivered"), h("dd", null, fmtDate(d.deliveredAt)),
      h("dt", null, "Usage rights included"), h("dd", null, d.usage)));
    card.appendChild(h("p", { class: "small muted" }, d.usageNote));
    if (d.link) card.appendChild(h("p", null, "Delivery link: ", h("a", { href: d.link, target: "_blank", rel: "noopener noreferrer" }, d.link)));
    if (d.note) card.appendChild(h("p", null, d.note));
    if (s.files.delivery.length) { card.appendChild(h("h3", null, "Files")); card.appendChild(fileList(s.files.delivery)); }
    card.appendChild(h("h3", null, "Revisions"));
    if (d.revisionOpen) {
      var days = Math.max(0, Math.ceil((Date.parse(d.revisionUntil) - Date.now()) / 86400000));
      card.appendChild(h("p", { class: "small muted" }, "Open until " + fmtDate(d.revisionUntil) + " (" + days + " day" + (days === 1 ? "" : "s") + " left). Revision rounds used: " + d.revisionsUsed + " of " + d.revisionsAllowed + " (" + s.project.package.revision + ")."));
      var ta = h("textarea", { "data-draft": "revision", "aria-label": "What should be revised?", placeholder: "Describe what you would like revised." });
      var b = h("button", { class: "btn ghost", type: "button", onclick: function () {
        b.disabled = true;
        call("/revision", { method: "POST", json: { text: ta.value } }).then(function (res) {
          if (!res.ok) notice = (res.data && res.data.message) || "Could not send."; else { drafts.revision = ""; notice = "Revision request sent."; }
          load(true);
        });
      } }, "Request revision");
      card.appendChild(ta);
      card.appendChild(b);
    } else {
      card.appendChild(h("p", { class: "muted" }, "The " + (META ? META.revisionDays : 7) + " day revision window has ended or all included revision rounds are used. Use the messages below if you need something else."));
    }
    return card;
  }

  function messagesCard() {
    var s = STATE;
    var thread = h("div", { class: "thread", role: "log", "aria-live": "polite" });
    s.messages.forEach(function (m) {
      var who = m.author === "client" ? "You" : m.author === "admin" ? "TAHA Studio Labs" : "Update";
      thread.appendChild(h("div", { class: "msg " + m.author }, h("span", { class: "meta" }, who + " \xB7 " + fmtTime(m.at)), m.body));
    });
    var ta = h("textarea", { "data-draft": "message", "aria-label": "Write a message", placeholder: "Write a message to TAHA Studio Labs" });
    var b = h("button", { class: "btn", type: "button", onclick: function () {
      if (!ta.value.trim()) return;
      b.disabled = true;
      call("/message", { method: "POST", json: { text: ta.value } }).then(function (res) {
        if (!res.ok) notice = (res.data && res.data.message) || "Could not send."; else { drafts.message = ""; notice = ""; }
        load(true);
      });
    } }, "Send message");
    var card = h("section", { class: "card", "aria-labelledby": "mh" }, h("h2", { id: "mh" }, "Messages"), thread, ta, b);
    setTimeout(function () { thread.scrollTop = thread.scrollHeight; }, 0);
    return card;
  }

  function briefCard() {
    var s = STATE;
    var d = h("details", { class: "card" }, h("summary", null, "Your brief"));
    d.appendChild(h("dl", { class: "kv" }, s.brief.map(function (r) { return [h("dt", null, r.label), h("dd", null, r.value)]; })));
    d.appendChild(h("h3", null, "Files you shared"));
    d.appendChild(s.files.assets.length ? fileList(s.files.assets) : h("p", { class: "muted" }, "No files shared."));
    if (["draft", "brief_received", "script_review", "changes_requested", "approved"].indexOf(s.project.status) >= 0) {
      var input = h("input", { type: "file", multiple: true, "aria-label": "Add more files" });
      input.addEventListener("change", function () {
        var files = Array.prototype.slice.call(input.files);
        var chain = Promise.resolve();
        files.forEach(function (f) { chain = chain.then(function () { return upload(f); }); });
        chain.then(function () { load(true); });
      });
      d.appendChild(h("p", { class: "small muted" }, "Add more files:"));
      d.appendChild(input);
    }
    return d;
  }

  function termsCard() {
    var s = STATE;
    return h("section", { class: "card" }, h("h2", null, s.project.package.label + " package terms"),
      h("p", null, "Usage rights: " + s.project.package.usage + "."),
      h("p", null, "Revisions: " + s.project.package.revision + ", requested within " + (META ? META.revisionDays : 7) + " days of delivery."),
      h("p", { class: "small muted" }, META ? META.usageNote : ""));
  }

  /* ------------------------------------------------------------ boot */
  readKey();
  call("/meta").then(function (res) {
    if (!res.ok) { clear(app); app.appendChild(h("div", { class: "callout err" }, "This page could not load. Please refresh.")); return; }
    META = res.data;
    if (KEY) load(true); else showIntake();
  });
})();
`;

// src/public/brief.css
var brief_default3 = '/* Share Your Brief and the studio. Tokens from the TAHA Studio Labs design system.\n   System fonts only: nothing is loaded from Google or anywhere else (GDPR). */\n:root {\n  --studio-ink: #14161C;\n  --reel-gold: #E3A21A;\n  --gold-text: #8A5D08;\n  --canopy: #1F6B4E;\n  --clay: #B8452A;\n  --paper: #F6F1E7;\n  --raised: #FFFFFF;\n  --ink: #14161C;\n  --muted: #5E6470;\n  --hairline: #DDD5C6;\n  --soft: #F0EADF;\n  --on-dark: #F6F1E7;\n  --on-dark-muted: #A2A8B3;\n  --display: "Space Grotesk", "Segoe UI Semibold", "Segoe UI", system-ui, -apple-system, sans-serif;\n  --sans: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;\n  --mono: ui-monospace, "Cascadia Mono", Consolas, "SF Mono", monospace;\n}\n@media (prefers-color-scheme: dark) {\n  :root {\n    --gold-text: #F0B94A;\n    --canopy: #3FA37A;\n    --clay: #E06A48;\n    --paper: #14161C;\n    --raised: #1E2129;\n    --ink: #F3EEE4;\n    --muted: #A2A8B3;\n    --hairline: #2E323C;\n    --soft: #262A33;\n  }\n}\n* { box-sizing: border-box; }\nhtml { -webkit-text-size-adjust: 100%; }\nbody { margin: 0; background: var(--paper); color: var(--ink); font: 15px/22px var(--sans); min-height: 100vh; display: flex; flex-direction: column; }\na { color: var(--gold-text); }\n.hidden { display: none !important; }\n.muted { color: var(--muted); }\n.small { font-size: 13px; line-height: 19px; }\n.top { background: var(--studio-ink); color: var(--on-dark); padding: 12px 16px; display: flex; justify-content: space-between; align-items: center; gap: 12px; }\n.brand { display: flex; flex-direction: column; }\n.brand-top { font: 700 16px/20px var(--display); }\n.brand-sub { font-size: 12px; line-height: 16px; color: var(--on-dark-muted); }\n.wrap { width: 100%; max-width: 760px; margin: 0 auto; padding: 24px 16px 48px; flex: 1 0 auto; display: flex; flex-direction: column; gap: 18px; }\n.wrap.wide { max-width: 980px; }\n.kicker { font: 500 12px/16px var(--mono); color: var(--gold-text); letter-spacing: 1px; text-transform: uppercase; }\nh1 { margin: 0; font: 700 30px/36px var(--display); }\nh2 { margin: 0 0 4px; font: 700 19px/26px var(--display); }\nh3 { margin: 14px 0 4px; font: 700 15px/22px var(--display); }\np { margin: 0 0 10px; }\n.lede { font-size: 17px; line-height: 26px; color: var(--muted); }\n.card { background: var(--raised); border: 1px solid var(--hairline); border-radius: 14px; padding: 18px; display: flex; flex-direction: column; gap: 12px; }\n.card > * { margin: 0; }\n.steps { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }\n.steps li { background: var(--raised); border: 1px solid var(--hairline); border-radius: 12px; padding: 12px; font: 600 13px/18px var(--sans); display: flex; flex-direction: column; gap: 6px; }\n.steps .num { width: 26px; height: 26px; border-radius: 999px; background: var(--soft); color: var(--muted); display: inline-flex; align-items: center; justify-content: center; font: 700 13px var(--display); }\n.steps li.done .num { background: var(--canopy); color: #fff; }\n.steps li.cur { border-color: var(--reel-gold); box-shadow: 0 0 0 2px rgba(227, 162, 26, 0.35); }\n.steps li.cur .num { background: var(--reel-gold); color: var(--studio-ink); }\n.chip { display: inline-block; padding: 3px 10px; border-radius: 999px; background: var(--soft); font: 600 12px/18px var(--sans); }\n.chip.gold { background: var(--reel-gold); color: var(--studio-ink); }\n.chip.green { background: var(--canopy); color: #fff; }\n.chip.clay { background: var(--clay); color: #fff; }\n.callout { border-left: 4px solid var(--reel-gold); background: var(--soft); border-radius: 8px; padding: 12px 14px; }\n.callout.ok { border-left-color: var(--canopy); }\n.callout.err { border-left-color: var(--clay); }\nform { display: flex; flex-direction: column; gap: 16px; }\nfieldset { border: 0; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 14px; min-width: 0; }\nlegend { padding: 0; font: 700 17px/24px var(--display); margin-bottom: 4px; }\n.field { display: flex; flex-direction: column; gap: 5px; }\n.field label, .lab { font: 600 14px/20px var(--sans); }\n.req { color: var(--clay); }\n.help { color: var(--muted); font-size: 13px; }\ninput[type="text"], input[type="email"], input[type="date"], input[type="number"], select, textarea {\n  width: 100%; min-height: 44px; padding: 10px 12px; border: 1px solid var(--hairline); border-radius: 10px; background: var(--raised); color: var(--ink); font: 16px/22px var(--sans);\n}\ntextarea { min-height: 96px; resize: vertical; }\ninput:focus-visible, select:focus-visible, textarea:focus-visible, button:focus-visible, a:focus-visible { outline: 3px solid var(--reel-gold); outline-offset: 2px; }\n.err-text { color: var(--clay); font-size: 13px; min-height: 0; }\n.field.bad input, .field.bad select, .field.bad textarea { border-color: var(--clay); }\n.btn { min-height: 44px; padding: 0 20px; border: 0; border-radius: 10px; background: var(--studio-ink); color: var(--on-dark); font: 700 15px var(--sans); cursor: pointer; }\n.btn.gold { background: var(--reel-gold); color: var(--studio-ink); }\n.btn.ghost { background: transparent; color: var(--ink); border: 1px solid var(--hairline); }\n.btn.danger { background: var(--clay); color: #fff; }\n.btn.small { min-height: 36px; padding: 0 12px; font-size: 13px; }\n.btn[disabled] { opacity: 0.5; cursor: not-allowed; }\n@media (prefers-color-scheme: dark) { .btn { background: var(--on-dark); color: var(--studio-ink); } .btn.gold { background: var(--reel-gold); } .btn.danger { background: var(--clay); color: #fff; } }\n.row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }\n.row.split { justify-content: space-between; }\n.pkgs { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }\n.pkg { border: 2px solid var(--hairline); border-radius: 12px; padding: 12px; cursor: pointer; display: flex; flex-direction: column; gap: 4px; background: var(--raised); }\n.pkg input { position: absolute; opacity: 0; pointer-events: none; }\n.pkg:has(input:checked) { border-color: var(--reel-gold); background: var(--soft); }\n.pkg:has(input:focus-visible) { outline: 3px solid var(--reel-gold); outline-offset: 2px; }\n.pkg b { font: 700 16px var(--display); }\n.pkgdetail { background: var(--soft); border-radius: 10px; padding: 10px 12px; }\n.hp { position: absolute; left: -9999px; width: 1px; height: 1px; overflow: hidden; }\n.files { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }\n.files li { display: flex; justify-content: space-between; align-items: center; gap: 10px; border: 1px solid var(--hairline); border-radius: 10px; padding: 8px 12px; word-break: break-word; }\n.hook { border: 2px solid var(--hairline); border-radius: 12px; padding: 12px; display: flex; gap: 10px; align-items: flex-start; background: var(--raised); cursor: pointer; }\n.hook.sel, .hook:has(input:checked) { border-color: var(--reel-gold); background: var(--soft); }\n.hook.dim { opacity: 0.6; }\n.hook input { margin-top: 4px; width: 20px; height: 20px; flex: none; }\n.script { display: grid; grid-template-columns: 110px minmax(0, 1fr); gap: 8px 14px; border: 1px solid var(--hairline); border-radius: 12px; padding: 14px; }\n.script dt { font: 600 12px/20px var(--mono); color: var(--gold-text); text-transform: uppercase; }\n.script dd { margin: 0; white-space: pre-wrap; }\n.thread { display: flex; flex-direction: column; gap: 10px; max-height: 460px; overflow: auto; padding-right: 2px; }\n.msg { max-width: 92%; border-radius: 12px; padding: 10px 12px; background: var(--soft); white-space: pre-wrap; word-break: break-word; }\n.msg.client { align-self: flex-end; background: var(--studio-ink); color: var(--on-dark); }\n@media (prefers-color-scheme: dark) { .msg.client { background: #2A2F3A; } }\n.msg.system { align-self: center; background: transparent; border: 1px dashed var(--hairline); color: var(--muted); font-size: 13px; }\n.msg .meta { display: block; font-size: 11px; opacity: 0.7; margin-bottom: 2px; }\n.kv { display: grid; grid-template-columns: minmax(0, 38%) minmax(0, 1fr); gap: 6px 14px; }\n.kv dt { color: var(--muted); font-size: 13px; }\n.kv dd { margin: 0; white-space: pre-wrap; word-break: break-word; }\ndetails > summary { cursor: pointer; font: 700 15px var(--display); min-height: 44px; display: flex; align-items: center; }\n.foot { text-align: center; padding: 18px 16px 28px; color: var(--muted); font-size: 12px; }\n.list { display: flex; flex-direction: column; gap: 10px; }\n.item { background: var(--raised); border: 1px solid var(--hairline); border-radius: 12px; padding: 14px; display: flex; justify-content: space-between; gap: 10px; align-items: center; cursor: pointer; text-align: left; width: 100%; color: inherit; font: inherit; }\n.item:hover { border-color: var(--reel-gold); }\n.grid2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }\n.sr { position: absolute; left: -9999px; }\n@media (max-width: 560px) {\n  h1 { font-size: 26px; line-height: 32px; }\n  .steps { grid-template-columns: 1fr; }\n  .steps li { flex-direction: row; align-items: center; }\n  .pkgs, .grid2 { grid-template-columns: 1fr; }\n  .script { grid-template-columns: 1fr; }\n  .kv { grid-template-columns: 1fr; }\n}\n@media (prefers-reduced-motion: no-preference) { .btn, .item, .hook, .pkg { transition: border-color 0.15s, background 0.15s; } }\n.top .btn.ghost { color: var(--on-dark); border-color: #2E323C; }\na.btn { display: inline-flex; align-items: center; text-decoration: none; color: var(--ink); }\n.top a { color: var(--on-dark-muted); }\n';

// src/public/studio.html
var studio_default = '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<meta name="robots" content="noindex, nofollow">\n<meta name="referrer" content="same-origin">\n<meta name="theme-color" content="#14161C">\n<title>Studio | TAHA Studio Labs AI UGC</title>\n<link rel="stylesheet" href="/brief/app.css?v=1">\n</head>\n<body>\n<header class="top">\n  <div class="brand"><span class="brand-top">TAHA Studio Labs</span><span class="brand-sub">Share Your Brief studio</span></div>\n  <button type="button" class="btn small ghost hidden" id="signOut">Sign out</button>\n</header>\n<main id="app" class="wrap wide"><p class="muted">Loading...</p></main>\n<noscript><p class="wrap">JavaScript is needed for the studio.</p></noscript>\n<script src="/brief/studio.js?v=1"><\/script>\n</body>\n</html>\n';

// src/public/studio.js
var studio_default2 = `/* Share Your Brief studio (admin). Hidden from the public: no page links here, the page is
   noindex, and every call needs the admin session cookie from the emailed sign-in link.
   All text goes in through textContent, never innerHTML. */
(function () {
  "use strict";
  var API = "/api/brief";
  var app = document.getElementById("app");
  var signOut = document.getElementById("signOut");
  var D = null;
  var draftId = null;
  var banner = "";

  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null || v === false) return;
        if (k === "class") el.className = v;
        else if (k.indexOf("on") === 0) el.addEventListener(k.slice(2), v);
        else if (v === true) el.setAttribute(k, "");
        else el.setAttribute(k, v);
      });
    }
    for (var i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  function add(el, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach(function (x) { add(el, x); });
    else el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }
  function call(path, opts) {
    opts = opts || {};
    var headers = opts.headers || {};
    if (opts.json) { headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(opts.json); }
    return fetch(API + path, { method: opts.method || "GET", headers: headers, body: opts.body })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, status: r.status, data: d }; }); })
      .catch(function () { return { ok: false, status: 0, data: { message: "Could not reach the server." } }; });
  }
  function fmt(iso) { try { return new Date(iso).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); } catch (e) { return iso; } }
  function kb(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB"; }
  function copy(text, done) {
    var ok = function () { done("Copied"); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, function () { done("Copy failed"); });
    else { var t = h("textarea", { class: "sr" }); t.value = text; document.body.appendChild(t); t.select(); try { document.execCommand("copy"); ok(); } catch (e) { done("Copy failed"); } t.remove(); }
  }
  function note(kind, msg) { return h("div", { class: "callout" + (kind ? " " + kind : ""), role: "status" }, msg); }

  /* ------------------------------------------------ sign in */
  function showSignIn() {
    signOut.classList.add("hidden");
    clear(app);
    var email = h("input", { type: "email", id: "adminEmail", autocomplete: "email", placeholder: "hej@tahastudiolabs.com" });
    var out = h("p", { class: "small", role: "status", "aria-live": "polite" });
    app.appendChild(h("div", { class: "card" },
      h("h1", null, "Studio sign in"),
      h("p", { class: "muted" }, "Enter your studio email. If it can sign in, a one-time link arrives in your inbox."),
      h("label", { for: "adminEmail", class: "lab" }, "Email"), email,
      h("button", { class: "btn gold", type: "button", onclick: function () {
        call("/admin/request-link", { method: "POST", json: { email: email.value } }).then(function (r) { out.textContent = (r.data && r.data.message) || "Done."; });
      } }, "Email me a sign-in link"), out));
  }

  /* ------------------------------------------------ list */
  function showList() {
    D = null; draftId = null;
    signOut.classList.remove("hidden");
    history.replaceState(null, "", location.pathname);
    clear(app);
    app.appendChild(h("div", { class: "row split" }, h("div", null, h("div", { class: "kicker" }, "Share Your Brief"), h("h1", null, "Client projects")),
      h("button", { class: "btn small ghost", type: "button", onclick: showList }, "Refresh")));
    var list = h("div", { class: "list" }, h("p", { class: "muted" }, "Loading..."));
    app.appendChild(list);
    call("/admin/projects").then(function (r) {
      clear(list);
      if (r.status === 401) return showSignIn();
      var ps = (r.data && r.data.projects) || [];
      if (!ps.length) { list.appendChild(h("p", { class: "muted" }, "No briefs yet. They appear here the moment a client submits.")); return; }
      ps.forEach(function (p) {
        list.appendChild(h("button", { class: "item", type: "button", onclick: function () { location.hash = p.id; } },
          h("span", null, h("b", null, p.brand), h("br"), h("span", { class: "small muted" }, p.contactName + " \xB7 " + p.package + " \xB7 updated " + fmt(p.updatedAt))),
          h("span", { class: "row" }, p.needsYou ? h("span", { class: "chip clay" }, "Needs you") : null, h("span", { class: "chip" }, p.status.replace(/_/g, " ")))));
      });
    });
  }

  /* ------------------------------------------------ project */
  function openProject(id) {
    signOut.classList.remove("hidden");
    return call("/admin/projects/" + id).then(function (r) {
      if (r.status === 401) return showSignIn();
      if (!r.ok) { notice("Project not found."); return showList(); }
      D = r.data;
      renderProject();
    });
  }
  function notice(m) { banner = m; }
  function reload() { return openProject(D.project.id); }

  function renderProject() {
    var p = D.project;
    clear(app);
    document.title = p.brand + " | Studio";
    var copied = h("span", { class: "small muted", role: "status" });
    app.appendChild(h("div", { class: "row split" },
      h("button", { class: "btn small ghost", type: "button", onclick: function () { location.hash = ""; } }, "\u2190 All projects"),
      h("div", { class: "row" }, copied,
        h("button", { class: "btn small ghost", type: "button", onclick: function () { copy(p.clientLink, function (m) { copied.textContent = m; }); } }, "Copy client link"),
        h("button", { class: "btn small ghost", type: "button", onclick: function () {
          call("/admin/projects/" + p.id + "/reset-link", { method: "POST", json: {} }).then(function (r) { if (r.ok) { D.project.clientLink = r.data.clientLink; copied.textContent = "Old link disabled. New link ready to copy."; } });
        } }, "Reset link"))));
    app.appendChild(h("div", null, h("div", { class: "kicker" }, p.package.label + " package \xB7 " + p.email), h("h1", null, p.brand),
      h("div", { class: "row" }, h("span", { class: "chip gold" }, p.status.replace(/_/g, " ")), p.deliveryDate ? h("span", { class: "chip" }, "Wants delivery by " + p.deliveryDate) : null)));
    if (banner) { app.appendChild(note("", banner)); banner = ""; }
    app.appendChild(briefCard());
    if (["brief_received", "changes_requested", "script_review"].indexOf(p.status) >= 0) app.appendChild(editorCard());
    app.appendChild(productionCard());
    if (["approved", "in_production", "delivered"].indexOf(p.status) >= 0) app.appendChild(deliveryCard());
    app.appendChild(messagesCard());
    app.appendChild(dangerCard());
  }

  function briefCard() {
    var card = h("section", { class: "card" }, h("h2", null, "Brief"));
    card.appendChild(h("dl", { class: "kv" }, D.brief.map(function (r) { return [h("dt", null, r.label), h("dd", null, r.value)]; })));
    var assets = D.files.filter(function (f) { return f.area === "asset"; });
    card.appendChild(h("h3", null, "Client files (" + assets.length + ")"));
    card.appendChild(assets.length ? h("ul", { class: "files" }, assets.map(function (f) {
      return h("li", null, h("span", null, f.name + " (" + kb(f.size) + ")"), h("a", { class: "btn small ghost", href: API + "/admin/files/" + f.id, download: f.name }, "Download"));
    })) : h("p", { class: "muted" }, "None."));
    var out = h("span", { class: "small muted", role: "status" });
    card.appendChild(h("div", { class: "row" },
      h("button", { class: "btn small", type: "button", onclick: function () { copy(draftingKit(), function (m) { out.textContent = m + ". Paste it into Claude or ScriptForge."; }); } }, "Copy brief for drafting"), out));
    return card;
  }

  function draftingKit() {
    var rules = [
      "Write AI UGC hooks and a script for this client.",
      "Deliver: three hook options and one short script (15 to 45 seconds) based on the recommended hook.",
      "Script structure: Hook, Problem, Solution, Benefit, Call to action.",
      "Style: conversational, suited to short-form vertical video.",
      "Rules: no unsupported medical, financial, legal or exaggerated performance claims. Respect the required claims and restricted words below. Do not use em dashes anywhere.",
      "", "BRIEF", ""
    ];
    return rules.concat(D.brief.map(function (r) { return r.label + ": " + r.value; })).join("\\n");
  }

  /* ---- hooks and script editor ---- */
  function editorCard() {
    var p = D.project;
    var last = D.proposals.filter(function (x) { return x.status === "draft"; }).pop() || D.proposals[D.proposals.length - 1] || null;
    draftId = last && last.status === "draft" ? last.id : null;
    var hooks = [0, 1, 2].map(function (i) { return h("textarea", { "aria-label": "Hook option " + (i + 1), rows: "2" }); });
    var rec = h("select", { "aria-label": "Recommended hook" }, [1, 2, 3].map(function (n) { return h("option", { value: String(n) }, "Hook option " + n); }));
    var parts = ["hook", "problem", "solution", "benefit", "cta"];
    var names = { hook: "Hook", problem: "Problem", solution: "Solution", benefit: "Benefit", cta: "Call to action" };
    var sc = {};
    parts.forEach(function (k) { sc[k] = h("textarea", { "aria-label": names[k], rows: "2" }); });
    if (last) { last.hooks.forEach(function (t, i) { hooks[i].value = t; }); rec.value = String(last.recommended); parts.forEach(function (k) { sc[k].value = last.script[k]; }); }
    var out = h("div", { role: "status", "aria-live": "polite" });
    var notify = h("input", { type: "checkbox" });
    var ack = false;

    function payload() {
      var script = {};
      parts.forEach(function (k) { script[k] = sc[k].value; });
      return { hooks: hooks.map(function (t) { return t.value; }), recommended: rec.value, script: script };
    }
    function show(kind, msg, warnings) {
      clear(out);
      out.appendChild(note(kind, msg + (warnings && warnings.length ? " Check these phrases: " + warnings.join(", ") + "." : "")));
    }
    function save() {
      var req = draftId
        ? call("/admin/proposals/" + draftId, { method: "PUT", json: payload() })
        : call("/admin/projects/" + p.id + "/proposals", { method: "POST", json: payload() });
      return req.then(function (r) {
        if (!r.ok) { show("err", r.data.message || "Could not save."); return false; }
        if (r.data.id) draftId = r.data.id;
        show("ok", "Draft saved.", r.data.warnings);
        return true;
      });
    }
    var latestChange = D.messages.filter(function (m) { return m.kind === "changes_request"; }).pop();
    var warnBox = h("div", null);
    var pubBtn = h("button", { class: "btn gold", type: "button", onclick: function () {
      save().then(function (ok) {
        if (!ok) return;
        call("/admin/proposals/" + draftId + "/publish", { method: "POST", json: { notify: notify.checked, ackWarnings: ack } }).then(function (r) {
          if (r.status === 409 && r.data.error === "warnings") {
            clear(warnBox);
            warnBox.appendChild(note("err", r.data.message));
            warnBox.appendChild(h("button", { class: "btn small ghost", type: "button", onclick: function () { ack = true; pubBtn.click(); } }, "Publish anyway"));
            return;
          }
          if (!r.ok) { show("err", r.data.message || "Could not publish."); return; }
          notice("Published to the client's dashboard.");
          reload();
        });
      });
    } }, "Publish to client");

    var card = h("section", { class: "card" }, h("h2", null, p.status === "script_review" ? "Hooks and script (published, you can replace it)" : "Hooks and script"));
    if (latestChange) card.appendChild(note("", "Client change request: " + latestChange.body));
    card.appendChild(h("p", { class: "small muted" }, D.intro));
    [0, 1, 2].forEach(function (i) { card.appendChild(h("div", { class: "field" }, h("span", { class: "lab" }, "Hook option " + (i + 1)), hooks[i])); });
    card.appendChild(h("div", { class: "field" }, h("span", { class: "lab" }, "Recommended hook for the script"), rec));
    parts.forEach(function (k) { card.appendChild(h("div", { class: "field" }, h("span", { class: "lab" }, "Script: " + names[k]), sc[k])); });
    card.appendChild(h("p", { class: "small muted" }, "Dashes are cleaned automatically. Words like guarantee, cure or 100% are flagged before you publish."));
    card.appendChild(h("label", { class: "row" }, notify, h("span", null, "Notify client by email (a link only, no content)")));
    card.appendChild(h("div", { class: "row" }, h("button", { class: "btn ghost", type: "button", onclick: save }, "Save draft"), pubBtn));
    card.appendChild(warnBox);
    card.appendChild(out);
    var versions = D.proposals.filter(function (x) { return x.status !== "draft"; });
    if (versions.length) card.appendChild(h("p", { class: "small muted" }, "Versions sent so far: " + versions.map(function (v) { return "v" + v.version + " (" + v.status + ")"; }).join(", ")));
    return card;
  }

  /* ---- production ---- */
  function productionCard() {
    var p = D.project;
    var card = h("section", { class: "card" }, h("h2", null, "Approval and production"));
    var rows = [
      ["Approval", p.approvedAt ? "Hook " + p.approvedHook + " and the script approved on " + fmt(p.approvedAt) : "Not yet approved"],
      ["Concept change rounds", p.rounds.used + " used of " + p.rounds.allowed],
      ["Production", p.productionStartedAt ? "Started " + fmt(p.productionStartedAt) : p.productionLocked ? "Locked until the client approves one hook and one script" : "Ready to start"]
    ];
    card.appendChild(h("dl", { class: "kv" }, rows.map(function (r) { return [h("dt", null, r[0]), h("dd", null, r[1])]; })));
    var notify = h("input", { type: "checkbox" });
    var out = h("span", { class: "small muted", role: "status" });
    var start = h("button", { class: "btn gold", type: "button", disabled: p.status !== "approved", onclick: function () {
      call("/admin/projects/" + p.id + "/start-production", { method: "POST", json: { notify: notify.checked } }).then(function (r) { if (r.ok) { notice("Production started."); reload(); } else out.textContent = r.data.message; });
    } }, "Start production");
    var extra = h("button", { class: "btn small ghost", type: "button", disabled: ["brief_received", "changes_requested", "script_review"].indexOf(p.status) < 0, onclick: function () {
      call("/admin/projects/" + p.id + "/extra-round", { method: "POST", json: {} }).then(function (r) { if (r.ok) { notice("Extra concept round added."); reload(); } else out.textContent = r.data.message; });
    } }, "Add an extra concept round");
    card.appendChild(h("div", { class: "row" }, start, extra, h("label", { class: "row small" }, notify, "Notify client")));
    card.appendChild(out);
    return card;
  }

  /* ---- delivery ---- */
  function deliveryCard() {
    var p = D.project;
    var card = h("section", { class: "card" }, h("h2", null, "Delivery"));
    var files = D.files.filter(function (f) { return f.area === "delivery"; });
    var status = h("div", { role: "status", "aria-live": "polite" });
    card.appendChild(files.length ? h("ul", { class: "files" }, files.map(function (f) {
      return h("li", null, h("span", null, f.name + " (" + kb(f.size) + ")"), h("button", { class: "btn small ghost", type: "button", onclick: function () {
        call("/admin/files/" + f.id, { method: "DELETE" }).then(function () { reload(); });
      } }, "Remove"));
    })) : h("p", { class: "muted" }, "No delivery files yet."));
    if (p.status === "delivered") {
      card.appendChild(h("dl", { class: "kv" },
        h("dt", null, "Delivered"), h("dd", null, fmt(p.deliveredAt)), h("dt", null, "Videos"), h("dd", null, String(p.videos)),
        h("dt", null, "Revision window"), h("dd", null, "Until " + fmt(p.revisionUntil) + (p.revisionOpen ? " (open)" : " (closed)")),
        h("dt", null, "Revision rounds used"), h("dd", null, p.revisionsUsed + " of " + p.package.revisionRounds)));
      card.appendChild(h("button", { class: "btn small ghost", type: "button", onclick: function () {
        call("/admin/projects/" + p.id + "/extend-revisions", { method: "POST", json: { days: 3 } }).then(function (r) { if (r.ok) { notice("Revision window extended by 3 days."); reload(); } });
      } }, "Extend revision window by 3 days"));
      return card;
    }
    if (p.status !== "in_production") { card.appendChild(h("p", { class: "muted" }, "Start production first. Delivery opens once the project is in production.")); return card; }
    var input = h("input", { type: "file", multiple: true, "aria-label": "Upload delivery files" });
    input.addEventListener("change", function () {
      var list = Array.prototype.slice.call(input.files);
      var chain = Promise.resolve();
      list.forEach(function (f, i) {
        chain = chain.then(function () {
          status.textContent = "Uploading " + (i + 1) + " of " + list.length + ": " + f.name;
          return call("/admin/projects/" + p.id + "/files?name=" + encodeURIComponent(f.name), { method: "POST", body: f, headers: { "Content-Type": "application/octet-stream" } }).then(function (r) {
            if (!r.ok) status.textContent = f.name + ": " + (r.data.message || "upload failed");
          });
        });
      });
      chain.then(function () { reload(); });
    });
    var videos = h("input", { type: "number", min: "1", max: "50", value: "1", "aria-label": "Number of videos delivered" });
    var link = h("input", { type: "text", placeholder: "https://... (optional, for files over 95 MB)", "aria-label": "Delivery link" });
    var nt = h("textarea", { rows: "2", placeholder: "Optional note for the client", "aria-label": "Delivery note" });
    var notify = h("input", { type: "checkbox" });
    card.appendChild(h("div", { class: "field" }, h("span", { class: "lab" }, "Upload final videos, captions and usage details (95 MB each)"), input));
    card.appendChild(h("div", { class: "grid2" },
      h("div", { class: "field" }, h("span", { class: "lab" }, "Videos delivered"), videos),
      h("div", { class: "field" }, h("span", { class: "lab" }, "External delivery link"), link)));
    card.appendChild(nt);
    card.appendChild(h("label", { class: "row" }, notify, h("span", null, "Notify client by email (a link only)")));
    card.appendChild(h("button", { class: "btn gold", type: "button", onclick: function () {
      call("/admin/projects/" + p.id + "/deliver", { method: "POST", json: { videos: videos.value, link: link.value, note: nt.value, notify: notify.checked } }).then(function (r) {
        if (r.ok) { notice("Delivered. The 7 day revision window is open."); reload(); } else status.textContent = r.data.message || "Could not deliver.";
      });
    } }, "Deliver to client"));
    card.appendChild(status);
    return card;
  }

  /* ---- messages ---- */
  function messagesCard() {
    var thread = h("div", { class: "thread", role: "log" });
    D.messages.forEach(function (m) {
      var who = m.author === "client" ? D.project.contactName : m.author === "admin" ? "You" : "System";
      thread.appendChild(h("div", { class: "msg " + (m.author === "client" ? "admin" : m.author === "admin" ? "client" : "system") }, h("span", { class: "meta" }, who + " \xB7 " + fmt(m.at) + " \xB7 " + m.kind.replace(/_/g, " ")), m.body));
    });
    var ta = h("textarea", { rows: "3", "aria-label": "Reply to the client", placeholder: "Reply inside the dashboard" });
    var notify = h("input", { type: "checkbox" });
    var card = h("section", { class: "card" }, h("h2", null, "Messages"), thread, ta,
      h("label", { class: "row" }, notify, h("span", null, "Notify client by email (a link only)")),
      h("button", { class: "btn", type: "button", onclick: function () {
        if (!ta.value.trim()) return;
        call("/admin/projects/" + D.project.id + "/messages", { method: "POST", json: { text: ta.value, notify: notify.checked } }).then(function (r) { if (r.ok) reload(); });
      } }, "Send reply"));
    setTimeout(function () { thread.scrollTop = thread.scrollHeight; }, 0);
    return card;
  }

  /* ---- danger ---- */
  function dangerCard() {
    var p = D.project;
    var confirmInput = h("input", { type: "text", placeholder: "Type the brand name to enable", "aria-label": "Type the brand name to confirm erasing" });
    var del = h("button", { class: "btn danger", type: "button", disabled: true, onclick: function () {
      call("/admin/projects/" + p.id, { method: "DELETE" }).then(function (r) { if (r.ok) { location.hash = ""; } });
    } }, "Erase project and files");
    confirmInput.addEventListener("input", function () { del.disabled = confirmInput.value.trim() !== p.brand; });
    return h("section", { class: "card" }, h("h2", null, "Close or erase"),
      h("div", { class: "row" }, h("button", { class: "btn ghost", type: "button", disabled: p.status === "closed", onclick: function () {
        call("/admin/projects/" + p.id + "/close", { method: "POST", json: {} }).then(function () { reload(); });
      } }, "Close project")),
      h("p", { class: "small muted" }, "Erasing removes the brief, messages and every file for good. Use it when the retention period ends or a client asks."),
      confirmInput, del);
  }

  /* ------------------------------------------------ boot */
  function route() {
    var id = (location.hash || "").replace("#", "");
    if (/^pj_[a-z0-9]+$/.test(id)) openProject(id); else showList();
  }
  signOut.addEventListener("click", function () { call("/admin/logout", { method: "POST", json: {} }).then(showSignIn); });
  window.addEventListener("hashchange", route);
  call("/admin/me").then(function (r) { if (r.ok) route(); else showSignIn(); });
})();
`;

// src/public/verify.html
var verify_default = '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<meta name="robots" content="noindex, nofollow">\n<title>Studio sign in | TAHA Studio Labs</title>\n<link rel="stylesheet" href="/brief/app.css?v=1">\n</head>\n<body>\n<header class="top"><div class="brand"><span class="brand-top">TAHA Studio Labs</span><span class="brand-sub">Studio</span></div></header>\n<main class="wrap">\n  <div class="card">\n    <h1>Confirm sign in</h1>\n    <p class="muted" id="msg">Press the button to finish signing in. This extra step stops email scanners from using up your link.</p>\n    <button class="btn gold" id="go" type="button">Sign in to the studio</button>\n  </div>\n</main>\n<script src="/brief/studio/verify.js"><\/script>\n</body>\n</html>\n';

// src/public/verify.js
var verify_default2 = '(function () {\n  "use strict";\n  var m = /[#&]t=([A-Za-z0-9_-]+)/.exec(location.hash);\n  var btn = document.getElementById("go");\n  var msg = document.getElementById("msg");\n  if (!m) { msg.textContent = "This link is incomplete. Request a new one from the studio page."; btn.classList.add("hidden"); return; }\n  var token = m[1];\n  history.replaceState(null, "", location.pathname);\n  btn.addEventListener("click", function () {\n    btn.disabled = true;\n    fetch("/api/brief/admin/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: token }) })\n      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })\n      .then(function (res) {\n        if (res.ok) { location.replace("/brief/studio"); return; }\n        msg.textContent = (res.data && res.data.message) || "This link did not work. Request a new one.";\n        btn.classList.add("hidden");\n      })\n      .catch(function () { msg.textContent = "Could not reach the server. Try again."; btn.disabled = false; });\n  });\n})();\n';

// src/index.js
var BASE = "/api/brief";
var PAGE_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";
function page(body) {
  return new Response(body, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": PAGE_CSP,
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "same-origin",
      "X-Robots-Tag": "noindex, nofollow"
    }
  });
}
function asset(body, type) {
  return new Response(body, {
    headers: { "Content-Type": type, "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex" }
  });
}
function sameOrigin(request, cfg) {
  const origin = request.headers.get("Origin");
  if (origin === cfg.siteOrigin) return true;
  return (!origin || origin === "null") && request.headers.get("Sec-Fetch-Site") === "same-origin";
}
var NEUTRAL_ADMIN = "If that address can sign in, a link is on its way. Check your inbox.";
function servePage(path) {
  switch (path) {
    case "/brief/app.js":
      return asset(brief_default2, "text/javascript; charset=utf-8");
    case "/brief/app.css":
      return asset(brief_default3, "text/css; charset=utf-8");
    case "/brief/studio.js":
      return asset(studio_default2, "text/javascript; charset=utf-8");
    case "/brief/studio/verify.js":
      return asset(verify_default2, "text/javascript; charset=utf-8");
    case "/brief/studio/verify":
      return page(verify_default);
    case "/brief/studio":
      return page(studio_default);
    default:
      return page(brief_default);
  }
}
async function handle(request, env, ctx) {
  const cfg = getConfig(env);
  const url = new URL(request.url);
  const method = request.method;
  if (url.pathname === "/brief" || url.pathname.startsWith("/brief/")) {
    if (method !== "GET" && method !== "HEAD") return json({ error: "not_found" }, 404);
    if (url.pathname === "/brief") return Response.redirect(cfg.siteOrigin + "/brief/" + url.hash, 301);
    return servePage(url.pathname.replace(/\/+$/, "") || "/brief");
  }
  if (!url.pathname.startsWith(BASE + "/")) return json({ error: "not_found" }, 404);
  const path = url.pathname.slice(BASE.length);
  if (method === "GET" && path === "/health") return json({ ok: true });
  if (method === "GET" && path === "/meta") return meta(cfg);
  if (path.startsWith("/_dev/")) {
    if (cfg.environment !== "development") return json({ error: "not_found" }, 404);
    await ensureSchema(env);
    if (path === "/_dev/mails") return json(devMailList());
    if (path === "/_dev/backdate" && method === "POST") {
      const b = await readJson(request);
      const col = ["revision_until", "created_at"].includes(b.column) ? b.column : null;
      if (!col) return json({ error: "bad" }, 400);
      await env.DB.prepare("UPDATE projects SET " + col + " = ? WHERE id = ?").bind(b.value, b.id).run();
      return json({ ok: true });
    }
    if (path === "/_dev/sweep" && method === "POST") {
      await sweepDrafts(env, cfg, ctx);
      return json({ ok: true });
    }
    return json({ error: "not_found" }, 404);
  }
  await ensureSchema(env);
  const changing = method === "POST" || method === "PUT" || method === "DELETE";
  if (changing && !sameOrigin(request, cfg)) return json({ error: "bad_origin", message: "Request refused." }, 403);
  if (method === "POST" && path === "/submit") return submitBrief(request, env, cfg);
  if (method === "POST" && path === "/files") return uploadAsset(request, env, cfg, url);
  if (method === "POST" && path === "/finalize") return finalize(request, env, cfg, ctx);
  if (method === "GET" && path === "/project") return getProject(request, env, cfg);
  if (method === "POST" && path === "/approve") return approve(request, env, cfg, ctx);
  if (method === "POST" && path === "/changes") return requestChanges(request, env, cfg, ctx);
  if (method === "POST" && path === "/message") return postClientMessage(request, env, cfg, ctx);
  if (method === "POST" && path === "/revision") return requestRevision(request, env, cfg, ctx);
  if (method === "POST" && path === "/request-link") return requestLink(request, env, cfg, ctx);
  const cf = path.match(/^\/files\/(f_[a-z0-9]{4,32})$/);
  if (method === "GET" && cf) return downloadClientFile(request, env, cfg, cf[1]);
  if (method === "POST" && path === "/admin/request-link") {
    const b = await readJson(request, 2 * 1024);
    const email = b ? normEmail(b.email) : "";
    if (!validEmail(email)) return json({ error: "email", message: "Enter a valid email address." }, 400);
    if (!await allow(env, "admin-ip:" + ipOf(request), 10) || !await allow(env, "admin-email:" + email, 5))
      return json({ error: "rate_limited", message: "Too many attempts. Please wait a while and try again." }, 429);
    const run = isAdminEmail(cfg, email) ? issueAdminLink(env, cfg, email) : Promise.resolve();
    ctx.waitUntil(run);
    return json({ ok: true, message: NEUTRAL_ADMIN });
  }
  if (method === "POST" && path === "/admin/verify") {
    const b = await readJson(request, 2 * 1024);
    const row = b && typeof b.token === "string" ? await consumeToken(env, b.token) : null;
    if (!row) return json({ error: "bad_link", message: "This link is invalid, already used or expired. Request a new one." }, 400);
    const token = await createSession(env, cfg, row.email);
    return withCookies(json({ ok: true }), [adminCookie(cfg, token)]);
  }
  if (method === "POST" && path === "/admin/logout") {
    await destroySession(env, request);
    return withCookies(json({ ok: true }), [clearAdminCookie()]);
  }
  if (path === "/admin/me" && method === "GET") {
    const email = await getAdmin(request, env, cfg);
    return email ? json({ email }) : json({ error: "unauthorized" }, 401);
  }
  if (path.startsWith("/admin/")) {
    const email = await getAdmin(request, env, cfg);
    if (!email) return json({ error: "unauthorized", message: "Please sign in." }, 401);
    if (path === "/admin/projects" && method === "GET") return listProjects(env);
    const pj = path.match(/^\/admin\/projects\/(pj_[a-z0-9]{4,32})(?:\/([a-z-]+))?$/);
    if (pj) {
      const id = pj[1];
      const sub = pj[2] || "";
      if (!sub && method === "GET") return getProjectAdmin(env, cfg, id);
      if (!sub && method === "DELETE") return eraseProject(env, id);
      if (method === "POST") {
        if (sub === "proposals") return createProposal(request, env, id);
        if (sub === "start-production") return startProduction(env, cfg, ctx, id, await readJson(request, 1024) || {});
        if (sub === "extra-round") return grantExtraRound(env, id);
        if (sub === "messages") return adminMessage(request, env, cfg, ctx, id);
        if (sub === "files") return uploadDeliveryFile(request, env, id, url);
        if (sub === "deliver") return deliver(request, env, cfg, ctx, id);
        if (sub === "extend-revisions") return extendRevisions(request, env, id);
        if (sub === "reset-link") return resetLink(env, cfg, id);
        if (sub === "close") return closeProject(env, id);
      }
    }
    const pp = path.match(/^\/admin\/proposals\/(pp_[a-z0-9]{4,32})(\/publish)?$/);
    if (pp) {
      if (pp[2] && method === "POST") return publishProposal(request, env, cfg, ctx, pp[1]);
      if (!pp[2] && method === "PUT") return updateProposal(request, env, pp[1]);
    }
    const af = path.match(/^\/admin\/files\/(f_[a-z0-9]{4,32})$/);
    if (af && method === "GET") return downloadAdminFile(env, af[1]);
    if (af && method === "DELETE") return deleteFile(env, af[1]);
  }
  return json({ error: "not_found", message: "Not found." }, 404);
}
var index_default = {
  async fetch(request, env, ctx) {
    try {
      return await handle(request, env, ctx);
    } catch (e) {
      console.error("unhandled: " + (e && e.message ? e.message : e));
      return json({ error: "server", message: "Something went wrong on our side. Please try again." }, 500);
    }
  },
  async scheduled(event, env, ctx) {
    const cfg = getConfig(env);
    await ensureSchema(env);
    await cleanup(env);
    await sweepDrafts(env, cfg, ctx);
  }
};
export {
  index_default as default
};
