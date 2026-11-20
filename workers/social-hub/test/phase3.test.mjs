/* Phase 3 suite: Growth Department proposals and the client approval Inbox. No network. */
import { sent } from "../src/connectors/mock.js";
import { PANEL_JS } from "../src/panel.js";
import { expireProposals } from "../src/proposals.js";
import { processJob } from "../src/queue.js";
import { nowMs } from "../src/util.js";
import { call, counter, makeEnv, makeSession, seedClient } from "./helpers.mjs";

const { ok, done } = counter();
const realFetch = globalThis.fetch;
let mails = [];
let mailStatus = 200;
globalThis.fetch = async (url, init = {}) => {
  if (String(url).startsWith("https://api.resend.com/")) {
    mails.push(JSON.parse(init.body));
    return new Response("{}", { status: mailStatus });
  }
  throw new Error("unexpected network call: " + url);
};

async function setup(extra = {}) {
  const env = makeEnv({ RESEND_API_KEY: "re_test", ...extra });
  await seedClient(env, "cl_a", "a@example.com");
  await seedClient(env, "cl_b", "b@example.com");
  const a = await makeSession(env, { role: "client", clientId: "cl_a", email: "a@example.com" });
  const b = await makeSession(env, { role: "client", clientId: "cl_b", email: "b@example.com" });
  const admin = await makeSession(env, { role: "admin", email: "admin@example.com" });
  return { env, a, b, admin };
}
async function connect(env, cookie) {
  await call(env, "POST", "/consent", { cookie });
  const s = await call(env, "POST", "/oauth/start", { cookie, body: { platform: "mock" } });
  const state = new URL(s.data.url).searchParams.get("state");
  const cb = await call(env, "GET", "/oauth/callback/mock?state=" + state + "&code=good-pg1", { cookie });
  return cb.data.accountId;
}
const propose = (env, admin, items, clientId = "cl_a") => call(env, "POST", "/proposals", { cookie: admin, body: { clientId, items } });
const item = (over = {}) => ({ platform: "mock", body: "Secret campaign text SC-1", ...over });
const inFuture = (ms = 3600000) => nowMs() + ms;

/* 1. Schema and migration */
{
  const { env } = await setup();
  await call(env, "GET", "/health");
  const r = await propose(env, (await makeSession(env, { role: "admin", email: "admin@example.com" })), [item()]);
  ok(r.status === 200 && r.data.ids.length === 1, "schema is applied and a proposal can be stored");
  const m = await env.DB.prepare("SELECT COUNT(*) n FROM social_migrations").first();
  ok(m.n === 3, "three social migrations are recorded");
}

/* 2. Creating proposals: roles, validation, all or nothing, cap, tenant */
{
  const { env, a, b, admin } = await setup();
  ok((await propose(env, a, [item()])).status === 403, "a client cannot create proposals");
  ok((await call(env, "POST", "/proposals", { body: { clientId: "cl_a", items: [item()] } })).status === 401, "no session is refused");
  ok((await propose(env, admin, [])).status === 400, "an empty batch is refused");
  ok((await propose(env, admin, Array.from({ length: 21 }, () => item()))).status === 400, "more than 20 in one batch is refused");
  const r = await propose(env, admin, [item(), { platform: "instagram", body: "no image" }]);
  ok(r.status === 400 && r.data.error === "media_required" && r.data.index === 1, "Instagram without an image is refused and names the item");
  const n0 = await env.DB.prepare("SELECT COUNT(*) n FROM social_proposals").first();
  ok(n0.n === 0, "a batch with one bad item stores nothing");
  ok((await propose(env, admin, [item({ mediaUrl: "http://x.test/a.jpg" })])).data.error === "bad_url", "a non https image is refused");
  ok((await propose(env, admin, [item({ platform: "tiktok" })])).status === 400, "an unknown platform is refused");
  ok((await propose(env, admin, [item({ body: "x".repeat(5001) })])).status === 400, "an over long text is refused");
  ok((await propose(env, admin, [item()], "cl_missing")).status === 404, "an unknown client is refused");
  ok((await propose(env, admin, [item({ suggestedRunAt: nowMs() - 3600000 })])).data.error === "bad_time", "a suggested time in the past is refused");
  ok((await propose(env, admin, [item({ accountId: "sa_nope" })])).data.error === "account_unavailable", "a suggested account that is not the client's is refused");
  const okIg = await propose(env, admin, [{ platform: "instagram", body: "with image", mediaUrl: "https://media.example.com/a.jpg" }]);
  ok(okIg.status === 200, "Instagram with an https image is accepted");
  const capEnv = (await setup({ SOCIAL_MAX_PENDING: "3" }));
  await propose(capEnv.env, capEnv.admin, [item(), item()]);
  ok((await propose(capEnv.env, capEnv.admin, [item(), item()])).status === 409, "the pending cap per client is enforced");
}

