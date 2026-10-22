/* Share Your Brief: the single hub for every AI UGC client.
   Routed on ugc.tahastudiolabs.com:
     /brief          the client page (intake form, or the private dashboard when a link key is present)
     /brief/studio   the hidden studio (admin), magic link sign-in for addresses in ADMIN_EMAILS
     /api/brief/*    the API

   House rules enforced here:
   1. No LLM key is ever received, stored or logged. Hooks and scripts are written by Harry and pasted in.
   2. Client endpoints accept only the project's own key; studio endpoints need the admin session.
   3. Every state changing request must come from this site itself (Origin check).
   4. Production cannot start before the client approves one hook and one script (server enforced).
   5. No em dashes in anything saved or sent. */
import { getConfig } from "./config.js";
import { ensureSchema } from "./db.js";
import {
  allow, adminCookie, clearAdminCookie, cleanup, consumeToken, createSession, destroySession, getAdmin, isAdminEmail, issueAdminLink
} from "./auth.js";
import {
  approve, downloadClientFile, finalize, getProject, ipOf, meta, postClientMessage, requestChanges, requestLink, requestRevision, submitBrief,
  sweepDrafts, uploadAsset
} from "./projects.js";
import {
  adminMessage, closeProject, createProposal, deleteFile, deliver, downloadAdminFile, eraseProject, extendRevisions, getProjectAdmin,
  grantExtraRound, listProjects, publishProposal, resetLink, startProduction, updateProposal, uploadDeliveryFile
} from "./admin.js";
import { devMailList } from "./mail.js";
import { json, normEmail, readJson, validEmail, withCookies } from "./util.js";

import briefHtml from "./public/brief.html";
import briefJs from "./public/brief.js";
import briefCss from "./public/brief.css";
import studioHtml from "./public/studio.html";
import studioJs from "./public/studio.js";
import verifyHtml from "./public/verify.html";
import verifyJs from "./public/verify.js";

const BASE = "/api/brief";

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
    headers: { "Content-Type": type, "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex" }
  });
}

function sameOrigin(request, cfg) {
  const origin = request.headers.get("Origin");
  if (origin === cfg.siteOrigin) return true;
  return (!origin || origin === "null") && request.headers.get("Sec-Fetch-Site") === "same-origin";
}

const NEUTRAL_ADMIN = "If that address can sign in, a link is on its way. Check your inbox.";

function servePage(path) {
  switch (path) {
    case "/brief/app.js": return asset(briefJs, "text/javascript; charset=utf-8");
    case "/brief/app.css": return asset(briefCss, "text/css; charset=utf-8");
    case "/brief/studio.js": return asset(studioJs, "text/javascript; charset=utf-8");
    case "/brief/studio/verify.js": return asset(verifyJs, "text/javascript; charset=utf-8");
    case "/brief/studio/verify": return page(verifyHtml);
    case "/brief/studio": return page(studioHtml);
    default: return page(briefHtml);
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

  /* Development only helpers. Refused outside the local environment. */
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
    if (path === "/_dev/sweep" && method === "POST") { await sweepDrafts(env, cfg, ctx); return json({ ok: true }); }
    return json({ error: "not_found" }, 404);
  }

  await ensureSchema(env);
  const changing = method === "POST" || method === "PUT" || method === "DELETE";
  if (changing && !sameOrigin(request, cfg)) return json({ error: "bad_origin", message: "Request refused." }, 403);

  /* ----- public / client ----- */
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

  /* ----- studio sign in ----- */
  if (method === "POST" && path === "/admin/request-link") {
    const b = await readJson(request, 2 * 1024);
    const email = b ? normEmail(b.email) : "";
    if (!validEmail(email)) return json({ error: "email", message: "Enter a valid email address." }, 400);
    if (!(await allow(env, "admin-ip:" + ipOf(request), 10)) || !(await allow(env, "admin-email:" + email, 5)))
      return json({ error: "rate_limited", message: "Too many attempts. Please wait a while and try again." }, 429);
    /* Same answer and same work for every address, so nobody can probe who is an admin. */
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

  /* ----- studio (admin session required) ----- */
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
        if (sub === "start-production") return startProduction(env, cfg, ctx, id, (await readJson(request, 1024)) || {});
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

export default {
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
