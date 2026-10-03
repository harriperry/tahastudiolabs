/* End to end test of Brain Vault phase 1 against a local `wrangler dev` instance.
   Start the Worker first with ENVIRONMENT=development, MAIL_PROVIDER=log,
   SITE_ORIGIN=http://localhost:8787, SCRIPTFORGE_ME_URL=http://127.0.0.1:8790/api/me,
   with its console output written to the file named in DEV_LOG. Then run:
     DEV_LOG=/path/to/dev.log node test/e2e.test.mjs
   The script starts a fake ScriptForge /api/me on port 8790 to test the admin bridge. */
import http from "node:http";
import fs from "node:fs";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const BASE = process.env.VAULT_URL || "http://127.0.0.1:8787/api/vault";
const ORIGIN = process.env.ORIGIN || "http://localhost:8787";
const DEV_LOG = process.env.DEV_LOG;
const ADMIN = "agborkak@gmail.com";
const run = Date.now().toString(36);
let pass = 0;
let fail = 0;

function ok(cond, name) {
  if (cond) {
    pass++;
    console.log("PASS " + name);
  } else {
    fail++;
    console.log("FAIL " + name);
  }
}

async function call(path, { method = "GET", body, cookie, origin = ORIGIN, ip } = {}) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (cookie) headers.Cookie = cookie;
  if (origin && method !== "GET") headers.Origin = origin;
  if (ip) headers["CF-Connecting-IP"] = ip;
  const r = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
  const text = await r.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch (e) {}
  return { status: r.status, data, text, headers: r.headers };
}

