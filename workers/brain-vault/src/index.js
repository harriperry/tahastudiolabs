/* Brain Vault: the always-on bridge between the TAHA client portal and ScriptForge.
   Routed at tahastudiolabs.com/api/vault/* (the API) and tahastudiolabs.com/grow/* (the client
   portal pages). Phase 1: login, roles and invites. Phase 2: the client portal.
   Phase 3: admin endpoints behind the ScriptForge Growth Clients panel.
   Phase 4: Business Brain versions (saved from ScriptForge, never built here).
   Phase 5: campaigns from the Campaign Generator, campaign and manual status changes.
   Phase 6: GDPR tools (full export, erase now, leaving and the 6 month retention rule).
   V2 phase G1: campaign-2 documents with a Visual Pack, finished images attached to a
   campaign (deliveries) and the client's brand kit. Admin only; the portal is unchanged.
   V2 phase G2a: photo requests from Visual Pack briefs to the portal (Photos we need).
   V2 phase G2b: hosted landing pages at /go/<client>/<campaign>, short links and QR codes at
   /go/r/<code>, cookieless counting, enquiries, before and after numbers, costs, the
   Performance tab, and the portal's Your enquiries and Campaign report.

   House rules enforced here:
   1. The Vault never receives, stores or logs an LLM API key. No endpoint accepts one.
   2. No client business content is written to logs or notification emails.
   3. Admin endpoints check the admin role; client endpoints check the session's own client id.
   4. Every state-changing request must come from the TAHA site itself (Origin check). */
import { getConfig, STATUS_LABELS } from "./config.js";
import { ensureSchema } from "./db.js";
import {
  checkRateLimit,
  cleanup,
  clearSessionCookie,
  consumeToken,
  createSession,
  destroySession,
  getAuth,
  issueLoginLink,
  sessionCookie
} from "./auth.js";
import { createClient, getIntakeAdmin, listClients, markSeen, resendInvite } from "./admin.js";
import { getBrains, getBrainVersion, saveBrain } from "./brain.js";
import { getCampaign, listCampaigns, saveCampaign, setCampaignStatus, setManualStatus } from "./campaign.js";
import { eraseNow, exportClient, retentionSweep, setLeft } from "./gdpr.js";
import { addDelivery, deleteDelivery, getBrandKit, getDelivery, listDeliveries, putBrandKit } from "./delivery.js";
import { cancelPhotoRequest, listPhotoRequestsAdmin, listPhotoRequestsPortal, sendPhotoRequests } from "./photos.js";
import {
  deleteFile,
  getFile,
  getIntake,
  getStatus,
  portalState,
  postConsent,
  postUpload,
  putIntake,
  putLanguage,
  submitIntake
} from "./portal.js";
import { getPageAdmin, publishPage, putPageAdmin, putPageAsset, serveAsset, servePage, serveTracker, shortLink, unpublishPage } from "./pages.js";
import { corsPreflight, pubEvent, pubLead } from "./track.js";
import { adminLeads, deleteLead, g2bSweep, getBaseline, getCosts, getStats, patchLead, portalLeads, portalLeadsCsv, portalPages, portalReport, putBaseline, putCosts } from "./roi.js";
import { getReviews, portalCampaigns, postReview, sendForReview } from "./review.js";
import { abortUpload, completeUpload, download, portalCampaign, startUpload, uploadPart } from "./content.js";
import jszipJs from "./public/jszip.min.js";
import { consumeMemberToken, createMemberSession, destroyMemberSession, inviteMember, listTeam, patchMember, teamCleanup } from "./team.js";
import { acceptAll, decideItem, getLang, getNotes, postNote, putSetting, reviewDone, reviewFlag, reviewItem, reviewQueue, sendLang } from "./lang.js";
import reviewerHtml from "./public/reviewer.html";
import reviewerJs from "./public/reviewer.js";
import { getPlan, getRhythm, lastResults, putPlan, rhythmReminder } from "./rhythm.js";
import { adminResults, portalResults, putAdminResults, putPortalResults } from "./results.js";
import { abortVideo, completeVideo, listVideos, staleUploadSweep, startVideo, videoPart, videoState } from "./videos.js";
import { SCHEMAS } from "./schemas.js";
import { json, lang, normEmail, readJson, validEmail, withCookies } from "./util.js";

