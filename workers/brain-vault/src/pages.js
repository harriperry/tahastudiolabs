/* V2 phase G2b: hosted landing pages (spec 9.2, 9.3, 9.6).

   The page is built in ScriptForge, in Harry's browser, from landing.template.html, and sent
   here as finished HTML. The Worker only stores it, serves it and adds the counting snippet.
   No AI runs here.

   Admin (index.js checks the admin role first):
   GET    /admin/page/:clientId/:campaignId           the page (or null), its tracked links,
                                                      suggested slugs and the full address
   PUT    /admin/page/:clientId/:campaignId           save the draft: slugs, language, offer end,
                                                      form on or off, notice approved, settings,
                                                      and the tracked links it needs
   POST   /admin/page/:clientId/:campaignId/asset?name=hero-800.webp   an image for the page
   POST   /admin/page/:clientId/:campaignId/publish   {html, endedHtml} publish or update
   POST   /admin/page/:clientId/:campaignId/unpublish take it down (410 Gone)

   Public:
   GET    /go/:clientSlug/:slug        the page (ended message after the offer's end date,
                                       410 when unpublished or the client has left)
   GET    /go/a/:pageId/:file          the page's images
   GET    /go/t.js                     the cookieless counting script
   GET    /go/r/:code                  short link and QR code: counts, then redirects */
import { getAuth } from "./auth.js";
import { looksLikeKey } from "./brain.js";
import { magicOk } from "./files.js";
import { escapeHtml, json, newId, nowIso, randomToken, readJson } from "./util.js";
import { recordEvent } from "./track.js";
import { checkLangGate } from "./lang.js";

const MB = 1024 * 1024;
export const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const RESERVED = new Set(["r", "a", "t", "t.js", "api", "grow", "admin", "assets"]);
export const CHANNELS = ["instagram", "facebook", "tiktok", "linkedin", "google", "email", "print", "video", "bio", "share", "download", "direct", "other"];
export const BUTTONS = ["call", "whatsapp", "booking", "directions", "order", "form", "other"];
const MEDIUMS = ["social", "paid", "email", "bio", "print", "video", "button", "share"];
const ASSET = /^[a-z0-9][a-z0-9-]{0,40}\.(webp|jpg|png)$/;
const ASSET_TYPES = { webp: ["image/webp", "webp"], jpg: ["image/jpeg", "jpeg"], png: ["image/png", "png"] };
const MAX_HTML = 600 * 1024;
const MAX_ASSET = 3 * MB;
const MAX_ASSETS = 40;

const M = {
  badRequest: { sv: "Ogiltig förfrågan.", en: "Bad request." },
  notFound: { sv: "Hittades inte.", en: "Not found." },
  slug: { sv: "Adressen får bara ha små bokstäver a till z, siffror och bindestreck.", en: "The address may only use lowercase a to z, digits and hyphens." },
  taken: { sv: "Den adressen används redan av en annan sida.", en: "That address is already used by another page." },
  noPage: { sv: "Spara sidan först.", en: "Save the page first." },
  end: { sv: "Ange erbjudandets slutdatum innan du publicerar.", en: "Set the offer's end date before publishing." },
  notice: { sv: "Med formuläret på måste kunden först godkänna sidans integritetstext.", en: "With the form on, the client must approve the page's privacy notice first." },
  html: { sv: "Sidan är ogiltig.", en: "The page is not valid." },
  dash: { sv: "Sidan innehåller tankstreck (em-dash).", en: "The page contains an em-dash." },
  key: { sv: "Texten ser ut att innehålla en API-nyckel.", en: "The text looks like it contains an API key." },
  asset: { sv: "Bara WebP, JPG eller PNG, högst 3 MB.", en: "Only WebP, JPG or PNG, 3 MB at most." },
  assets: { sv: "Sidan har redan för många bilder.", en: "This page already has too many images." },
  left: { sv: "Kunden har lämnat. Sidor kan inte publiceras.", en: "The client has left. Pages cannot be published." },
  action: { sv: "Länken är ogiltig.", en: "The link is not valid." }
};

