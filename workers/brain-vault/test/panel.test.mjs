/* Phase 3 test: the Brain Vault endpoints behind the ScriptForge Growth Clients panel.
   Run against a local `wrangler dev` (MAIL_PROVIDER=log) that sits behind a local stand-in
   for tahastudiolabs.com, which also fakes ScriptForge's /api/me:
     cookie sf_sid=admin  -> agborkak@gmail.com (the admin, through the ScriptForge bridge)
     cookie sf_sid=user   -> someone@example.com (an ordinary public ScriptForge user)
     DEV_LOG=/path/to/dev.log VAULT_URL=http://127.0.0.1:8080/api/vault ORIGIN=http://localhost:8080 node test/panel.test.mjs */
import fs from "node:fs";
import crypto from "node:crypto";

const BASE = process.env.VAULT_URL || "http://127.0.0.1:8080/api/vault";
const ORIGIN = process.env.ORIGIN || "http://localhost:8080";
const DEV_LOG = process.env.DEV_LOG;
const run = Date.now().toString(36);
let pass = 0;
let fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("PASS " + n); } else { fail++; console.log("FAIL " + n); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nextIp = () => "10.60." + crypto.randomInt(1, 250) + "." + crypto.randomInt(1, 250);

async function call(path, { method = "GET", body, cookie, origin = ORIGIN, headers = {} } = {}) {
  const h = { Accept: "application/json", ...headers };
  if (body !== undefined) h["Content-Type"] = "application/json";
  if (cookie) h.Cookie = cookie;
  if (origin && method !== "GET") h.Origin = origin;
  const r = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
  const text = await r.text();
  let data = null;
  try { data = JSON.parse(text); } catch (e) {}
  return { status: r.status, data, text, headers: r.headers };
}
const logSize = () => fs.statSync(DEV_LOG).size;
async function linkFor(email, after) {
  for (let i = 0; i < 40; i++) {
    const log = fs.readFileSync(DEV_LOG).subarray(after).toString("utf8");
    const re = new RegExp("\\[dev mail\\] to=" + email.replace(/[.+]/g, "\\$&") + "[\\s\\S]*?#t=([A-Za-z0-9_-]+)", "g");
    let m, last = null;
    while ((m = re.exec(log))) last = m[1];
    if (last) return last;
    await sleep(150);
  }
  return null;
}
async function mailAfter(re, after) {
  for (let i = 0; i < 40; i++) {
    const log = fs.readFileSync(DEV_LOG).subarray(after).toString("utf8");
    const m = re.exec(log);
    if (m) return log.slice(m.index, m.index + 600);
    await sleep(150);
  }
  return null;
}
const cookieOf = (r) => ((r.headers.getSetCookie() || []).find((x) => x.startsWith("__Host-tv_session=")) || "").split(";")[0] || null;

const ADMIN_BRIDGE = "sf_sid=admin";
const PUBLIC_USER = "sf_sid=user";

function answers() {
  return {
    answerLanguage: "en",
    campaignLanguage: "en",
    profile: {
      companyName: "Panel Test Kitchen " + run,
      website: "instagram.com/paneltest",
      location: "Buea and environs",
      productService: "Home-cooked West African meals",
      targetAudience: "Busy students and executives",
      brandVoice: { text: "Friendly, direct", toneChips: ["warm", "direct"] },
      usp: "Hot, hygienic, a text away",
      offers: [{ offer: "Refer 10, get your next plate free", priceOrDiscount: "Next plate free", validUntil: "" }],
      competitors: [],
      reviews: { pasted: [], fileIds: [] },
      brandWords: { use: ["Comfort on your plate"], avoid: [] }
    },
    uploads: {
      pictures: [],
      founderStory: { text: "Paragraph one.\n\nParagraph two.", fileId: null },
      previousPosts: [{ type: "link", value: "https://instagram.com/paneltest" }],
      faqs: { rows: [], fileId: null }
    }
  };
}

try {
  /* 1. Public visitors and ordinary ScriptForge users see nothing. */
  let r = await call("/admin/check");
  ok(r.status === 200 && r.data.admin === false && Object.keys(r.data).length === 1, "anonymous visitor: admin/check says only admin:false");
  r = await call("/admin/check", { cookie: PUBLIC_USER });
  ok(r.status === 200 && r.data.admin === false, "public ScriptForge user: admin/check says admin:false");
  r = await call("/admin/clients");
  ok(r.status === 401 && !r.data.clients, "anonymous visitor: client list refused, no data");
  r = await call("/admin/clients", { cookie: PUBLIC_USER });
  ok(r.status === 401 && !r.data.clients, "public ScriptForge user: client list refused, no data");

  /* 2. The admin through the ScriptForge sign-in (bridge). */
  r = await call("/admin/check", { cookie: ADMIN_BRIDGE });
  ok(r.status === 200 && r.data.admin === true, "admin signed in to ScriptForge: admin/check says admin:true");
  r = await call("/admin/clients", { cookie: ADMIN_BRIDGE });
  ok(r.status === 200 && Array.isArray(r.data.clients) && typeof r.data.newCount === "number" && r.data.checkedAt, "admin: client list with newCount and checkedAt");

  /* 3. Invite from the panel. */
  const email = "panel-" + run + "@example.com";
  let mark = logSize();
  r = await call("/admin/clients", { method: "POST", cookie: ADMIN_BRIDGE, body: { name: "Panel Test Kitchen", email, language: "en" } });
  ok(r.status === 201 && r.data.emailSent === true && r.data.client.status === "invited", "invite from the panel creates the client and sends the email");
  const id = r.data.client.id;
  const tok = await linkFor(email, mark);
  ok(!!tok, "invite email carries a magic link");
  r = await call("/admin/clients", { method: "POST", cookie: ADMIN_BRIDGE, body: { name: "Again", email, language: "en" } });
  ok(r.status === 409 && r.data.clientId === id, "inviting the same email again returns 409 and the existing id");
  r = await call("/admin/clients", { method: "POST", cookie: ADMIN_BRIDGE, body: { name: "X", email, language: "en" }, origin: "https://evil.example" });
  ok(r.status === 403, "invite from another site is refused (origin check)");
  r = await call("/admin/clients", { cookie: ADMIN_BRIDGE });
  let c = r.data.clients.find((x) => x.id === id);
  ok(c && c.isNew === false && c.latestIntakeVersion === 0 && c.seenIntakeVersion === 0, "new client is listed, not New yet (nothing submitted)");
  r = await call("/admin/intake/" + id, { cookie: ADMIN_BRIDGE });
  ok(r.status === 200 && r.data.source === "none" && r.data.consent === null && Array.isArray(r.data.versions), "intake tab before the client starts: source none, no consent");

  /* 4. The client fills in and submits. */
  r = await call("/auth/verify", { method: "POST", body: { t: tok } });
  const client = cookieOf(r);
  ok(!!client, "client signs in with the invite link");
  r = await call("/admin/check", { cookie: client });
  ok(r.status === 200 && r.data.admin === false, "client session: admin/check says admin:false");
  r = await call("/admin/clients", { cookie: client });
  ok(r.status === 403 && !r.data.clients, "client session cannot list clients");
  r = await call("/admin/clients/" + id + "/seen", { method: "POST", cookie: client, body: { version: 1 } });
  ok(r.status === 403, "client session cannot mark seen");
  await call("/consent", { method: "POST", cookie: client, body: { accepted: true, language: "en" } });
  r = await call("/intake", { method: "PUT", cookie: client, body: answers() });
  ok(r.status === 200, "client draft saved");
  r = await call("/admin/intake/" + id, { cookie: ADMIN_BRIDGE });
  ok(r.data.source === "draft" && r.data.consent && r.data.consent.version === "c-1", "intake tab shows the draft and the consent record");

  mark = logSize();
  const t0 = Date.now();
  r = await call("/intake/submit", { method: "POST", cookie: client, body: {} });
  ok(r.status === 200 && r.data.intakeVersion === 1, "client submits intake v1");
  r = await call("/admin/clients", { cookie: ADMIN_BRIDGE });
  c = r.data.clients.find((x) => x.id === id);
  ok(c && c.isNew === true && c.status === "submitted" && c.latestIntakeVersion === 1 && c.latestSubmittedAt, "next poll: client shows New, Submitted, intake v1");
  ok(r.data.newCount >= 1, "newCount counts the new intake");
  ok(Date.now() - t0 < 60000, "submitted intake visible to ScriptForge well within 60 seconds");
  const notice = await mailAfter(/\[dev mail\] to=agborkak@gmail\.com subject=Ny inskickning \/ New intake/, mark);
  ok(!!notice, "Harry gets the new intake email");
  ok(notice && notice.includes("/scriptforge/#growth"), "the email links to the ScriptForge Growth Clients panel");
  ok(notice && !notice.includes("Home-cooked") && !notice.includes("Buea"), "the email has no client business content");

  /* 5. Harry opens the intake. */
  r = await call("/admin/intake/" + id, { cookie: ADMIN_BRIDGE });
  ok(r.status === 200 && r.data.source === "submitted" && r.data.version === 1 && r.data.intake.profile.location === "Buea and environs", "intake tab shows submitted v1, read only");
  ok(r.data.versions.length === 1 && r.data.versions[0].version === 1, "intake tab lists versions");
  ok(!JSON.stringify(r.data).match(/sk-ant|api[_-]?key/i), "no API key anywhere in the intake response");
  r = await call("/admin/clients/" + id + "/seen", { method: "POST", cookie: ADMIN_BRIDGE, body: { version: 1 } });
  ok(r.status === 200 && r.data.seenIntakeVersion === 1, "opening the intake marks v1 seen");
  r = await call("/admin/clients", { cookie: ADMIN_BRIDGE });
  c = r.data.clients.find((x) => x.id === id);
  ok(c.isNew === false && c.hasNewIntake === true, "New badge gone; brain still owed (hasNewIntake for phase 4)");
  r = await call("/admin/clients/" + id + "/seen", { method: "POST", cookie: ADMIN_BRIDGE, body: { version: 0 } });
  ok(r.status === 400, "seen with a bad version is refused");
  r = await call("/admin/clients/cl_doesnotexist/seen", { method: "POST", cookie: ADMIN_BRIDGE, body: { version: 1 } });
  ok(r.status === 404, "seen for an unknown client is 404");

  /* 6. A second submit makes it New again; seen never moves backwards. */
  await call("/intake", { method: "PUT", cookie: client, body: answers() });
  await call("/intake/submit", { method: "POST", cookie: client, body: {} });
  r = await call("/admin/clients", { cookie: ADMIN_BRIDGE });
  c = r.data.clients.find((x) => x.id === id);
  ok(c.isNew === true && c.latestIntakeVersion === 2, "intake v2 shows New again");
  r = await call("/admin/clients/" + id + "/seen", { method: "POST", cookie: ADMIN_BRIDGE, body: { version: 2 } });
  r = await call("/admin/clients/" + id + "/seen", { method: "POST", cookie: ADMIN_BRIDGE, body: { version: 1 } });
  ok(r.data.seenIntakeVersion === 2, "seen never moves backwards");
  r = await call("/admin/intake/" + id, { cookie: ADMIN_BRIDGE });
  ok(r.data.version === 2 && r.data.versions.length === 2, "intake tab shows v2 and keeps v1 in the version list");

  /* 7. Admin through a Vault magic link session (the console login) also works. */
  mark = logSize();
  await call("/auth/request-link", { method: "POST", body: { email: "agborkak@gmail.com" }, headers: { "CF-Connecting-IP": nextIp() } });
  const at = await linkFor("agborkak@gmail.com", mark);
  r = await call("/auth/verify", { method: "POST", body: { t: at } });
  const adminVault = cookieOf(r);
  r = await call("/admin/check", { cookie: adminVault });
  ok(r.data.admin === true, "admin with a Vault session: admin/check says admin:true");

  r = await call("/health");
  ok(r.data.phase >= 3, "health reports phase 3 or later");
} catch (e) {
  fail++;
  console.log("FAIL crashed: " + e.stack);
}
console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