import verifyHtml from "./public/verify.html";
import verifyJs from "./public/verify.js";
import consoleHtml from "./public/console.html";
import consoleJs from "./public/console.js";
import vaultCss from "./public/vault.css";
import portalHtml from "./public/portal.html";
import portalJs from "./public/portal.js";
import portalCss from "./public/portal.css";
import i18n from "./public/i18n.json";

const MSG = {
  neutral: {
    sv: "Om e-postadressen finns hos oss har vi skickat en inloggningslänk. Kolla din inkorg.",
    en: "If this email address is registered with us, we have sent a login link. Check your inbox."
  },
  invalidEmail: { sv: "Skriv en giltig e-postadress.", en: "Enter a valid email address." },
  rateLimited: {
    sv: "För många försök. Vänta en stund och försök igen.",
    en: "Too many attempts. Please wait a while and try again."
  },
  badLink: {
    sv: "Länken är ogiltig, redan använd eller har gått ut. Begär en ny länk.",
    en: "This link is invalid, already used or expired. Request a new link."
  },
  notSignedIn: { sv: "Du är inte inloggad.", en: "You are not signed in." },
  forbidden: { sv: "Du har inte behörighet.", en: "You do not have access." },
  badOrigin: { sv: "Förfrågan nekades.", en: "Request refused." },
  notFound: { sv: "Hittades inte.", en: "Not found." },
  server: { sv: "Något gick fel hos oss. Försök igen.", en: "Something went wrong on our side. Please try again." }
};

