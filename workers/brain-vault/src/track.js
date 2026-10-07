/* V2 phase G2b: cookieless counting and enquiries from the landing pages (spec 9.4, 9.5).

   POST /api/vault/pub/event        {p, t, b, c, u, w} sent by /go/t.js with sendBeacon.
                                    Open to other origins (no cookies are read or set), so a
                                    downloaded copy of a page can count visits too.
   POST /api/vault/pub/lead/:pageId the enquiry form (form post or JSON). From the hosted page,
                                    or from a downloaded copy with that page's token.

   What is stored per event: page, link code, UTM fields, type, button, hour, phone or desktop,
   country. Unique visitors use a hash of IP and browser with a salt that changes and is
   deleted every day; the IP address itself is never stored. Known bots and Harry's own
   signed-in visits are left out. */
import { getAuth } from "./auth.js";
import { composeEnquiryEmail, composeEnquiryNotice, sendMail } from "./mail.js";
import { escapeHtml, json, newId, nowIso, randomToken, sha256hex } from "./util.js";

const EVENT_TYPES = ["view", "click", "form", "scan", "link"];
const BUTTONS = ["call", "whatsapp", "booking", "directions", "order", "form", "other"];
const SOURCES = ["instagram", "facebook", "tiktok", "linkedin", "google", "email", "print", "video", "bio", "share", "download"];
const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegrambot|discordbot|linkedinbot|embedly|quora link|pinterest|vkshare|headless|lighthouse|pagespeed|curl|wget|python-requests|httpclient|okhttp|go-http/i;
const MAX_EVENTS_PER_VISITOR_DAY = 120;
const LEADS_PER_IP_HOUR = 5;

export function isBot(ua) {
  return !ua || BOT.test(ua);
}

export function deviceOf(ua, width) {
  if (/mobile|android|iphone|ipod/i.test(ua || "")) return "phone";
  if (/ipad|tablet/i.test(ua || "")) return "tablet";
  if (width && width < 700) return "phone";
  return "desktop";
}

export function channelOf(link, utm) {
  if (link && link.channel) return link.channel;
  const s = String((utm && utm.utm_source) || "").toLowerCase();
  if (s === "ig") return "instagram";
  if (s === "fb") return "facebook";
  if (SOURCES.includes(s)) return s;
  return s ? "other" : "direct";
}

async function saltFor(env, day) {
  const r = await env.DB.prepare("SELECT salt FROM salts WHERE day = ?").bind(day).first();
  if (r) return r.salt;
  const salt = randomToken(24);
  await env.DB.prepare("INSERT OR IGNORE INTO salts (day, salt) VALUES (?, ?)").bind(day, salt).run();
  const again = await env.DB.prepare("SELECT salt FROM salts WHERE day = ?").bind(day).first();
  return again.salt;
}

async function isAdmin(request, env, cfg) {
  try {
    const a = await getAuth(request, env, cfg);
    return !!a && a.role === "admin";
  } catch (e) {
    return false;
  }
}

