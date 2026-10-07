/* V2 Part H: the TAHA team (language reviewers: Swedish, and since Markets step 2 Spanish).

   Admin:
   GET    /admin/team                     members, the clients each one works on
   POST   /admin/team/invite              {name, email, languages, agreementAt, clients:[]}
                                          languages: the ones they review (REVIEW_LANGUAGES)
   PATCH  /admin/team/:memberId           {clients, languages, agreementAt, active, resend}
   Team members sign in with a magic link like clients and Harry, but their links and sessions
   live in their own tables, and every reviewer endpoint checks that the item belongs to a
   client the member is assigned to. The invite only works once the confidentiality and data
   processing agreement is ticked as signed (agreementAt). Deactivating ends their sessions. */
import { composeReviewerInvite, composeReviewerLogin, sendMail } from "./mail.js";
import { getCookie, json, newId, normEmail, nowIso, nowMs, randomToken, readJson, sha256hex, validEmail } from "./util.js";
import { SESSION_COOKIE } from "./config.js";
import { REVIEW_LANGUAGES } from "../../../assets/growth-languages.js";

/* The languages a member reviews, as stored ("sv,es"). Unknown codes are dropped. */
export function cleanLanguages(list) {
  const out = (Array.isArray(list) ? list : []).filter((l, i, a) => REVIEW_LANGUAGES.includes(l) && a.indexOf(l) === i);
  return out.length ? out.join(",") : null;
}
const reviewsSwedish = (m) => String(m.languages || "sv").split(",").includes("sv");

const M = {
  badRequest: { sv: "Ogiltig förfrågan.", en: "Bad request." },
  notFound: { sv: "Hittades inte.", en: "Not found." },
  email: { sv: "Skriv en giltig e-postadress.", en: "Enter a valid email address." },
  taken: { sv: "Den e-postadressen används redan av en kund, av Harry eller av en annan i teamet.", en: "That email address is already used by a client, by Harry or by another team member." },
  agreement: { sv: "Bocka i att avtalet är underskrivet innan inbjudan skickas.", en: "Tick that the agreement is signed before the invite is sent." }
};
const all = async (env, sql, ...args) => (await env.DB.prepare(sql).bind(...args).all()).results || [];
const REVIEW_HOME = "/grow/review/";

export function memberOut(m, clients) {
  return {
    id: m.id,
    name: m.name,
    email: m.email,
    role: m.role,
    languages: String(m.languages || "sv").split(",").filter(Boolean),
    agreementAt: m.agreement_at || null,
    active: m.active === 1,
    createdAt: m.created_at,
    lastLoginAt: m.last_login_at || null,
    clients: clients || []
  };
}

export async function listTeam(env) {
  const members = await all(env, "SELECT * FROM team_members ORDER BY created_at ASC");
  const access = await all(env, "SELECT member_id, client_id FROM team_access");
  return json({ members: members.map((m) => memberOut(m, access.filter((a) => a.member_id === m.id).map((a) => a.client_id))) });
}

async function setAccess(env, memberId, clients) {
  if (!Array.isArray(clients)) return;
  const valid = (await all(env, "SELECT id FROM clients")).map((r) => r.id);
  const ids = clients.filter((c) => valid.includes(c)).slice(0, 200);
  const stmts = [env.DB.prepare("DELETE FROM team_access WHERE member_id = ?").bind(memberId)].concat(
    ids.map((c) => env.DB.prepare("INSERT OR IGNORE INTO team_access (member_id, client_id) VALUES (?, ?)").bind(memberId, c))
  );
  await env.DB.batch(stmts);
}