/* 3. Notification email */
{
  const { env, admin } = await setup();
  mails = [];
  const r = await propose(env, admin, [item(), item()]);
  ok(r.data.notified === true && mails.length === 1, "one email per batch, not per post");
  const m = mails[0];
  ok(m.to[0] === "a@example.com" && /hej@tahastudiolabs.com/.test(m.from), "email goes to the client from hej@tahastudiolabs.com");
  ok(!/SC-1|Secret campaign/.test(JSON.stringify(m)), "the email never contains post text");
  ok(!/[\u2013\u2014]/.test(JSON.stringify(m)), "the email has no em-dashes");
  ok(/Granska/.test(m.text) && /Review the posts/.test(m.text), "the email is in Swedish and English");
  ok(/\/api\/vault\/social\/panel/.test(m.text), "the email links to the panel");
  mailStatus = 500;
  const r2 = await propose(env, admin, [item()]);
  mailStatus = 200;
  ok(r2.status === 200 && r2.data.notified === false, "a failed email never blocks creating the proposals");
  const noKey = await setup({ RESEND_API_KEY: undefined });
  mails = [];
  const r3 = await propose(noKey.env, noKey.admin, [item()]);
  ok(r3.status === 200 && r3.data.notified === false && mails.length === 0, "no mail key means no send and no failure");
}

/* 4. Inbox visibility and tenant isolation */
{
  const { env, a, b, admin } = await setup();
  const r = await propose(env, admin, [item()]);
  const pid = r.data.ids[0];
  const sa = await call(env, "GET", "/status", { cookie: a });
  ok(sa.data.proposals.length === 1 && sa.data.proposals[0].id === pid, "the client sees their proposal");
  const sb = await call(env, "GET", "/status", { cookie: b });
  ok(sb.data.proposals.length === 0, "another client sees none");
  const cross = await call(env, "POST", "/proposals/decide", { cookie: b, body: { proposalId: pid, action: "reject" } });
  ok(cross.status === 404, "another client cannot decide it");
  const adm = await call(env, "POST", "/proposals/decide", { cookie: admin, body: { clientId: "cl_a", proposalId: pid, action: "approve" } });
  ok(adm.status === 403, "an admin can never approve");
  const st = await env.DB.prepare("SELECT status FROM social_proposals WHERE id = ?").bind(pid).first();
  ok(st.status === "pending", "it is still pending after those attempts");
}