/* Records one event and its daily totals. Returns false when it was not counted. */
export async function recordEvent(env, request, { pageId, clientId, type, button, code, utm, width }) {
  const ua = request.headers.get("User-Agent") || "";
  if (isBot(ua)) return false;
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const salt = await saltFor(env, day);
  const ip = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "local";
  const visitor = (await sha256hex(salt + "|" + ip + "|" + ua + "|" + pageId)).slice(0, 32);
  const seen = await env.DB.prepare("SELECT COUNT(*) AS n FROM events WHERE page_id = ? AND day = ? AND visitor = ?").bind(pageId, day, visitor).first();
  if (seen.n >= MAX_EVENTS_PER_VISITOR_DAY) return false;
  let link = null;
  if (code) link = await env.DB.prepare("SELECT channel, medium FROM links WHERE code = ? AND page_id = ?").bind(code, pageId).first();
  const channel = channelOf(link, utm);
  const u = utm || {};
  const cut = (v) => (typeof v === "string" ? v.slice(0, 80) : null);
  const country = (request.cf && request.cf.country) || request.headers.get("CF-IPCountry") || null;
  const statType = type === "click" ? "click_" + (BUTTONS.includes(button) ? button : "other") : type;
  const stmts = [
    env.DB.prepare("INSERT INTO events (client_id, page_id, link_code, type, button, channel, utm_source, utm_medium, utm_campaign, utm_content, device, country, visitor, day, hour, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(clientId, pageId, link ? code : null, type, type === "click" ? statType.slice(6) : null, channel, cut(u.utm_source), cut(u.utm_medium), cut(u.utm_campaign), cut(u.utm_content), deviceOf(ua, width), country ? String(country).slice(0, 2) : null, visitor, day, now.getUTCHours(), now.toISOString()),
    env.DB.prepare("INSERT INTO daily_stats (client_id, page_id, day, channel, type, n) VALUES (?, ?, ?, ?, ?, 1) ON CONFLICT(page_id, day, channel, type) DO UPDATE SET n = n + 1").bind(clientId, pageId, day, channel, statType)
  ];
  if (seen.n === 0 && (type === "view" || type === "scan" || type === "link")) {
    stmts.push(env.DB.prepare("INSERT INTO daily_stats (client_id, page_id, day, channel, type, n) VALUES (?, ?, ?, ?, 'unique', 1) ON CONFLICT(page_id, day, channel, type) DO UPDATE SET n = n + 1").bind(clientId, pageId, day, channel));
  }
  await env.DB.batch(stmts);
  return true;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400"
};

export function corsPreflight() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function pubEvent(request, env, cfg) {
  const done = () => new Response(null, { status: 204, headers: Object.assign({ "Cache-Control": "no-store" }, CORS) });
  const len = parseInt(request.headers.get("Content-Length") || "0", 10);
  if (len > 2048) return done();
  let b = null;
  try {
    const text = await request.text();
    if (text.length <= 2048) b = JSON.parse(text);
  } catch (e) {}
  if (!b || typeof b !== "object") return done();
  const pageId = String(b.p || "");
  const type = String(b.t || "");
  if (!/^pg_[a-z0-9]{4,32}$/.test(pageId) || !["view", "click"].includes(type)) return done();
  const p = await env.DB.prepare("SELECT p.client_id, p.state, c.left_at FROM pages p JOIN clients c ON c.id = p.client_id WHERE p.id = ?").bind(pageId).first();
  if (!p || p.state !== "published" || p.left_at) return done();
  if (await isAdmin(request, env, cfg)) return done();
  const u = {};
  if (b.u && typeof b.u === "object") ["utm_source", "utm_medium", "utm_campaign", "utm_content"].forEach((k) => { if (typeof b.u[k] === "string") u[k] = b.u[k].slice(0, 80); });
  const code = typeof b.c === "string" && /^[a-z0-9]{4,12}$/.test(b.c) ? b.c : null;
  const button = BUTTONS.includes(b.b) ? b.b : "other";
  await recordEvent(env, request, { pageId, clientId: p.client_id, type, button, code, utm: u, width: Number(b.w) || 0 });
  return done();
}

/* ---------- enquiries ---------- */

const LM = {
  sv: {
    thanks: "Tack! Vi har fått din förfrågan och hör av oss snart.",
    back: "Tillbaka till sidan",
    missing: "Skriv ditt namn och ett telefonnummer eller en e-postadress.",
    tooMany: "För många försök. Vänta en stund och försök igen.",
    closed: "Formuläret är inte öppet just nu.",
    refused: "Förfrågan kunde inte skickas."
  },
  en: {
    thanks: "Thank you! We have your enquiry and will be in touch soon.",
    back: "Back to the page",
    missing: "Enter your name and a phone number or an email address.",
    tooMany: "Too many attempts. Please wait a while and try again.",
    closed: "The form is not open right now.",
    refused: "The enquiry could not be sent."
  },
  /* Markets step 2: French and Spanish pages (the Pidgin pages use English). */
  fr: {
    thanks: "Merci ! Nous avons bien reçu votre demande et nous vous répondrons bientôt.",
    back: "Retour à la page",
    missing: "Indiquez votre nom et un numéro de téléphone ou une adresse e-mail.",
    tooMany: "Trop de tentatives. Patientez un moment et réessayez.",
    closed: "Le formulaire n'est pas ouvert pour le moment.",
    refused: "La demande n'a pas pu être envoyée."
  },
  es: {
    thanks: "¡Gracias! Hemos recibido tu consulta y te responderemos pronto.",
    back: "Volver a la página",
    missing: "Escribe tu nombre y un teléfono o un correo electrónico.",
    tooMany: "Demasiados intentos. Espera un momento y vuelve a intentarlo.",
    closed: "El formulario no está abierto ahora mismo.",
    refused: "No se pudo enviar la consulta."
  }
};

function leadReply(request, page, status, key, backUrl) {
  const l = page && LM[page.language] ? page.language : "sv";
  const text = LM[l][key];
  const wantsJson = /application\/json/i.test(request.headers.get("Accept") || "") || /application\/json/i.test(request.headers.get("Content-Type") || "");
  if (wantsJson) return json({ ok: status < 300, error: status < 300 ? undefined : key, message: { sv: LM.sv[key], en: LM.en[key] } }, status, CORS);
  const back = backUrl ? '<p><a href="' + escapeHtml(backUrl) + '">' + escapeHtml(LM[l].back) + "</a></p>" : "";
  return new Response(
    '<!doctype html><html lang="' + l + '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>' + escapeHtml(text) + "</title>" +
    "<style>body{font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;background:#f6f4ef;color:#1d1d1b}main{max-width:440px;padding:32px;text-align:center}p{font-size:18px;line-height:1.5}a{color:inherit}</style></head><body><main><p>" +
    escapeHtml(text) + "</p>" + back + "</main></body></html>",
    {
      status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'",
        "X-Content-Type-Options": "nosniff"
      }
    }
  );
}