function sessionFrom(res) {
  const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  const c = sc.find((x) => x.startsWith("__Host-tv_session="));
  return c ? c.split(";")[0] : null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function linkFor(email, afterBytes) {
  for (let i = 0; i < 40; i++) {
    const log = fs.readFileSync(DEV_LOG).subarray(afterBytes).toString("utf8");
    const re = new RegExp("\\[dev mail\\] to=" + email.replace(/[.+]/g, "\\$&") + "[\\s\\S]*?#t=([A-Za-z0-9_-]+)", "g");
    let m;
    let last = null;
    while ((m = re.exec(log))) last = m[1];
    if (last) return last;
    await sleep(150);
  }
  return null;
}
const logSize = () => fs.statSync(DEV_LOG).size;

/* Fake ScriptForge /api/me */
let fakeEmail = ADMIN;
const fake = http.createServer((req, res) => {
  const c = req.headers.cookie || "";
  if (/sf_sid=good/.test(c)) {
    res.writeHead(200, { "Content-Type": "application/json", "Set-Cookie": "sf_at=refreshed; Path=/; HttpOnly; Secure; SameSite=Strict" });
    res.end(JSON.stringify({ email: fakeEmail, status: "active", tier: "pro" }));
  } else {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not signed in." }));
  }
});
await new Promise((r) => fake.listen(8790, "127.0.0.1", r));

try {
  /* Basics */
  let r = await call("/health");
  ok(r.status === 200 && r.data.ok && r.data.files, "health: D1 and R2 bound");
  r = await call("/schemas/intake");
  ok(r.status === 200 && r.data.$id.endsWith("/intake"), "schemas served");
  r = await call("/auth/request-link", { method: "POST", body: { email: ADMIN }, origin: null });
  ok(r.status === 403, "POST without Origin is refused");
  r = await call("/auth/request-link", { method: "POST", body: { email: ADMIN }, origin: "https://evil.example" });
  ok(r.status === 403, "POST from a foreign Origin is refused");
  r = await call("/auth/request-link", { method: "POST", body: { email: "not-an-email" }, ip: "10.0.0.1" });
  ok(r.status === 400 && r.data.message.sv && r.data.message.en, "invalid email gets bilingual 400");

  /* Uninvited email: neutral answer, no email */
  let mark = logSize();
  const stranger = "stranger-" + run + "@example.com";
  r = await call("/auth/request-link", { method: "POST", body: { email: stranger }, ip: "10.0.0.2" });
  const neutral = r.data && r.data.message;
  ok(r.status === 200 && neutral && neutral.sv && neutral.en, "uninvited email gets neutral bilingual message");
  ok((await linkFor(stranger, mark)) === null, "uninvited email receives no email");

  /* Admin magic link */
  mark = logSize();
  r = await call("/auth/request-link", { method: "POST", body: { email: ADMIN.toUpperCase() }, ip: "10.0.0.3" });
  ok(r.status === 200 && JSON.stringify(r.data.message) === JSON.stringify(neutral), "admin gets the same neutral message");
  const adminToken = await linkFor(ADMIN, mark);
  ok(!!adminToken, "admin magic link emailed");
  r = await fetch(BASE + "/auth/verify");
  ok(r.status === 200 && (r.headers.get("content-security-policy") || "").includes("script-src 'self'"), "verify page served with CSP");
  r = await call("/auth/verify", { method: "POST", body: { t: adminToken } });
  const adminCookie = sessionFrom(r);
  const rawSet = (r.headers.getSetCookie() || []).join(" | ");
  ok(r.status === 200 && r.data.role === "admin" && !!adminCookie, "admin link verifies and lands in admin role");
  ok(/HttpOnly/.test(rawSet) && /Secure/.test(rawSet) && /SameSite=Lax/.test(rawSet) && /Max-Age=2592000/.test(rawSet), "session cookie is HttpOnly, Secure, SameSite=Lax, 30 days");
  r = await call("/auth/verify", { method: "POST", body: { t: adminToken } });
  ok(r.status === 400, "second click on the same link is rejected");
  r = await call("/auth/me", { cookie: adminCookie });
  ok(r.status === 200 && r.data.role === "admin" && r.data.via === "vault", "me: admin via magic link");

  /* Invite a client */
  const clientEmail = "testclient-" + run + "@example.com";
  mark = logSize();
  r = await call("/admin/clients", { method: "POST", cookie: adminCookie, body: { name: "Test Kund AB", email: clientEmail, language: "sv" } });
  ok(r.status === 201 && r.data.emailSent && r.data.client.status === "invited", "admin invites a client, email sent");
  const clientId = r.data.client && r.data.client.id;
  const inviteToken = await linkFor(clientEmail, mark);
  ok(!!inviteToken, "invite email carries a magic link");
  const inviteText = fs.readFileSync(DEV_LOG).subarray(mark).toString("utf8");
  ok(/Välkommen/.test(inviteText) && /Welcome/.test(inviteText), "invite email is bilingual");
  ok(!/\u2014/.test(inviteText), "invite email has no em-dash");
  r = await call("/admin/clients", { method: "POST", cookie: adminCookie, body: { name: "Dup", email: clientEmail } });
  ok(r.status === 409, "duplicate client email refused");
  r = await call("/admin/clients", { method: "POST", cookie: adminCookie, body: { name: "Me", email: ADMIN } });
  ok(r.status === 400, "admin email cannot become a client");
  r = await call("/admin/clients", { cookie: adminCookie });
  ok(r.status === 200 && r.data.clients.some((c) => c.id === clientId), "admin lists clients");

  /* Client signs in */
  r = await call("/auth/verify", { method: "POST", body: { t: inviteToken } });
  const clientCookie = sessionFrom(r);
  ok(r.status === 200 && r.data.role === "client" && !!clientCookie, "client invite link lands in client role");
  r = await call("/auth/me", { cookie: clientCookie });
  ok(r.status === 200 && r.data.role === "client" && r.data.client.id === clientId && r.data.client.statusLabel.sv === "Inbjuden", "me: client sees own record");
  r = await call("/admin/clients", { cookie: clientCookie });
  ok(r.status === 403, "client cannot call admin endpoints");
  r = await call("/admin/clients");
  ok(r.status === 401, "anonymous cannot call admin endpoints");

  /* Client requests a fresh link later */
  mark = logSize();
  r = await call("/auth/request-link", { method: "POST", body: { email: clientEmail }, ip: "10.0.0.4" });
  const clientToken2 = await linkFor(clientEmail, mark);
  ok(r.status === 200 && !!clientToken2, "invited client can request a login link");

  /* Expiry: push the token's expiry into the past directly in local D1 */
  const hash = crypto.createHash("sha256").update(clientToken2).digest("hex");
  execFileSync(
    process.env.WRANGLER || "wrangler",
    ["d1", "execute", "brain-vault-db", "--local", "--persist-to", process.env.PERSIST || ".wrangler/state", "--command",
      "UPDATE login_tokens SET expires_at = 1 WHERE token_hash = '" + hash + "'"],
    { stdio: "ignore", cwd: process.env.WORKER_DIR || process.cwd() }
  );
  r = await call("/auth/verify", { method: "POST", body: { t: clientToken2 } });
  ok(r.status === 400, "expired link is rejected");

  /* Logout */
  r = await call("/auth/logout", { method: "POST", cookie: clientCookie, body: {} });
  ok(r.status === 200, "logout");
  r = await call("/auth/me", { cookie: clientCookie });
  ok(r.status === 401, "session gone after logout");

  /* ScriptForge bridge */
  r = await call("/auth/me", { cookie: "sf_sid=good; sf_at=x" });
  const bridged = (r.headers.getSetCookie() || []).join(" ");
  ok(r.status === 200 && r.data.role === "admin" && r.data.via === "scriptforge", "ScriptForge sign in grants admin");
  ok(/sf_at=refreshed/.test(bridged), "ScriptForge refreshed cookies are passed through");
  r = await call("/admin/clients", { cookie: "sf_sid=good" });
  ok(r.status === 200, "admin endpoints work through the ScriptForge session");
  r = await call("/auth/me", { cookie: "sf_sid=bad" });
  ok(r.status === 401, "invalid ScriptForge session is not admin");
  fakeEmail = "someone-else@example.com";
  r = await call("/admin/clients", { cookie: "sf_sid=good" });
  ok(r.status === 401, "a normal ScriptForge user gets nothing from the Vault");
  fakeEmail = ADMIN;

  /* Rate limits: 5 per email per hour */
  const rl = "ratelimit-" + run + "@example.com";
  const codes = [];
  for (let i = 0; i < 6; i++) {
    const x = await call("/auth/request-link", { method: "POST", body: { email: rl }, ip: "10.1." + i + ".1" });
    codes.push(x.status);
  }
  ok(codes.slice(0, 5).every((c) => c === 200) && codes[5] === 429, "6th request for one email in an hour is refused (" + codes.join(",") + ")");

  /* 20 per IP per hour */
  const ipBase = "10.9." + crypto.randomInt(1, 250) + "." + crypto.randomInt(1, 250);
  const ipCodes = [];
  for (let i = 0; i < 21; i++) {
    const x = await call("/auth/request-link", { method: "POST", body: { email: "ip" + i + "-" + run + "@example.com" }, ip: ipBase });
    ipCodes.push(x.status);
  }
  ok(ipCodes.slice(0, 20).every((c) => c === 200) && ipCodes[20] === 429, "21st request from one IP in an hour is refused");
  r = await call("/auth/request-link", { method: "POST", body: { email: rl }, ip: "10.1.0.1" });
  ok(r.status === 429 && r.data.message.sv && r.data.message.en, "rate limit message is bilingual");

  /* No secrets or tokens in Worker logs other than the dev mail lines */
  const fullLog = fs.readFileSync(DEV_LOG, "utf8");
  ok(!/sk-ant-|AIza/.test(fullLog), "no API keys in logs");
} finally {
  fake.close();
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