/* 5. Approve: version, job, edits, refusals leave it pending */
{
  const { env, a, admin } = await setup();
  const accId = await connect(env, a);
  const r = await propose(env, admin, [item({ accountId: accId, suggestedRunAt: inFuture() }), item(), item(), item()]);
  const [p1, p2, p3, p4] = r.data.ids;

  const ap = await call(env, "POST", "/proposals/decide", { cookie: a, body: { proposalId: p1, action: "approve" } });
  ok(ap.status === 200 && ap.data.jobId && ap.data.versionId, "approve with the suggested account and time creates a job");
  const v = await env.DB.prepare("SELECT * FROM social_versions WHERE id = ?").bind(ap.data.versionId).first();
  ok(v.status === "approved" && v.approved_by === "a@example.com" && v.created_by === "admin@example.com", "the version records the admin as author and the client as approver");
  ok(v.body === "Secret campaign text SC-1", "the approved text is the proposed text");
  const j = await env.DB.prepare("SELECT status, account_id FROM social_jobs WHERE id = ?").bind(ap.data.jobId).first();
  ok(j.status === "scheduled" && j.account_id === accId, "the job is scheduled on the chosen account");
  const again = await call(env, "POST", "/proposals/decide", { cookie: a, body: { proposalId: p1, action: "approve" } });
  ok(again.status === 409, "approving twice is refused");
  const jobs = await env.DB.prepare("SELECT COUNT(*) n FROM social_jobs").first();
  ok(jobs.n === 1, "a repeated approval never creates a second job");

  const ed = await call(env, "POST", "/proposals/decide", { cookie: a, body: { proposalId: p2, action: "approve", accountId: accId, runAt: inFuture(), body: "Edited by the client" } });
  const ev = await env.DB.prepare("SELECT body FROM social_versions WHERE id = ?").bind(ed.data.versionId).first();
  const ep = await env.DB.prepare("SELECT body, edited FROM social_proposals WHERE id = ?").bind(p2).first();
  ok(ev.body === "Edited by the client" && ep.edited === 1 && ep.body === "Secret campaign text SC-1", "an edit publishes the edited text and keeps the original on record");

  const noAcc = await call(env, "POST", "/proposals/decide", { cookie: a, body: { proposalId: p3, action: "approve", runAt: inFuture() } });
  ok(noAcc.status === 400 && noAcc.data.error === "account_unavailable", "approve without an account is refused");
  const badT = await call(env, "POST", "/proposals/decide", { cookie: a, body: { proposalId: p3, action: "approve", accountId: accId, runAt: nowMs() - 3600000 } });
  ok(badT.data.error === "bad_time", "approve with a past time is refused");
  const empty = await call(env, "POST", "/proposals/decide", { cookie: a, body: { proposalId: p3, action: "approve", accountId: accId, runAt: inFuture(), body: "   " } });
  ok(empty.status === 400, "approve with an emptied text is refused");
  const still = await env.DB.prepare("SELECT status FROM social_proposals WHERE id = ?").bind(p3).first();
  ok(still.status === "pending", "every refusal leaves the proposal pending");
  const n = await env.DB.prepare("SELECT COUNT(*) n FROM social_versions").first();
  ok(n.n === 2, "a refusal leaves no stray version behind");

  const un = await setup();
  const accU = await connect(un.env, un.a);
  await un.env.DB.prepare("DELETE FROM social_consents").run();
  const rr = await propose(un.env, un.admin, [item({ accountId: accU, suggestedRunAt: inFuture() })]);
  const nc = await call(un.env, "POST", "/proposals/decide", { cookie: un.a, body: { proposalId: rr.data.ids[0], action: "approve" } });
  ok(nc.status === 409 && nc.data.error === "consent_required", "approve without consent is refused");

  const wrong = await setup();
  const accW = await connect(wrong.env, wrong.a);
  const rw = await propose(wrong.env, wrong.admin, [{ platform: "facebook", body: "fb text" }]);
  const pm = await call(wrong.env, "POST", "/proposals/decide", { cookie: wrong.a, body: { proposalId: rw.data.ids[0], action: "approve", accountId: accW, runAt: inFuture() } });
  ok(pm.data.error === "platform_mismatch", "approving onto an account of another platform is refused");
}