export async function sendMemberLink(env, cfg, member, invite) {
  const token = randomToken(32);
  const t = nowMs();
  await env.DB.prepare("INSERT INTO member_tokens (token_hash, member_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .bind(await sha256hex(token), member.id, t, t + cfg.tokenTtlMinutes * 60 * 1000).run();
  const link = cfg.siteOrigin + cfg.basePath + "/auth/verify#t=" + token;
  /* Swedish reviewers get the email Swedish first; the others English first. */
  const language = reviewsSwedish(member) ? "sv" : "en";
  const mail = invite ? composeReviewerInvite(cfg, { link, name: member.name, language }) : composeReviewerLogin(cfg, { link, name: member.name, language });
  await sendMail(cfg, env, { to: member.email, ...mail });
}

export async function inviteMember(request, env, cfg, ctx) {
  const b = await readJson(request, 8192);
  if (!b) return json({ error: "bad_request", message: M.badRequest }, 400);
  const name = String(b.name || "").replace(/\s+/g, " ").trim().slice(0, 120);
  const email = normEmail(b.email);
  if (!name) return json({ error: "bad_request", message: M.badRequest }, 400);
  if (!validEmail(email)) return json({ error: "invalid_email", message: M.email }, 400);
  const clash = (cfg.adminEmails || []).includes(email) ||
    (await env.DB.prepare("SELECT 1 FROM clients WHERE email = ?").bind(email).first()) ||
    (await env.DB.prepare("SELECT 1 FROM team_members WHERE email = ?").bind(email).first());
  if (clash) return json({ error: "taken", message: M.taken }, 409);
  const agreementAt = /^\d{4}-\d{2}-\d{2}/.test(String(b.agreementAt || "")) ? String(b.agreementAt).slice(0, 10) : null;
  const langs = cleanLanguages(Array.isArray(b.languages) ? b.languages : ["sv"]) || "sv";
  const id = newId("tm", 12);
  await env.DB.prepare("INSERT INTO team_members (id, name, email, role, languages, agreement_at, active, created_at) VALUES (?, ?, ?, 'reviewer', ?, ?, 1, ?)")
    .bind(id, name, email, langs, agreementAt, nowIso()).run();
  await setAccess(env, id, b.clients);
  const m = await env.DB.prepare("SELECT * FROM team_members WHERE id = ?").bind(id).first();
  let invited = false;
  if (agreementAt) {
    ctx.waitUntil(sendMemberLink(env, cfg, m, true).catch((e) => console.error("reviewer invite failed: " + e.message)));
    invited = true;
  }
  const clients = (await all(env, "SELECT client_id FROM team_access WHERE member_id = ?", id)).map((r) => r.client_id);
  return json({ ok: true, invited, member: memberOut(m, clients) }, 201);
}

export async function patchMember(request, env, cfg, ctx, memberId) {
  const m = await env.DB.prepare("SELECT * FROM team_members WHERE id = ?").bind(memberId).first();
  if (!m) return json({ error: "not_found", message: M.notFound }, 404);
  const b = await readJson(request, 8192);
  if (!b) return json({ error: "bad_request", message: M.badRequest }, 400);
  if ("agreementAt" in b) {
    const a = b.agreementAt && /^\d{4}-\d{2}-\d{2}/.test(String(b.agreementAt)) ? String(b.agreementAt).slice(0, 10) : null;
    await env.DB.prepare("UPDATE team_members SET agreement_at = ? WHERE id = ?").bind(a, memberId).run();
    if (!a) await env.DB.prepare("DELETE FROM member_sessions WHERE member_id = ?").bind(memberId).run();
  }
  if (typeof b.active === "boolean") {
    await env.DB.prepare("UPDATE team_members SET active = ? WHERE id = ?").bind(b.active ? 1 : 0, memberId).run();
    /* Deactivating ends every session at once; past edits stay, credited to them. */
    if (!b.active) await env.DB.batch([
      env.DB.prepare("DELETE FROM member_sessions WHERE member_id = ?").bind(memberId),
      env.DB.prepare("DELETE FROM member_tokens WHERE member_id = ?").bind(memberId)
    ]);
  }
  if (Array.isArray(b.clients)) await setAccess(env, memberId, b.clients);
  if (Array.isArray(b.languages)) {
    const langs = cleanLanguages(b.languages);
    if (!langs) return json({ error: "bad_request", message: M.badRequest }, 400);
    await env.DB.prepare("UPDATE team_members SET languages = ? WHERE id = ?").bind(langs, memberId).run();
  }
  const now = await env.DB.prepare("SELECT * FROM team_members WHERE id = ?").bind(memberId).first();
  let invited = false;
  if (b.resend) {
    if (!now.agreement_at) return json({ error: "agreement", message: M.agreement }, 409);
    if (now.active) {
      ctx.waitUntil(sendMemberLink(env, cfg, now, true).catch((e) => console.error("reviewer invite failed: " + e.message)));
      invited = true;
    }
  }
  const clients = (await all(env, "SELECT client_id FROM team_access WHERE member_id = ?", memberId)).map((r) => r.client_id);
  return json({ ok: true, invited, member: memberOut(now, clients) });
}

/* ---------- sign in ---------- */

/* Called by issueLoginLink when the email is neither Harry's nor a client's. */
export async function memberLoginLink(env, cfg, email) {
  const m = await env.DB.prepare("SELECT * FROM team_members WHERE email = ? AND active = 1 AND agreement_at IS NOT NULL").bind(email).first();
  if (!m) return false;
  await sendMemberLink(env, cfg, m, false);
  return true;
}

export async function consumeMemberToken(env, token) {
  if (!token || token.length > 100) return null;
  const t = nowMs();
  const row = await env.DB.prepare("UPDATE member_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ? RETURNING member_id")
    .bind(t, await sha256hex(token), t).first();
  if (!row) return null;
  const m = await env.DB.prepare("SELECT * FROM team_members WHERE id = ? AND active = 1 AND agreement_at IS NOT NULL").bind(row.member_id).first();
  return m || null;
}

export async function createMemberSession(env, cfg, member) {
  const token = randomToken(32);
  const t = nowMs();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO member_sessions (session_hash, member_id, created_at, expires_at, last_seen) VALUES (?, ?, ?, ?, ?)")
      .bind(await sha256hex(token), member.id, t, t + cfg.sessionDays * 86400 * 1000, t),
    env.DB.prepare("UPDATE team_members SET last_login_at = ? WHERE id = ?").bind(nowIso(), member.id)
  ]);
  return { token, redirect: REVIEW_HOME };
}

/* The member behind a session cookie, or null. */
export async function getMemberAuth(request, env) {
  const token = getCookie(request, SESSION_COOKIE);
  if (!token || token.length > 100) return null;
  const s = await env.DB.prepare(
    "SELECT s.member_id, m.email, m.name FROM member_sessions s JOIN team_members m ON m.id = s.member_id WHERE s.session_hash = ? AND s.expires_at > ? AND m.active = 1 AND m.agreement_at IS NOT NULL"
  ).bind(await sha256hex(token), nowMs()).first();
  if (!s) return null;
  return { role: "reviewer", memberId: s.member_id, email: s.email, name: s.name, clientId: null, via: "vault", setCookies: [] };
}

export async function destroyMemberSession(env, request) {
  const token = getCookie(request, SESSION_COOKIE);
  if (!token) return;
  await env.DB.prepare("DELETE FROM member_sessions WHERE session_hash = ?").bind(await sha256hex(token)).run();
}

export async function teamCleanup(env) {
  const t = nowMs();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM member_tokens WHERE expires_at < ?").bind(t - 86400 * 1000),
    env.DB.prepare("DELETE FROM member_sessions WHERE expires_at < ?").bind(t)
  ]);
}