async function readLeadBody(request) {
  const len = parseInt(request.headers.get("Content-Length") || "0", 10);
  if (len > 8192) return null;
  const ct = request.headers.get("Content-Type") || "";
  const text = await request.text();
  if (text.length > 8192) return null;
  try {
    if (/application\/json/i.test(ct)) return JSON.parse(text);
    const f = new URLSearchParams(text);
    const o = {};
    for (const [k, v] of f) o[k] = v;
    return o;
  } catch (e) {
    return null;
  }
}

const clean = (v, max) => (typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, max) : "");

export async function pubLead(request, env, cfg, ctx, pageId) {
  const p = /^pg_[a-z0-9]{4,32}$/.test(pageId)
    ? await env.DB.prepare("SELECT p.*, c.left_at, c.name AS client_name, c.email AS client_email, c.language AS client_language FROM pages p JOIN clients c ON c.id = p.client_id WHERE p.id = ?").bind(pageId).first()
    : null;
  const pageUrl = p ? cfg.siteOrigin + "/go/" + p.client_slug + "/" + p.slug : "";
  if (!p || p.state !== "published" || p.left_at || !p.form_on) return leadReply(request, p, 403, "closed", pageUrl);
  const b = await readLeadBody(request);
  if (!b) return leadReply(request, p, 400, "refused", pageUrl);
  /* A downloaded copy of the page posts from another site: it must carry this page's token. */
  const origin = request.headers.get("Origin");
  const sameSite = origin === cfg.siteOrigin || ((!origin || origin === "null") && request.headers.get("Sec-Fetch-Site") === "same-origin");
  if (!sameSite && b.token !== p.token) return leadReply(request, p, 403, "refused", null);
  const backUrl = sameSite ? pageUrl : null;
  /* Honeypot: people never see this field, so anything in it is a robot. */
  if (clean(b.website, 200)) return leadReply(request, p, 400, "refused", backUrl);
  const ip = request.headers.get("CF-Connecting-IP") || "local";
  const bucket = "l:" + (await sha256hex("lead-ip:" + ip));
  const since = Date.now() - 3600 * 1000;
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM rate_events WHERE bucket = ? AND at > ?").bind(bucket, since).first();
  if (n.n >= LEADS_PER_IP_HOUR) return leadReply(request, p, 429, "tooMany", backUrl);
  await env.DB.prepare("INSERT INTO rate_events (bucket, at) VALUES (?, ?)").bind(bucket, Date.now()).run();
  const name = clean(b.name, 120);
  const phone = clean(b.phone, 40).replace(/[^\d+ ()-]/g, "");
  const email = clean(b.email, 200);
  const message = clean(b.message, 2000);
  const emailOk = !email || /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/.test(email);
  if (!name || (!phone && !email) || !emailOk || (phone && phone.replace(/\D/g, "").length < 6)) return leadReply(request, p, 400, "missing", backUrl);
  const code = typeof b.c === "string" && /^[a-z0-9]{4,12}$/.test(b.c) ? b.c : null;
  const link = code ? await env.DB.prepare("SELECT channel FROM links WHERE code = ? AND page_id = ?").bind(code, p.id).first() : null;
  const channel = (link && link.channel) || (sameSite ? channelOf(null, { utm_source: clean(b.src, 40) }) : "download");
  const id = newId("ld", 14);
  await env.DB.prepare("INSERT INTO leads (id, client_id, page_id, campaign_id, name, phone, email, message, future_offers, notice_version, channel, state, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?)")
    .bind(id, p.client_id, p.id, p.campaign_id, name, phone || null, email || null, message || null, b.offers === "1" || b.offers === true || b.offers === "on" ? 1 : 0, p.notice_version, channel, nowIso()).run();
  const day = new Date().toISOString().slice(0, 10);
  await env.DB.prepare("INSERT INTO daily_stats (client_id, page_id, day, channel, type, n) VALUES (?, ?, ?, ?, 'form', 1) ON CONFLICT(page_id, day, channel, type) DO UPDATE SET n = n + 1").bind(p.client_id, p.id, day, channel).run();
  const portal = cfg.siteOrigin + cfg.clientHome + "#enquiries";
  ctx.waitUntil(sendMail(cfg, env, { to: p.client_email, ...composeEnquiryEmail(cfg, { name: p.client_name, language: p.client_language, link: portal }) }).catch((e) => console.error("enquiry email failed: " + e.message)));
  ctx.waitUntil(sendMail(cfg, env, { to: cfg.tahaEmail, ...composeEnquiryNotice(cfg, { company: p.client_name, link: cfg.growthPanelUrl }) }).catch((e) => console.error("enquiry notice failed: " + e.message)));
  if (sameSite && !/application\/json/i.test((request.headers.get("Accept") || "") + (request.headers.get("Content-Type") || ""))) {
    return new Response(null, { status: 303, headers: { Location: pageUrl + "#sent", "Cache-Control": "no-store" } });
  }
  return leadReply(request, p, 200, "thanks", backUrl);
}