const all = async (env, sql, ...args) => (await env.DB.prepare(sql).bind(...args).all()).results || [];
const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export function todayUtc(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

/* Days since the offer ended (negative while it runs, null without a date). */
export function daysAfterEnd(offerEnd, today = todayUtc()) {
  if (!offerEnd || !/^\d{4}-\d{2}-\d{2}$/.test(offerEnd)) return null;
  return Math.round((Date.parse(today + "T00:00:00Z") - Date.parse(offerEnd + "T00:00:00Z")) / 86400000);
}

export function pagePath(p) {
  return "/go/" + p.client_slug + "/" + p.slug;
}

export function slugify(s) {
  return String(s || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['\u2019]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

/* The buttons on a page, as safe absolute URLs. Anything else is dropped. */
export function cleanSettings(s) {
  s = s && typeof s === "object" && !Array.isArray(s) ? s : {};
  const phone = str(s.phone, 40).replace(/[^\d+]/g, "");
  const whatsapp = str(s.whatsapp, 40).replace(/[^\d]/g, "");
  const httpsUrl = (v) => {
    const u = str(v, 500);
    return /^https:\/\/[^\s<>"']+$/i.test(u) ? u : "";
  };
  const primary = ["whatsapp", "call", "booking", "order", "form", "directions"].includes(s.primary) ? s.primary : "";
  return {
    companyName: str(s.companyName, 200),
    address: str(s.address, 300),
    mapUrl: httpsUrl(s.mapUrl),
    hours: str(s.hours, 300),
    phone: phone.length >= 6 ? phone : "",
    whatsapp: whatsapp.length >= 6 ? whatsapp : "",
    whatsappText: str(s.whatsappText, 300),
    bookingUrl: httpsUrl(s.bookingUrl),
    orderUrl: httpsUrl(s.orderUrl),
    email: /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/.test(str(s.email, 200)) ? str(s.email, 200) : "",
    orgNumber: str(s.orgNumber, 40),
    primary,
    gallery: (Array.isArray(s.gallery) ? s.gallery : []).filter((x) => typeof x === "string" && /^f_[a-z0-9]{4,32}$/.test(x)).slice(0, 12),
    reviews: (Array.isArray(s.reviews) ? s.reviews : []).map((x) => str(x, 1000)).filter(Boolean).slice(0, 6),
    countVisits: !!s.countVisits,
    assets: (Array.isArray(s.assets) ? s.assets : []).filter((x) => typeof x === "string" && ASSET.test(x)).slice(0, MAX_ASSETS)
  };
}

/* Where a page button goes. Used by the download's tracked button links. */
export function actionTarget(settings, button) {
  const s = settings || {};
  if (button === "call" && s.phone) return "tel:" + s.phone;
  if (button === "whatsapp" && s.whatsapp) return "https://wa.me/" + s.whatsapp + (s.whatsappText ? "?text=" + encodeURIComponent(s.whatsappText) : "");
  if (button === "booking" && s.bookingUrl) return s.bookingUrl;
  if (button === "order" && s.orderUrl) return s.orderUrl;
  if (button === "directions") return s.mapUrl || (s.address ? "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(s.address) : "");
  return "";
}

export function pageOut(p, cfg) {
  if (!p) return null;
  let settings = {};
  try { settings = JSON.parse(p.settings || "{}"); } catch (e) {}
  return {
    id: p.id,
    campaignId: p.campaign_id,
    clientSlug: p.client_slug,
    slug: p.slug,
    version: p.version,
    state: p.state,
    ended: p.state === "published" && (daysAfterEnd(p.offer_end) || 0) > 0,
    language: p.language,
    offerEnd: p.offer_end || "",
    formOn: p.form_on === 1,
    noticeVersion: p.notice_version || "",
    token: p.token,
    settings,
    url: cfg.siteOrigin + pagePath(p),
    createdAt: p.created_at,
    updatedAt: p.updated_at,
    publishedAt: p.published_at || null,
    unpublishedAt: p.unpublished_at || null
  };
}

export function linkOut(l, cfg) {
  return {
    code: l.code,
    channel: l.channel,
    medium: l.medium,
    outputKey: l.output_key,
    label: l.label || "",
    offerCode: l.offer_code || "",
    url: cfg.siteOrigin + "/go/r/" + l.code
  };
}

async function campaignOf(env, clientId, campaignId) {
  return env.DB.prepare("SELECT c.data, k.name, k.left_at FROM campaigns c JOIN clients k ON k.id = c.client_id WHERE c.client_id = ? AND c.campaign_id = ?").bind(clientId, campaignId).first();
}

async function pageOf(env, clientId, campaignId) {
  return env.DB.prepare("SELECT * FROM pages WHERE client_id = ? AND campaign_id = ?").bind(clientId, campaignId).first();
}

/* ---------- admin ---------- */

export async function getPageAdmin(env, cfg, clientId, campaignId) {
  const row = await campaignOf(env, clientId, campaignId);
  if (!row) return json({ error: "not_found", message: M.notFound }, 404);
  const p = await pageOf(env, clientId, campaignId);
  let doc = {};
  try { doc = JSON.parse(row.data); } catch (e) {}
  const other = await env.DB.prepare("SELECT client_slug FROM pages WHERE client_id = ? LIMIT 1").bind(clientId).first();
  const links = p ? await all(env, "SELECT * FROM links WHERE page_id = ? ORDER BY rowid ASC", p.id) : [];
  return json({
    page: pageOut(p, cfg),
    links: links.map((l) => linkOut(l, cfg)),
    suggest: { clientSlug: (other && other.client_slug) || slugify(row.name) || "client", slug: slugify(doc.name) || slugify(campaignId.replace(/^cp_/, "")) },
    origin: cfg.siteOrigin
  });
}

export async function putPageAdmin(request, env, cfg, clientId, campaignId) {
  const row = await campaignOf(env, clientId, campaignId);
  if (!row) return json({ error: "not_found", message: M.notFound }, 404);
  const b = await readJson(request, 64 * 1024);
  if (!b) return json({ error: "bad_request", message: M.badRequest }, 400);
  if (looksLikeKey(JSON.stringify(b))) return json({ error: "api_key", message: M.key }, 400);
  const clientSlug = str(b.clientSlug, 40).toLowerCase();
  const slug = str(b.slug, 40).toLowerCase();
  if (!SLUG.test(clientSlug) || !SLUG.test(slug) || RESERVED.has(clientSlug)) return json({ error: "slug", message: M.slug }, 400);
  const offerEnd = /^\d{4}-\d{2}-\d{2}$/.test(String(b.offerEnd || "")) ? b.offerEnd : null;
  const language = b.language === "en" ? "en" : "sv";
  const formOn = b.formOn ? 1 : 0;
  const noticeVersion = formOn && b.noticeApproved ? str(b.noticeVersion, 20) || "n-1" : null;
  const settings = cleanSettings(b.settings);
  let p = await pageOf(env, clientId, campaignId);
  const clash = await env.DB.prepare("SELECT id FROM pages WHERE client_slug = ? AND slug = ?").bind(clientSlug, slug).first();
  if (clash && (!p || clash.id !== p.id)) return json({ error: "taken", message: M.taken }, 409);
  /* One client keeps one client address. */
  const otherClient = await env.DB.prepare("SELECT id FROM pages WHERE client_slug = ? AND client_id != ? LIMIT 1").bind(clientSlug, clientId).first();
  if (otherClient) return json({ error: "taken", message: M.taken }, 409);
  const t = nowIso();
  if (!p) {
    const id = newId("pg", 14);
    await env.DB.prepare(
      "INSERT INTO pages (id, client_id, campaign_id, client_slug, slug, version, state, language, offer_end, token, form_on, notice_version, settings, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, 'draft', ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(id, clientId, campaignId, clientSlug, slug, language, offerEnd, randomToken(18), formOn, noticeVersion, JSON.stringify(settings), t, t).run();
  } else {
    /* Assets uploaded since the last save stay listed, so a publish never loses an image. */
    let old = {};
    try { old = JSON.parse(p.settings || "{}"); } catch (e) {}
    settings.assets = Array.from(new Set([].concat(old.assets || [], settings.assets))).slice(0, MAX_ASSETS);
    await env.DB.prepare("UPDATE pages SET client_slug = ?, slug = ?, language = ?, offer_end = ?, form_on = ?, notice_version = ?, settings = ?, updated_at = ? WHERE id = ?")
      .bind(clientSlug, slug, language, offerEnd, formOn, noticeVersion, JSON.stringify(settings), t, p.id).run();
  }
  p = await pageOf(env, clientId, campaignId);
  /* Tracked links the page needs. A link for the same output keeps its code across saves. */
  if (Array.isArray(b.links)) {
    const existing = await all(env, "SELECT * FROM links WHERE page_id = ?", p.id);
    const byKey = {};
    existing.forEach((l) => { byKey[l.output_key] = l; });
    const stmts = [];
    for (const x of b.links.slice(0, 60)) {
      const outputKey = str(x && x.outputKey, 80);
      const channel = CHANNELS.includes(x && x.channel) ? x.channel : "other";
      const medium = MEDIUMS.includes(x && x.medium) ? x.medium : "social";
      if (!/^[A-Za-z0-9_.-]{2,80}$/.test(outputKey)) return json({ error: "bad_request", message: M.badRequest }, 400);
      const label = str(x.label, 120);
      const offerCode = str(x.offerCode, 30).toUpperCase().replace(/[^A-Z0-9-]/g, "");
      if (byKey[outputKey]) {
        stmts.push(env.DB.prepare("UPDATE links SET channel = ?, medium = ?, label = ?, offer_code = ? WHERE code = ?").bind(channel, medium, label, offerCode, byKey[outputKey].code));
      } else {
        const code = newId("x", 7).slice(2);
        byKey[outputKey] = { code };
        stmts.push(env.DB.prepare("INSERT INTO links (code, client_id, page_id, channel, medium, output_key, label, offer_code, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(code, clientId, p.id, channel, medium, outputKey, label, offerCode, t));
      }
    }
    if (stmts.length) await env.DB.batch(stmts);
  }
  return getPageAdmin(env, cfg, clientId, campaignId);
}

export async function putPageAsset(request, env, clientId, campaignId, url) {
  const p = await pageOf(env, clientId, campaignId);
  if (!p) return json({ error: "no_page", message: M.noPage }, 409);
  const name = String(url.searchParams.get("name") || "");
  if (!ASSET.test(name)) return json({ error: "asset", message: M.asset }, 400);
  const ext = name.split(".").pop();
  const len = parseInt(request.headers.get("Content-Length") || "0", 10);
  if (!len || len > MAX_ASSET) return json({ error: "asset", message: M.asset }, 413);
  const buf = new Uint8Array(await request.arrayBuffer());
  if (!buf.length || buf.length > MAX_ASSET || !magicOk(ASSET_TYPES[ext][1], buf)) return json({ error: "asset", message: M.asset }, 415);
  let settings = {};
  try { settings = JSON.parse(p.settings || "{}"); } catch (e) {}
  const assets = new Set(settings.assets || []);
  if (!assets.has(name) && assets.size >= MAX_ASSETS) return json({ error: "assets", message: M.assets }, 409);
  await env.FILES.put("c/" + clientId + "/p/" + p.id + "/" + name, buf, { httpMetadata: { contentType: ASSET_TYPES[ext][0] } });
  assets.add(name);
  settings.assets = Array.from(assets);
  await env.DB.prepare("UPDATE pages SET settings = ?, updated_at = ? WHERE id = ?").bind(JSON.stringify(settings), nowIso(), p.id).run();
  return json({ ok: true, name, url: "/go/a/" + p.id + "/" + name, size: buf.length }, 201);
}

/* What a stored page may contain. The builder makes plain HTML and CSS; the Worker adds the
   only script (the counting snippet) when it serves the page. */
export function checkHtml(html) {
  if (typeof html !== "string" || html.length < 200 || html.length > MAX_HTML) return "html";
  if (!/^<!doctype html>/i.test(html.trim())) return "html";
  if (/<script(?![^>]*type=["']application\/ld\+json["'])/i.test(html)) return "html";
  if (/<(iframe|object|embed|base|frame|applet)\b/i.test(html)) return "html";
  /* Event handler attributes and script URLs, looked for inside tags only (quoted values
     removed first), so ordinary text such as "only = 2" is never mistaken for one. */
  const tags = html.match(/<[a-z][^>]*>/gi) || [];
  for (const t of tags) {
    const bare = t.replace(/"[^"]*"|'[^']*'/g, '""');
    if (/\son[a-z]+\s*=/i.test(bare)) return "html";
    if (/(href|src|action|formaction)\s*=\s*["']?\s*(javascript:|vbscript:|data:text)/i.test(t)) return "html";
  }
  /* No third-party requests: every src and stylesheet is local or a data: URI. */
  if (/\s(src|srcset)=["']\s*(https?:)?\/\//i.test(html) || /<link[^>]+rel=["']?stylesheet/i.test(html) || /@import|url\(\s*["']?(https?:)?\/\//i.test(html)) return "html";
  if (/\u2014/.test(html)) return "dash";
  if (looksLikeKey(html)) return "key";
  return null;
}

export async function publishPage(request, env, cfg, clientId, campaignId) {
  const row = await campaignOf(env, clientId, campaignId);
  if (!row) return json({ error: "not_found", message: M.notFound }, 404);
  if (row.left_at) return json({ error: "left", message: M.left }, 409);
  const p = await pageOf(env, clientId, campaignId);
  if (!p) return json({ error: "no_page", message: M.noPage }, 409);
  if (!p.offer_end) return json({ error: "end", message: M.end }, 400);
  if (p.form_on && !p.notice_version) return json({ error: "notice", message: M.notice }, 400);
  const b = await readJson(request, 2 * MAX_HTML + 4096);
  if (!b) return json({ error: "bad_request", message: M.badRequest }, 400);
  /* V2 Part H: a Swedish page waits for approved text (or Harry gives a reason). */
  const lg = await checkLangGate(env, clientId, campaignId, JSON.parse(row.data), b.langOverride);
  if (lg) return lg;
  for (const k of ["html", "endedHtml"]) {
    const bad = checkHtml(b[k]);
    if (bad) return json({ error: bad, message: M[bad], part: k }, 400);
  }
  const version = p.version + 1;
  const base = "c/" + clientId + "/p/" + p.id + "/";
  await env.FILES.put(base + "page-v" + version + ".html", b.html, { httpMetadata: { contentType: "text/html; charset=utf-8" } });
  await env.FILES.put(base + "ended-v" + version + ".html", b.endedHtml, { httpMetadata: { contentType: "text/html; charset=utf-8" } });
  const t = nowIso();
  await env.DB.prepare("UPDATE pages SET version = ?, state = 'published', html_key = ?, ended_key = ?, published_at = COALESCE(published_at, ?), unpublished_at = NULL, updated_at = ? WHERE id = ?")
    .bind(version, base + "page-v" + version + ".html", base + "ended-v" + version + ".html", t, t, p.id).run();
  /* Older versions are not needed: the link stays the same and serves the newest. */
  if (p.html_key) await env.FILES.delete([p.html_key, p.ended_key].filter(Boolean));
  return getPageAdmin(env, cfg, clientId, campaignId);
}

export async function unpublishPage(env, cfg, clientId, campaignId) {
  const p = await pageOf(env, clientId, campaignId);
  if (!p) return json({ error: "not_found", message: M.notFound }, 404);
  await env.DB.prepare("UPDATE pages SET state = 'unpublished', unpublished_at = ?, updated_at = ? WHERE id = ?").bind(nowIso(), nowIso(), p.id).run();
  return getPageAdmin(env, cfg, clientId, campaignId);
}

/* ---------- public ---------- */

const PUBLIC_CSP =
  "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors *";

function htmlResponse(body, status, extra = {}) {
  return new Response(body, {
    status,
    headers: Object.assign({
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache",
      "Content-Security-Policy": PUBLIC_CSP,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=(), interest-cohort=()"
    }, extra)
  });
}

const GONE = {
  sv: { t: "Sidan finns inte längre", b: "Den här kampanjsidan har tagits bort." },
  en: { t: "This page is no longer available", b: "This campaign page has been taken down." }
};
const MISSING = {
  sv: { t: "Sidan hittades inte", b: "Kontrollera adressen och försök igen." },
  en: { t: "Page not found", b: "Check the address and try again." }
};

export function plainPage(l, copy, status) {
  const c = copy[l === "en" ? "en" : "sv"];
  return htmlResponse(
    '<!doctype html><html lang="' + (l === "en" ? "en" : "sv") + '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>' + escapeHtml(c.t) + "</title>" +
    "<style>body{font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;background:#f6f4ef;color:#1d1d1b}main{max-width:420px;padding:32px;text-align:center}h1{font-size:22px;margin:0 0 8px}p{margin:0;color:#555}</style></head>" +
    "<body><main><h1>" + escapeHtml(c.t) + "</h1><p>" + escapeHtml(c.b) + "</p></main></body></html>",
    status,
    { "X-Robots-Tag": "noindex" }
  );
}

async function isAdmin(request, env, cfg) {
  try {
    const a = await getAuth(request, env, cfg);
    return !!a && a.role === "admin";
  } catch (e) {
    return false;
  }
}

export async function servePage(request, env, cfg, clientSlug, slug) {
  const p = await env.DB.prepare("SELECT p.*, c.left_at FROM pages p JOIN clients c ON c.id = p.client_id WHERE p.client_slug = ? AND p.slug = ?").bind(clientSlug, slug).first();
  if (!p || p.state === "draft") return plainPage("sv", MISSING, 404);
  if (p.left_at || p.state === "unpublished") return plainPage(p.language, GONE, 410);
  const after = daysAfterEnd(p.offer_end);
  const ended = after !== null && after > 0;
  const obj = await env.FILES.get(ended ? p.ended_key : p.html_key);
  if (!obj) return plainPage(p.language, MISSING, 404);
  let html = await obj.text();
  /* Harry's own signed-in visits are never counted: they get the page without the snippet. */
  if (!(await isAdmin(request, env, cfg))) {
    const snippet = '<script src="/go/t.js" data-p="' + p.id + '" defer></script>';
    html = /<\/body>/i.test(html) ? html.replace(/<\/body>(?![\s\S]*<\/body>)/i, snippet + "</body>") : html + snippet;
  }
  return htmlResponse(html, 200, ended ? { "X-Robots-Tag": "noindex" } : {});
}

export async function serveAsset(env, pageId, name) {
  if (!/^pg_[a-z0-9]{4,32}$/.test(pageId) || !ASSET.test(name)) return new Response("Not found", { status: 404 });
  const p = await env.DB.prepare("SELECT p.client_id, p.state, c.left_at FROM pages p JOIN clients c ON c.id = p.client_id WHERE p.id = ?").bind(pageId).first();
  if (!p || p.left_at || p.state === "unpublished") return new Response("Gone", { status: p ? 410 : 404 });
  const obj = await env.FILES.get("c/" + p.client_id + "/p/" + pageId + "/" + name);
  if (!obj) return new Response("Not found", { status: 404 });
  return new Response(obj.body, {
    headers: {
      "Content-Type": ASSET_TYPES[name.split(".").pop()][0],
      "Cache-Control": "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
      "Access-Control-Allow-Origin": "*",
      "Cross-Origin-Resource-Policy": "cross-origin"
    }
  });
}

/* Short links and QR codes: count, then send the visitor on. Button links (output key
   button.<type>, used by the downloaded HTML) go straight to the action, such as WhatsApp. */
export async function shortLink(request, env, cfg, code, ctx) {
  if (!/^[a-z0-9]{4,12}$/.test(code)) return plainPage("sv", MISSING, 404);
  const l = await env.DB.prepare("SELECT l.*, p.client_slug, p.slug, p.state, p.language, p.settings, p.campaign_id, c.left_at FROM links l JOIN pages p ON p.id = l.page_id JOIN clients c ON c.id = l.client_id WHERE l.code = ?").bind(code).first();
  if (!l) return plainPage("sv", MISSING, 404);
  if (l.left_at || l.state !== "published") return plainPage(l.language, GONE, 410);
  const isButton = l.output_key.startsWith("button.");
  let target;
  if (isButton) {
    let s = {};
    try { s = JSON.parse(l.settings || "{}"); } catch (e) {}
    target = actionTarget(s, l.output_key.slice(7));
    if (!target) return plainPage(l.language, MISSING, 404);
  } else {
    const q = new URLSearchParams({
      utm_source: l.channel,
      utm_medium: l.medium,
      utm_campaign: l.campaign_id.replace(/^cp_/, ""),
      utm_content: l.output_key,
      c: l.code
    });
    target = cfg.siteOrigin + "/go/" + l.client_slug + "/" + l.slug + "?" + q.toString();
  }
  if (!(await isAdmin(request, env, cfg))) {
    const type = isButton ? "click" : l.medium === "print" ? "scan" : "link";
    ctx.waitUntil(recordEvent(env, request, { pageId: l.page_id, clientId: l.client_id, type, button: isButton ? l.output_key.slice(7) : null, code: l.code, utm: {} }).catch(() => {}));
  }
  return new Response(null, { status: 302, headers: { Location: target, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}

/* The counting script. No cookies, no storage. A page view, then one event per tracked button
   click. Reads the short link code and UTM fields from the address. */
export const TRACKER_JS = `(function(){
var s=document.currentScript,p=s&&s.getAttribute("data-p");if(!p)return;
var e=s.getAttribute("data-e")||"/api/vault/pub/event",q=new URLSearchParams(location.search),u={};
["utm_source","utm_medium","utm_campaign","utm_content"].forEach(function(k){var v=q.get(k);if(v)u[k]=v.slice(0,80);});
var c=(q.get("c")||"").slice(0,12);
function send(t,b){var d=JSON.stringify({p:p,t:t,b:b||null,c:c||null,u:u,w:window.innerWidth||0});
try{if(navigator.sendBeacon&&navigator.sendBeacon(e,new Blob([d],{type:"text/plain"})))return;}catch(x){}
try{fetch(e,{method:"POST",body:d,keepalive:true,headers:{"Content-Type":"text/plain"},credentials:"same-origin"});}catch(x){}}
send("view");
document.addEventListener("click",function(ev){var a=ev.target&&ev.target.closest&&ev.target.closest("[data-t]");if(a)send("click",a.getAttribute("data-t"));},true);
var f=document.querySelector("form[data-lead]");
if(f){var hc=f.querySelector("input[name=c]");if(hc&&c)hc.value=c;var hs=f.querySelector("input[name=src]");if(hs&&u.utm_source)hs.value=u.utm_source;}
})();`;

export function serveTracker() {
  return new Response(TRACKER_JS, {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Access-Control-Allow-Origin": "*",
      "Cross-Origin-Resource-Policy": "cross-origin"
    }
  });
}