/* 6. Changes, reject, withdraw, expiry */
{
  const { env, a, admin } = await setup();
  const r = await propose(env, admin, [item(), item(), item(), item()]);
  const [c1, c2, c3, c4] = r.data.ids;
  ok((await call(env, "POST", "/proposals/decide", { cookie: a, body: { proposalId: c1, action: "changes" } })).data.error === "note_required", "request changes needs a note");
  mails = [];
  const ch = await call(env, "POST", "/proposals/decide", { cookie: a, body: { proposalId: c1, action: "changes", note: "Shorter please" } });
  ok(ch.data.status === "changes_requested", "request changes is recorded");
  ok(mails.length === 1 && mails[0].to[0] === "admin@example.com" && !/Shorter|SC-1/.test(JSON.stringify(mails[0])), "the team is told, with no post text in the email");
  const rj = await call(env, "POST", "/proposals/decide", { cookie: a, body: { proposalId: c2, action: "reject" } });
  ok(rj.data.status === "rejected", "reject is recorded");
  ok((await call(env, "POST", "/proposals/decide", { cookie: a, body: { proposalId: c2, action: "approve", accountId: "x", runAt: inFuture() } })).status === 409, "a rejected proposal cannot be approved");
  ok((await call(env, "POST", "/proposals/withdraw", { cookie: a, body: { proposalId: c3 } })).status === 403, "a client cannot withdraw");
  ok((await call(env, "POST", "/proposals/withdraw", { cookie: admin, body: { clientId: "cl_a", proposalId: c3 } })).status === 200, "an admin can withdraw a pending proposal");
  ok((await call(env, "POST", "/proposals/decide", { cookie: a, body: { proposalId: c3, action: "reject" } })).status === 409, "a withdrawn proposal can no longer be decided");
  ok((await call(env, "POST", "/proposals/decide", { cookie: a, body: { proposalId: c4, action: "bogus" } })).status === 400, "an unknown action is refused");

  await env.DB.prepare("UPDATE social_proposals SET expires_at = ? WHERE id = ?").bind(nowMs() - 1000, c4).run();
  const lst = await call(env, "GET", "/status", { cookie: a });
  ok(lst.data.proposals.find((p) => p.id === c4).status === "expired", "an overdue proposal shows as expired");
  const ex = await call(env, "POST", "/proposals/decide", { cookie: a, body: { proposalId: c4, action: "reject" } });
  ok(ex.status === 409 && ex.data.error === "expired", "an expired proposal cannot be decided");
  ok((await expireProposals(env)) === 0, "the sweep finds nothing left once it is marked");
  const r5 = await propose(env, admin, [item()]);
  await env.DB.prepare("UPDATE social_proposals SET expires_at = ? WHERE id = ?").bind(nowMs() - 1000, r5.data.ids[0]).run();
  ok((await expireProposals(env)) === 1, "the sweep expires an unanswered proposal");
  const none = await env.DB.prepare("SELECT COUNT(*) n FROM social_jobs").first();
  ok(none.n === 0, "no job was ever created by an expired or rejected proposal");
}

/* 7. The engine rules still apply after approval */
{
  const { env, a, admin } = await setup();
  const accId = await connect(env, a);
  const r = await propose(env, admin, [item({ accountId: accId })]);
  const ap = await call(env, "POST", "/proposals/decide", { cookie: a, body: { proposalId: r.data.ids[0], action: "approve", runAt: nowMs() + 1 } });
  const later = nowMs() + 5000;
  sent.length = 0;
  ok((await processJob(env, ap.data.jobId, later)).startsWith("held:not_enabled"), "an approved proposal still does not publish while the client is switched off");
  ok(sent.length === 0, "nothing was sent");
  await call(env, "POST", "/admin/client", { cookie: admin, body: { clientId: "cl_a", enabled: true } });
  ok((await processJob(env, ap.data.jobId, later)) === "published" && sent.length === 1, "once enabled, the approved post publishes");
}

/* 8. Audit and panel */
{
  const { env, a, admin } = await setup();
  const accId = await connect(env, a);
  const r = await propose(env, admin, [item({ accountId: accId, suggestedRunAt: inFuture() })]);
  await call(env, "POST", "/proposals/decide", { cookie: a, body: { proposalId: r.data.ids[0], action: "approve" } });
  const logs = (await env.DB.prepare("SELECT action, detail FROM social_audit").all()).results;
  const acts = logs.map((l) => l.action);
  ok(["proposals_created", "proposals_notified", "proposal_approved", "job_scheduled"].every((x) => acts.includes(x)), "creation, notice, approval and scheduling are all audited");
  ok(!/SC-1|Secret campaign/.test(JSON.stringify(logs)), "the audit log never holds post text");
  ok(typeof PANEL_JS === "string" && !/[\u2013\u2014]/.test(PANEL_JS), "the panel has no em-dashes");
  let parses = true;
  try { new Function(PANEL_JS); } catch (e) { parses = false; }
  ok(parses, "the panel script parses");
  ok(/inboxH/.test(PANEL_JS) && /proposals\/decide/.test(PANEL_JS) && /proposeH/.test(PANEL_JS), "the panel has the Inbox and the admin composer");
}

globalThis.fetch = realFetch;
done();