const PAGE_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";

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
    headers: {
      "Content-Type": type,
      "Cache-Control": "public, max-age=300",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

/* The client portal: one page, its script, styles and the i18n dictionary, served at /grow/. */
function servePortal(path) {
  if (path === "/grow/portal.js") return asset(portalJs, "text/javascript; charset=utf-8");
  if (path === "/grow/portal.css") return asset(portalCss, "text/css; charset=utf-8");
  if (path === "/grow/i18n.json") return asset(JSON.stringify(i18n), "application/json; charset=utf-8");
  if (path === "/grow/jszip.js") return asset(jszipJs, "text/javascript; charset=utf-8");
  /* V2 Part H: the language reviewer's workspace. */
  if (path === "/grow/review/reviewer.js") return asset(reviewerJs, "text/javascript; charset=utf-8");
  if (path === "/grow/review" || path === "/grow/review/") return page(reviewerHtml);
  return page(portalHtml);
}

/* A state-changing request must come from the TAHA site itself. Browsers send Origin on
   these requests; Sec-Fetch-Site is a header pages cannot forge and covers browsers that send
   "Origin: null" under a strict referrer policy. */
function sameOrigin(request, cfg) {
  const origin = request.headers.get("Origin");
  if (origin === cfg.siteOrigin) return true;
  return (!origin || origin === "null") && request.headers.get("Sec-Fetch-Site") === "same-origin";
}

async function handle(request, env, ctx) {
  const cfg = getConfig(env);
  const url = new URL(request.url);
  /* V2 phase G2b: public landing pages, their images, short links and the counting script. */
  if (url.pathname === "/go" || url.pathname.startsWith("/go/")) {
    if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
    if (url.pathname === "/go/t.js") return serveTracker();
    await ensureSchema(env);
    const ga = url.pathname.match(/^\/go\/a\/(pg_[a-z0-9]{4,32})\/([a-z0-9][a-z0-9.-]{0,50})$/);
    if (ga) return serveAsset(env, ga[1], ga[2]);
    const gr = url.pathname.match(/^\/go\/r\/([a-z0-9]{4,12})\/?$/);
    if (gr) return shortLink(request, env, cfg, gr[1], ctx);
    const gp = url.pathname.match(/^\/go\/([a-z0-9-]{1,40})\/([a-z0-9-]{1,40})(\/?)$/);
    if (gp && gp[3]) return Response.redirect(cfg.siteOrigin + "/go/" + gp[1] + "/" + gp[2] + url.search, 301);
    if (gp) return servePage(request, env, cfg, gp[1], gp[2]);
    return servePage(request, env, cfg, "", "");
  }
  if ((url.pathname === "/grow" || url.pathname.startsWith("/grow/")) && (request.method === "GET" || request.method === "HEAD")) {
    if (url.pathname === "/grow") return Response.redirect(cfg.siteOrigin + "/grow/", 301);
    return servePortal(url.pathname);
  }
  if (!url.pathname.startsWith(cfg.basePath + "/") && url.pathname !== cfg.basePath) {
    return json({ error: "not_found", message: MSG.notFound }, 404);
  }
  const path = url.pathname.slice(cfg.basePath.length) || "/";
  const method = request.method.toUpperCase();

  /* Static, no database needed. */
  if (method === "GET") {
    if (path === "/assets/vault.css") return asset(vaultCss, "text/css; charset=utf-8");
    if (path === "/assets/verify.js") return asset(verifyJs, "text/javascript; charset=utf-8");
    if (path === "/assets/console.js") return asset(consoleJs, "text/javascript; charset=utf-8");
    if (path === "/auth/verify") return page(verifyHtml);
    if (path === "/console" || path === "/") return page(consoleHtml);
    const sm = path.match(/^\/schemas\/(intake|brain|campaign)(\.schema\.json)?$/);
    if (sm) return json(SCHEMAS[sm[1]], 200, { "Cache-Control": "public, max-age=300" });
  }

  /* V2 phase G2b: counting and enquiries. Open to other origins so a downloaded copy of a page
     works; no cookies are set, and an enquiry from another site needs the page's token. */
  if (path === "/pub/event" || path.startsWith("/pub/lead/")) {
    if (method === "OPTIONS") return corsPreflight();
    if (method !== "POST") return json({ error: "not_found", message: MSG.notFound }, 404);
    await ensureSchema(env);
    if (path === "/pub/event") return pubEvent(request, env, cfg);
    const pl = path.match(/^\/pub\/lead\/(pg_[a-z0-9]{4,32})$/);
    if (pl) return pubLead(request, env, cfg, ctx, pl[1]);
    return json({ error: "not_found", message: MSG.notFound }, 404);
  }

  if (method !== "GET" && method !== "HEAD" && !sameOrigin(request, cfg)) {
    return json({ error: "bad_origin", message: MSG.badOrigin }, 403);
  }

  await ensureSchema(env);

  if (method === "GET" && path === "/health") {
    const db = await env.DB.prepare("SELECT 1 AS ok").first();
    return json({ ok: !!db, db: !!db, files: !!env.FILES, phase: 6, part: "e" });
  }

  if (method === "GET" && path === "/portal/meta") {
    return json({ productName: cfg.productName, contactEmail: cfg.tahaEmail });
  }

  /* ---------- auth ---------- */
  if (method === "POST" && path === "/auth/request-link") {
    const b = await readJson(request, 4096);
    const email = normEmail(b && b.email);
    if (!validEmail(email)) return json({ error: "invalid_email", message: MSG.invalidEmail }, 400);
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const allowed = await checkRateLimit(env, cfg, email, ip);
    if (!allowed) return json({ error: "rate_limited", message: MSG.rateLimited }, 429, { "Retry-After": "3600" });
    ctx.waitUntil(issueLoginLink(env, cfg, email, lang(b && b.lang)).catch((e) => console.error("issue link: " + e.message)));
    return json({ ok: true, message: MSG.neutral });
  }

  if (method === "POST" && path === "/auth/verify") {
    const b = await readJson(request, 1024);
    const tok = b && typeof b.t === "string" ? b.t : "";
    const row = await consumeToken(env, tok);
    if (!row) {
      /* V2 Part H: a team member's link. */
      const member = await consumeMemberToken(env, tok);
      if (!member) return json({ error: "bad_link", message: MSG.badLink }, 400);
      await destroySession(env, request);
      await destroyMemberSession(env, request);
      const ms = await createMemberSession(env, cfg, member);
      return json({ ok: true, role: "reviewer", redirect: ms.redirect }, 200, { "Set-Cookie": sessionCookie(cfg, ms.token) });
    }
    if (row.role === "client") {
      const c = await env.DB.prepare("SELECT id FROM clients WHERE id = ? AND email = ? AND left_at IS NULL").bind(row.client_id, row.email).first();
      if (!c) return json({ error: "bad_link", message: MSG.badLink }, 400);
    }
    await destroySession(env, request);
    const token = await createSession(env, cfg, { role: row.role, clientId: row.client_id, email: row.email });
    const redirect = row.role === "admin" ? cfg.adminHome : cfg.clientHome;
    return json({ ok: true, role: row.role, redirect }, 200, { "Set-Cookie": sessionCookie(cfg, token) });
  }

  if (method === "POST" && path === "/auth/logout") {
    await destroySession(env, request);
    await destroyMemberSession(env, request);
    return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie() });
  }

  const auth = await getAuth(request, env, cfg);
  const respond = (r) => withCookies(r, auth ? auth.setCookies : []);

  if (method === "GET" && path === "/auth/me") {
    if (!auth) return json({ role: null, message: MSG.notSignedIn }, 401);
    const out = { role: auth.role, email: auth.email, via: auth.via };
    if (auth.role === "reviewer") out.name = auth.name;
    if (auth.role === "client") {
      const c = await env.DB.prepare("SELECT id, name, status, language FROM clients WHERE id = ?").bind(auth.clientId).first();
      if (!c) return json({ role: null, message: MSG.notSignedIn }, 401, { "Set-Cookie": clearSessionCookie() });
      out.client = { id: c.id, name: c.name, status: c.status, statusLabel: STATUS_LABELS[c.status], language: c.language };
    }
    return respond(json(out));
  }

  /* ---------- client portal ---------- */
  const clientPaths = ["/portal/state", "/consent", "/intake", "/uploads", "/intake/submit", "/status", "/me/language", "/portal/photo-requests", "/portal/pages", "/portal/leads", "/portal/leads.csv", "/portal/campaigns", "/portal/results", "/portal/videos", "/portal/videos/start"];
  const fileMatch = path.match(/^\/files\/(f_[a-z0-9]{4,32})$/);
  const leadMatch = path.match(/^\/portal\/leads\/(ld_[a-z0-9]{4,32})$/);
  const reportMatch = path.match(/^\/portal\/report\/(cp_[a-z0-9_]{2,40})$/);
  const campMatch = path.match(/^\/portal\/(campaign|review)\/(cp_[a-z0-9_]{2,40})$/);
  const dlMatch = path.match(/^\/dl\/(d_[a-z0-9]{4,32})$/);
  const resMatch = path.match(/^\/portal\/results\/(cp_[a-z0-9_]{2,40})$/);
  const vidMatch = path.match(/^\/portal\/videos\/(f_[a-z0-9]{4,32})(?:\/(part|complete))?$/);
  if (clientPaths.includes(path) || fileMatch || leadMatch || reportMatch || campMatch || dlMatch || resMatch || vidMatch) {
    if (!auth) return json({ error: "not_signed_in", message: MSG.notSignedIn }, 401);
    if (fileMatch && method === "GET") return respond(await getFile(env, auth, fileMatch[1]));
    if (dlMatch && method === "GET") return respond(await download(env, auth, dlMatch[1], url));
    if (auth.role !== "client") return json({ error: "forbidden", message: MSG.forbidden }, 403);
    if (fileMatch && method === "DELETE") return deleteFile(env, auth, fileMatch[1]);
    if (path === "/portal/state" && method === "GET") return portalState(env, cfg, auth);
    if (path === "/consent" && method === "POST") return postConsent(request, env, cfg, auth);
    if (path === "/intake" && method === "GET") return getIntake(env, cfg, auth);
    if (path === "/intake" && method === "PUT") return putIntake(request, env, cfg, auth);
    if (path === "/uploads" && method === "POST") return postUpload(request, env, cfg, auth, url, ctx);
    if (path === "/portal/photo-requests" && method === "GET") return listPhotoRequestsPortal(env, auth);
    if (path === "/intake/submit" && method === "POST") return submitIntake(env, cfg, auth, ctx);
    if (path === "/status" && method === "GET") return getStatus(env, auth);
    if (path === "/me/language" && method === "PUT") return putLanguage(request, env, auth);
    /* V2 phase G2b */
    if (path === "/portal/pages" && method === "GET") return portalPages(env, cfg, auth);
    if (path === "/portal/leads" && method === "GET") return portalLeads(env, auth);
    if (path === "/portal/leads.csv" && method === "GET") return portalLeadsCsv(env, auth);
    if (leadMatch && method === "PATCH") return patchLead(request, env, auth, leadMatch[1]);
    if (leadMatch && method === "DELETE") return deleteLead(env, auth, leadMatch[1]);
    if (reportMatch && method === "GET") return portalReport(env, cfg, auth, reportMatch[1]);
    /* V2 Parts A and B */
    if (path === "/portal/campaigns" && method === "GET") return portalCampaigns(env, auth);
    if (campMatch && campMatch[1] === "campaign" && method === "GET") return portalCampaign(env, cfg, auth, campMatch[2]);
    if (campMatch && campMatch[1] === "review" && method === "POST") return postReview(request, env, cfg, ctx, auth, campMatch[2]);
    /* V2 Part D */
    if (path === "/portal/results" && method === "GET") return portalResults(env, cfg, auth, url);
    if (resMatch && method === "PUT") return putPortalResults(request, env, cfg, ctx, auth, resMatch[1]);
    /* V2 Part E */
    if (path === "/portal/videos" && method === "GET") return listVideos(env, cfg, auth);
    if (path === "/portal/videos/start" && method === "POST") return startVideo(request, env, cfg, auth);
    if (vidMatch && !vidMatch[2] && method === "GET") return videoState(env, cfg, auth, vidMatch[1]);
    if (vidMatch && !vidMatch[2] && method === "DELETE") return abortVideo(env, cfg, auth, vidMatch[1]);
    if (vidMatch && vidMatch[2] === "part" && method === "PUT") return videoPart(request, env, cfg, auth, vidMatch[1], url);
    if (vidMatch && vidMatch[2] === "complete" && method === "POST") return completeVideo(env, cfg, auth, vidMatch[1]);
  }

  /* ---------- language reviewer (V2 Part H) ---------- */
  if (path === "/review/queue" || path.startsWith("/review/item/")) {
    if (!auth) return json({ error: "not_signed_in", message: MSG.notSignedIn }, 401);
    if (auth.role !== "reviewer") return json({ error: "forbidden", message: MSG.forbidden }, 403);
    if (path === "/review/queue" && method === "GET") return respond(await reviewQueue(env, auth));
    const ri = path.match(/^\/review\/item\/(li_[a-z0-9]{4,32})(?:\/(done|flag))?$/);
    if (ri && !ri[2] && (method === "GET" || method === "PUT")) return respond(await reviewItem(request, env, auth, ri[1], method));
    if (ri && ri[2] === "done" && method === "POST") return respond(await reviewDone(request, env, cfg, ctx, auth, ri[1]));
    if (ri && ri[2] === "flag" && method === "POST") return respond(await reviewFlag(request, env, cfg, ctx, auth, ri[1]));
    return json({ error: "not_found", message: MSG.notFound }, 404);
  }

  /* ---------- admin ---------- */
  /* ScriptForge asks this on page load to decide whether to show the Growth Clients button.
     Always 200 so public visitors get a quiet {admin:false} and nothing else. */
  if (method === "GET" && path === "/admin/check") {
    return respond(json({ admin: !!auth && auth.role === "admin" }));
  }
  if (path === "/admin" || path.startsWith("/admin/")) {
    if (!auth) return json({ error: "not_signed_in", message: MSG.notSignedIn }, 401);
    if (auth.role !== "admin") return json({ error: "forbidden", message: MSG.forbidden }, 403);
    if (path === "/admin/clients" && method === "GET") return respond(await listClients(env));
    if (path === "/admin/clients" && method === "POST") return respond(await createClient(request, env, cfg));
    const inv = path.match(/^\/admin\/clients\/(cl_[a-z0-9]{4,32})\/invite$/);
    if (inv && method === "POST") return respond(await resendInvite(env, cfg, inv[1]));
    const seen = path.match(/^\/admin\/clients\/(cl_[a-z0-9]{4,32})\/seen$/);
    if (seen && method === "POST") return respond(await markSeen(request, env, seen[1]));
    const br = path.match(/^\/admin\/brain\/(cl_[a-z0-9]{4,32})(?:\/([0-9]{1,6}))?$/);
    if (br && method === "POST" && !br[2]) return respond(await saveBrain(request, env, br[1]));
    if (br && method === "GET" && !br[2]) return respond(await getBrains(env, br[1]));
    if (br && method === "GET" && br[2]) return respond(await getBrainVersion(env, br[1], parseInt(br[2], 10)));
    const cpl = path.match(/^\/admin\/campaigns\/(cl_[a-z0-9]{4,32})$/);
    if (cpl && method === "GET") return respond(await listCampaigns(env, cpl[1]));
    const cps = path.match(/^\/admin\/campaign\/(cl_[a-z0-9]{4,32})$/);
    if (cps && method === "POST") return respond(await saveCampaign(request, env, cps[1], cfg, ctx));
    const cp = path.match(/^\/admin\/campaign\/(cl_[a-z0-9]{4,32})\/(cp_[a-z0-9_]{2,40})(\/status)?$/);
    if (cp && method === "GET" && !cp[3]) return respond(await getCampaign(env, cp[1], cp[2]));
    if (cp && method === "PATCH" && cp[3]) return respond(await setCampaignStatus(request, env, cp[1], cp[2], cfg, ctx));
    /* V2 Part C: the monthly rhythm */
    if (path === "/admin/rhythm" && method === "GET") return respond(await getRhythm(env, cfg, url));
    const pl = path.match(/^\/admin\/plan\/(cl_[a-z0-9]{4,32})(\/last-results)?$/);
    if (pl && method === "GET" && !pl[2]) return respond(await getPlan(env, cfg, pl[1], url));
    if (pl && method === "PUT" && !pl[2]) return respond(await putPlan(request, env, cfg, pl[1]));
    if (pl && method === "GET" && pl[2]) return respond(await lastResults(env, cfg, pl[1], url));
    /* V2 Part D */
    const rs = path.match(/^\/admin\/results\/(cl_[a-z0-9]{4,32})(?:\/(cp_[a-z0-9_]{2,40}))?$/);
    if (rs && method === "GET" && !rs[2]) return respond(await adminResults(env, rs[1]));
    if (rs && method === "PUT" && rs[2]) return respond(await putAdminResults(request, env, rs[1], rs[2]));
    /* V2 Part H */
    if (path === "/admin/team" && method === "GET") return respond(await listTeam(env));
    if (path === "/admin/team/invite" && method === "POST") return respond(await inviteMember(request, env, cfg, ctx));
    const tm = path.match(/^\/admin\/team\/(tm_[a-z0-9]{4,32})$/);
    if (tm && method === "PATCH") return respond(await patchMember(request, env, cfg, ctx, tm[1]));
    const lg = path.match(/^\/admin\/lang\/(cl_[a-z0-9]{4,32})\/(cp_[a-z0-9_]{2,40})(?:\/(send|accept-all))?$/);
    if (lg && method === "GET" && !lg[3]) return respond(await getLang(env, lg[1], lg[2]));
    if (lg && method === "POST" && lg[3] === "send") return respond(await sendLang(request, env, cfg, ctx, lg[1], lg[2]));
    if (lg && method === "POST" && lg[3] === "accept-all") return respond(await acceptAll(env, lg[1], lg[2]));
    const li = path.match(/^\/admin\/lang\/item\/(li_[a-z0-9]{4,32})$/);
    if (li && method === "POST") return respond(await decideItem(request, env, li[1]));
    const ln = path.match(/^\/admin\/lang\/notes\/(cl_[a-z0-9]{4,32})$/);
    if (ln && method === "GET") return respond(await getNotes(env, ln[1]));
    if (ln && method === "POST") return respond(await postNote(request, env, ln[1]));
    const ls = path.match(/^\/admin\/lang\/setting\/(cl_[a-z0-9]{4,32})$/);
    if (ls && method === "PUT") return respond(await putSetting(request, env, ls[1]));
    /* V2 Part A */
    const rvw = path.match(/^\/admin\/campaign\/(cl_[a-z0-9]{4,32})\/(cp_[a-z0-9_]{2,40})\/review$/);
    if (rvw && method === "POST") return respond(await sendForReview(env, cfg, ctx, rvw[1], rvw[2], request));
    if (rvw && method === "GET") return respond(await getReviews(env, rvw[1], rvw[2]));
    /* V2 Part B: large files in parts */
    const up = path.match(/^\/admin\/upload\/(cl_[a-z0-9]{4,32})\/(cp_[a-z0-9_]{2,40})\/(start|d_[a-z0-9]{4,32})(?:\/(part|complete))?$/);
    if (up && method === "POST" && up[3] === "start" && !up[4]) return respond(await startUpload(request, env, up[1], up[2]));
    if (up && method === "PUT" && up[4] === "part") return respond(await uploadPart(request, env, up[1], up[2], up[3], url));
    if (up && method === "POST" && up[4] === "complete") return respond(await completeUpload(request, env, up[1], up[2], up[3]));
    if (up && method === "DELETE" && up[3] !== "start" && !up[4]) return respond(await abortUpload(env, up[1], up[2], up[3]));
    const ms = path.match(/^\/admin\/status\/(cl_[a-z0-9]{4,32})$/);
    if (ms && method === "PATCH") return respond(await setManualStatus(request, env, ms[1]));
    const ex = path.match(/^\/admin\/export\/(cl_[a-z0-9]{4,32})$/);
    if (ex && method === "GET") return respond(await exportClient(env, cfg, ex[1]));
    const lf = path.match(/^\/admin\/clients\/(cl_[a-z0-9]{4,32})\/left$/);
    if (lf && method === "POST") return respond(await setLeft(request, env, cfg, lf[1]));
    const er = path.match(/^\/admin\/clients\/(cl_[a-z0-9]{4,32})$/);
    if (er && method === "DELETE") return respond(await eraseNow(request, env, er[1]));
    const ai = path.match(/^\/admin\/intake\/(cl_[a-z0-9]{4,32})$/);
    if (ai && method === "GET") return respond(await getIntakeAdmin(env, ai[1]));
    /* V2 phase G1 */
    const dl = path.match(/^\/admin\/delivery\/(cl_[a-z0-9]{4,32})\/(cp_[a-z0-9_]{2,40})(?:\/(d_[a-z0-9]{4,32}))?$/);
    if (dl && method === "POST" && !dl[3]) return respond(await addDelivery(request, env, dl[1], dl[2], url));
    if (dl && method === "GET" && !dl[3]) return respond(await listDeliveries(env, dl[1], dl[2]));
    if (dl && method === "GET" && dl[3]) return respond(await getDelivery(env, dl[1], dl[2], dl[3]));
    if (dl && method === "DELETE" && dl[3]) return respond(await deleteDelivery(env, dl[1], dl[2], dl[3]));
    const bk = path.match(/^\/admin\/brandkit\/(cl_[a-z0-9]{4,32})$/);
    if (bk && method === "GET") return respond(await getBrandKit(env, bk[1]));
    if (bk && method === "PUT") return respond(await putBrandKit(request, env, bk[1]));
    /* V2 phase G2a */
    const pr = path.match(/^\/admin\/photo-requests\/(cl_[a-z0-9]{4,32})\/(cp_[a-z0-9_]{2,40})(?:\/(pr_[a-z0-9]{4,32}))?$/);
    if (pr && method === "POST" && !pr[3]) return respond(await sendPhotoRequests(request, env, cfg, ctx, pr[1], pr[2]));
    if (pr && method === "GET" && !pr[3]) return respond(await listPhotoRequestsAdmin(env, pr[1], pr[2]));
    if (pr && method === "DELETE" && pr[3]) return respond(await cancelPhotoRequest(env, pr[1], pr[2], pr[3]));
    /* V2 phase G2b */
    const pg = path.match(/^\/admin\/page\/(cl_[a-z0-9]{4,32})\/(cp_[a-z0-9_]{2,40})(?:\/(asset|publish|unpublish))?$/);
    if (pg && method === "GET" && !pg[3]) return respond(await getPageAdmin(env, cfg, pg[1], pg[2]));
    if (pg && method === "PUT" && !pg[3]) return respond(await putPageAdmin(request, env, cfg, pg[1], pg[2]));
    if (pg && method === "POST" && pg[3] === "asset") return respond(await putPageAsset(request, env, pg[1], pg[2], url));
    if (pg && method === "POST" && pg[3] === "publish") return respond(await publishPage(request, env, cfg, pg[1], pg[2]));
    if (pg && method === "POST" && pg[3] === "unpublish") return respond(await unpublishPage(env, cfg, pg[1], pg[2]));
    const roi = path.match(/^\/admin\/(stats|baseline|costs|leads)\/(cl_[a-z0-9]{4,32})\/(cp_[a-z0-9_]{2,40})$/);
    if (roi && method === "GET" && roi[1] === "stats") return respond(await getStats(env, cfg, roi[2], roi[3]));
    if (roi && method === "GET" && roi[1] === "baseline") return respond(await getBaseline(env, roi[2], roi[3]));
    if (roi && method === "PUT" && roi[1] === "baseline") return respond(await putBaseline(request, env, roi[2], roi[3]));
    if (roi && method === "GET" && roi[1] === "costs") return respond(await getCosts(env, roi[2], roi[3]));
    if (roi && method === "PUT" && roi[1] === "costs") return respond(await putCosts(request, env, roi[2], roi[3]));
    if (roi && method === "GET" && roi[1] === "leads") return respond(await adminLeads(env, roi[2], roi[3]));
  }

  return json({ error: "not_found", message: MSG.notFound }, 404);
}

export default {
  async fetch(request, env, ctx) {
    try {
      return await handle(request, env, ctx);
    } catch (e) {
      console.error("vault error: " + (e && e.message ? e.message : "unknown"));
      return json({ error: "server", message: MSG.server }, 500);
    }
  },
  async scheduled(event, env, ctx) {
    await ensureSchema(env);
    ctx.waitUntil(cleanup(env));
    ctx.waitUntil(teamCleanup(env).catch(() => console.error("team cleanup failed")));
    /* Phase 6: erase clients who left more than RETENTION_MONTHS ago. */
    ctx.waitUntil(retentionSweep(env, getConfig(env)).catch(() => console.error("retention sweep failed")));
    /* V2 phase G2b: raw events after 90 days, old salts, old enquiries, ended pages. */
    ctx.waitUntil(g2bSweep(env).catch(() => console.error("g2b sweep failed")));
    /* V2 Part E: unfinished uploads older than two days. */
    ctx.waitUntil(staleUploadSweep(env).catch(() => console.error("upload sweep failed")));
    /* V2 Part C: from the 20th, once a month, tell Harry who is due. */
    ctx.waitUntil(rhythmReminder(env, getConfig(env), event.scheduledTime || Date.now()).catch((e) => console.error("rhythm reminder failed: " + e.message)));
  }
};
