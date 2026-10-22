/* End to end test of the Share Your Brief Worker, run against wrangler dev (local D1 and R2). */
import assert from "node:assert/strict";

const EM = String.fromCharCode(0x2014);
const EN = String.fromCharCode(0x2013);

export async function run(base) {
  const origin = base;
  let passed = 0;
  const ok = (name) => { passed++; console.log("  ok  " + name); };

  async function api(method, path, { key, json, body, headers, cookie, noOrigin } = {}) {
    const h = Object.assign({}, headers || {});
    if (!noOrigin) h.Origin = origin;
    if (key) h["X-Project-Key"] = key;
    if (cookie) h.Cookie = cookie;
    let b = body;
    if (json !== undefined) { h["Content-Type"] = "application/json"; b = JSON.stringify(json); }
    const r = await fetch(base + "/api/brief" + path, { method, headers: h, body: b, redirect: "manual" });
    const ct = r.headers.get("content-type") || "";
    const data = ct.includes("json") ? await r.json() : await r.arrayBuffer();
    return { status: r.status, data, headers: r.headers };
  }
  const mails = async () => (await api("GET", "/_dev/mails")).data;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  async function mailWith(subjectPart, since = 0) {
    for (let i = 0; i < 30; i++) {
      const list = (await mails()).slice(since);
      const m = list.find((x) => x.subject.includes(subjectPart));
      if (m) return m;
      await wait(150);
    }
    throw new Error("mail not found: " + subjectPart);
  }

  const goodBrief = (over = {}) => Object.assign({
    brand: "Nordic Glow", contact_name: "Elin Berg", email: "elin@nordicglow.example", website: "https://nordicglow.example", socials: "@nordicglow",
    product: "Vitamin C face serum for sensitive skin", goal: "sales", audience: "Women 25 to 40 in Sweden who care about skincare", problem: "Dull skin and complicated routines",
    benefits: "Fragrance free, one step, visible glow in two weeks of use", platform: "tiktok", length: "15_30", delivery_date: "2027-01-15",
    guidelines: "Warm, honest tone", claims: "Do not say cure. Must say: results vary", package: "starter", notes: "Launch in spring", consent: true
  }, over);

  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]);
  const mp4 = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0, 1, 2, 3, 4]);

  /* ---------- static pages and meta ---------- */
  for (const p of ["/brief/", "/brief/studio", "/brief/studio/verify"]) {
    const r = await fetch(base + p);
    assert.equal(r.status, 200, p);
    assert.match(r.headers.get("content-security-policy"), /script-src 'self'/);
    assert.match(r.headers.get("x-robots-tag"), /noindex/);
    assert.match(await r.text(), /<html/);
  }
  for (const p of ["/brief/app.js", "/brief/app.css", "/brief/studio.js", "/brief/studio/verify.js"]) assert.equal((await fetch(base + p)).status, 200, p);
  ok("pages served with CSP and noindex");

  const meta = (await api("GET", "/meta")).data;
  assert.deepEqual(Object.keys(meta.packages), ["starter", "growth", "scale", "retainer"]);
  assert.match(meta.packages.starter.usage, /Organic social media usage plus 30-day paid advertising usage/);
  assert.equal(meta.changeRounds, 2);
  assert.ok(meta.fields.find((f) => f.key === "goal_other").showIf);
  ok("meta lists fields and the four packages");

  /* ---------- validation, origin, honeypot ---------- */
  let r = await api("POST", "/submit", { json: {} });
  assert.equal(r.status, 400);
  assert.ok(r.data.fields.brand && r.data.fields.email && r.data.fields.package && r.data.fields.consent);
  r = await api("POST", "/submit", { json: goodBrief({ email: "nope" }) });
  assert.equal(r.status, 400); assert.ok(r.data.fields.email);
  r = await api("POST", "/submit", { json: goodBrief({ consent: false }) });
  assert.ok(r.data.fields.consent);
  r = await api("POST", "/submit", { json: goodBrief({ goal: "other" }) });
  assert.ok(r.data.fields.goal_other, "goal_other required when goal is other");
  r = await api("POST", "/submit", { json: goodBrief({ package: "gold" }) });
  assert.ok(r.data.fields.package);
  r = await api("POST", "/submit", { json: goodBrief(), noOrigin: true });
  assert.equal(r.status, 403);
  r = await api("POST", "/submit", { json: goodBrief({ company_url: "http://spam" }) });
  assert.equal(r.status, 201); assert.equal(r.data.key, "pj_fake.fake");
  ok("validation, origin check and honeypot");

  /* ---------- a full project: intake ---------- */
  const since0 = (await mails()).length;
  r = await api("POST", "/submit", { json: goodBrief() });
  assert.equal(r.status, 201);
  const key = r.data.key;
  assert.match(key, /^pj_[a-z0-9]+\./);
  const id = key.split(".")[0];

  assert.equal((await api("GET", "/project")).status, 401);
  assert.equal((await api("GET", "/project", { key: key.slice(0, -2) + "xx" })).status, 401);
  assert.equal((await api("GET", "/project", { key: "pj_aaaaaaaaaa.zzzz" })).status, 401);
  ok("project needs its own key");

  r = await api("POST", "/files?name=product.png", { key, body: png, headers: { "Content-Type": "application/octet-stream" } });
  assert.equal(r.status, 201);
  r = await api("POST", "/files?name=fake.png", { key, body: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) });
  assert.equal(r.status, 415, "wrong magic bytes");
  r = await api("POST", "/files?name=evil.html", { key, body: new Uint8Array([60, 104, 62]) });
  assert.equal(r.status, 415, "html not accepted");
  r = await api("POST", "/files?name=demo.mp4", { key, body: mp4 });
  assert.equal(r.status, 201);
  ok("uploads: magic bytes and type allowlist");

  r = await api("GET", "/project", { key });
  assert.equal(r.data.project.status, "draft");
  assert.equal(r.data.files.assets.length, 2);

  r = await api("POST", "/finalize", { key, json: {} });
  assert.equal(r.status, 200);
  r = await api("POST", "/finalize", { key, json: {} });
  assert.equal(r.status, 200, "finalize is idempotent");
  const clientMail = await mailWith("Your AI UGC project: Nordic Glow", since0);
  assert.equal(clientMail.to, "elin@nordicglow.example");
  assert.match(clientMail.text, /\/brief\/#k=pj_/);
  const adminMail = await mailWith("New AI UGC Brief: Nordic Glow", since0);
  assert.equal(adminMail.to, "hej@tahastudiolabs.com");
  for (const needle of ["Vitamin C face serum", "Women 25 to 40", "Starter", "2027-01-15", "product.png", "demo.mp4", "Submitted"]) assert.ok(adminMail.text.includes(needle), "admin mail has " + needle);
  const sent = (await mails()).slice(since0);
  assert.equal(sent.filter((m) => m.subject.includes("Nordic Glow")).length, 2, "exactly two mails on submit (client link, admin alert)");
  ok("finalize sends the client link once and the full brief to hej@");

  r = await api("GET", "/project", { key });
  assert.equal(r.data.project.status, "brief_received");
  assert.equal(r.data.project.step, 1);
  assert.equal(r.data.production.locked, true);
  assert.equal(r.data.project.package.usage, "Organic social media usage plus 30-day paid advertising usage");
  assert.ok(r.data.messages.some((m) => m.kind === "brief"));
  ok("client dashboard state after intake");

  /* ---------- request link again ---------- */
  const s1 = (await mails()).length;
  r = await api("POST", "/request-link", { json: { email: "nobody@example.com" } });
  assert.equal(r.status, 200);
  const neutral = r.data.message;
  r = await api("POST", "/request-link", { json: { email: "elin@nordicglow.example" } });
  assert.equal(r.data.message, neutral, "same reply for known and unknown addresses");
  const again = await mailWith("Your private project link: Nordic Glow", s1);
  assert.ok(again.text.includes(key), "same link is re-sent");
  assert.ok(!(await mails()).slice(s1).some((m) => m.to === "nobody@example.com"));
  ok("request link again, neutral reply");

  /* ---------- studio sign in ---------- */
  assert.equal((await api("GET", "/admin/projects")).status, 401);
  assert.equal((await api("GET", "/admin/me")).status, 401);
  const s2 = (await mails()).length;
  r = await api("POST", "/admin/request-link", { json: { email: "stranger@example.com" } });
  assert.equal(r.status, 200);
  r = await api("POST", "/admin/request-link", { json: { email: "hej@tahastudiolabs.com" } });
  assert.equal(r.status, 200);
  const loginMail = await mailWith("studio sign-in link", s2);
  assert.equal((await mails()).slice(s2).filter((m) => m.subject.includes("studio sign-in")).length, 1, "only the admin address gets a link");
  const token = /#t=([A-Za-z0-9_-]+)/.exec(loginMail.text)[1];
  assert.ok(loginMail.text.includes("/brief/studio/verify#t="));
  r = await api("POST", "/admin/verify", { json: { token: "wrong" } });
  assert.equal(r.status, 400);
  r = await api("POST", "/admin/verify", { json: { token } });
  assert.equal(r.status, 200);
  const setCookie = r.headers.get("set-cookie");
  assert.match(setCookie, /__Host-ugc_admin=/); assert.match(setCookie, /HttpOnly/); assert.match(setCookie, /Secure/);
  const cookie = setCookie.split(";")[0];
  r = await api("POST", "/admin/verify", { json: { token } });
  assert.equal(r.status, 400, "magic link works once");
  assert.equal((await api("GET", "/admin/me", { cookie })).data.email, "hej@tahastudiolabs.com");
  ok("studio magic link: admin only, single use, secure cookie");

  const A = (method, path, opts = {}) => api(method, "/admin" + path, Object.assign({ cookie }, opts));
  r = await A("GET", "/projects");
  const row = r.data.projects.find((p) => p.id === id);
  assert.ok(row && row.needsYou && row.package === "Starter");
  assert.ok(!r.data.projects.some((p) => p.status === "draft"));
  r = await A("GET", "/projects/" + id);
  assert.equal(r.data.project.clientLink.includes(key), true);
  assert.ok(r.data.brief.some((b) => b.label === "Campaign goal" && b.value === "Sales"));
  assert.match(r.data.intro, /goal to drive sales/);
  ok("studio lists and opens the project");

  /* ---------- production lock ---------- */
  r = await A("POST", `/projects/${id}/start-production`, { json: {} });
  assert.equal(r.status, 409); assert.equal(r.data.error, "production_locked");
  r = await A("POST", `/projects/${id}/deliver`, { json: { videos: 1, link: "https://x.example/f" } });
  assert.equal(r.status, 409);
  ok("production and delivery locked before approval");

  /* ---------- proposals ---------- */
  const draft = (extra = {}) => Object.assign({
    hooks: ["Your skin is not dull, your routine is", "I tried one serum for two weeks", "Three steps are two too many"], recommended: 2,
    script: { hook: "I tried one serum for two weeks", problem: "My skin looked tired", solution: "One step, no fragrance", benefit: "A visible glow", cta: "Try it today" }
  }, extra);
  r = await A("POST", `/projects/${id}/proposals`, { json: draft({ hooks: ["a", "b"] }) });
  assert.equal(r.status, 400);
  r = await A("POST", `/projects/${id}/proposals`, { json: draft({ hooks: [`Hook one ${EM} with dash`, "Hook two guaranteed results", `Hook three ${EN} range`] }) });
  assert.equal(r.status, 201);
  assert.ok(r.data.warnings.includes("guaranteed"));
  const p1 = r.data.id;
  r = await A("GET", "/projects/" + id);
  const saved = r.data.proposals[0];
  assert.ok(!saved.hooks.join("").includes(EM) && !saved.hooks.join("").includes(EN), "dashes stripped on save");
  assert.equal((await api("GET", "/project", { key })).data.proposal, null, "drafts are invisible to the client");
  r = await A("PUT", "/proposals/" + p1, { json: draft({ hooks: ["Your skin is not dull, your routine is", "I tried one serum for two weeks", "Three steps are two too many"] }) });
  assert.equal(r.status, 200);
  r = await A("PUT", "/proposals/" + p1, { json: draft({ script: { hook: "x", problem: "p", solution: "s", benefit: "b", cta: "" } }) });
  assert.equal(r.status, 400);
  r = await A("POST", `/proposals/${p1}/publish`, { json: {} });
  assert.equal(r.status, 200);
  r = await api("GET", "/project", { key });
  assert.equal(r.data.project.status, "script_review");
  assert.equal(r.data.project.step, 2);
  assert.equal(r.data.proposal.version, 1);
  assert.equal(r.data.proposal.hooks.length, 3);
  assert.equal(r.data.proposal.recommended, 2);
  ok("proposal draft, lint, dash stripping, publish");

  /* warnings must be acknowledged */
  r = await A("POST", `/projects/${id}/proposals`, { json: draft({ hooks: ["Hook one", "Hook two is risk-free", "Hook three"] }) });
  const pw = r.data.id;
  r = await A("POST", `/proposals/${pw}/publish`, { json: {} });
  assert.equal(r.status, 409); assert.equal(r.data.error, "warnings");
  await A("PUT", "/proposals/" + pw, { json: draft({ hooks: ["Hook one v2", "Hook two v2", "Hook three v2"] }) });
  r = await A("POST", `/proposals/${pw}/publish`, { json: {} });
  assert.equal(r.status, 200);
  ok("flagged phrases must be acknowledged before publishing");

  /* ---------- client: changes, rounds, approval ---------- */
  r = await api("GET", "/project", { key });
  const v2 = r.data.proposal;
  assert.equal(v2.version, 2);
  r = await api("POST", "/approve", { key, json: { proposalId: "pp_nope123456", hook: 1, confirmScript: true } });
  assert.equal(r.status, 409, "stale proposal id");
  r = await api("POST", "/approve", { key, json: { proposalId: v2.id, hook: 7, confirmScript: true } });
  assert.equal(r.status, 400);
  r = await api("POST", "/approve", { key, json: { proposalId: v2.id, hook: 1 } });
  assert.equal(r.status, 400, "script confirmation required");
  r = await api("POST", "/changes", { key, json: { proposalId: v2.id, text: "" } });
  assert.equal(r.status, 400);
  r = await api("POST", "/changes", { key, json: { proposalId: v2.id, text: `Softer tone please ${EM} less salesy` } });
  assert.equal(r.status, 200);
  r = await api("GET", "/project", { key });
  assert.equal(r.data.project.status, "changes_requested");
  assert.equal(r.data.rounds.used, 1);
  assert.ok(!r.data.messages.map((m) => m.body).join("").includes(EM));
  r = await api("POST", "/approve", { key, json: { proposalId: v2.id, hook: 1, confirmScript: true } });
  assert.equal(r.status, 409, "cannot approve while changes are pending");
  ok("change request round 1 and approval guards");

  r = await A("POST", `/projects/${id}/proposals`, { json: draft({ hooks: ["Round two hook A", "Round two hook B", "Round two hook C"] }) });
  await A("POST", `/proposals/${r.data.id}/publish`, { json: {} });
  r = await api("GET", "/project", { key });
  const v3 = r.data.proposal;
  assert.equal(v3.version, 3);
  r = await api("POST", "/changes", { key, json: { proposalId: v3.id, text: "One more tweak to the call to action" } });
  assert.equal(r.status, 200);
  r = await A("POST", `/projects/${id}/proposals`, { json: draft({ hooks: ["Round three hook A", "Round three hook B", "Round three hook C"] }) });
  await A("POST", `/proposals/${r.data.id}/publish`, { json: {} });
  r = await api("GET", "/project", { key });
  const v4 = r.data.proposal;
  assert.equal(r.data.rounds.used, 2); assert.equal(r.data.rounds.left, 0);
  r = await api("POST", "/changes", { key, json: { proposalId: v4.id, text: "A third change should be refused" } });
  assert.equal(r.status, 409); assert.equal(r.data.error, "no_rounds");
  ok("two change rounds enforced");

  /* extra round granted by admin */
  r = await A("POST", `/projects/${id}/extra-round`, { json: {} });
  assert.equal(r.status, 200);
  r = await api("GET", "/project", { key });
  assert.equal(r.data.rounds.allowed, 3); assert.equal(r.data.rounds.left, 1);
  ok("admin can grant an extra concept round");

  /* approval */
  r = await api("POST", "/approve", { key, json: { proposalId: v4.id, hook: 2, confirmScript: true } });
  assert.equal(r.status, 200);
  r = await api("GET", "/project", { key });
  assert.equal(r.data.project.status, "approved");
  assert.equal(r.data.approval.hook, 2);
  assert.equal(r.data.approval.hookText, "Round three hook B");
  assert.equal(r.data.production.locked, false);
  assert.ok(r.data.approval.at);
  r = await api("POST", "/changes", { key, json: { proposalId: v4.id, text: "too late now" } });
  assert.equal(r.status, 409);
  ok("approval recorded with timestamp, unlocks production");

  /* ---------- production and delivery ---------- */
  r = await A("POST", `/projects/${id}/deliver`, { json: { videos: 1, link: "https://x.example/f" } });
  assert.equal(r.status, 409, "cannot deliver before production");
  r = await A("POST", `/projects/${id}/start-production`, { json: {} });
  assert.equal(r.status, 200);
  r = await A("POST", `/projects/${id}/deliver`, { json: { videos: 2 } });
  assert.equal(r.status, 400, "needs a file or link");
  r = await A("POST", `/projects/${id}/deliver`, { json: { videos: 2, link: "javascript:alert(1)" } });
  assert.equal(r.status, 400, "https links only");
  r = await A("POST", `/projects/${id}/files?name=final-1.mp4`, { body: mp4, headers: { "Content-Type": "application/octet-stream" } });
  assert.equal(r.status, 201);
  const fileId = r.data.file.id;
  r = await A("POST", `/projects/${id}/files?name=run.exe`, { body: mp4 });
  assert.equal(r.status, 415);
  const s3 = (await mails()).length;
  r = await A("POST", `/projects/${id}/deliver`, { json: { videos: 2, link: "https://drive.example/folder/abc", note: "Enjoy", notify: false } });
  assert.equal(r.status, 200);
  await wait(300);
  assert.equal((await mails()).length, s3, "no client email unless Notify is ticked");
  r = await api("GET", "/project", { key });
  assert.equal(r.data.project.status, "delivered");
  assert.equal(r.data.project.step, 3);
  const d = r.data.delivery;
  assert.equal(d.videos, 2); assert.equal(d.revisionOpen, true);
  const until = Date.parse(d.revisionUntil), deliveredAt = Date.parse(d.deliveredAt);
  assert.ok(Math.abs((until - deliveredAt) / 86400000 - 7) < 0.01, "7 day window");
  const msg = r.data.messages.filter((m) => m.kind === "delivery").pop().body;
  for (const needle of ["Hi Elin Berg,", "Your AI UGC video for Vitamin C face serum for sensitive skin is ready.", "Package: Starter", "Videos delivered: 2",
    "Approved hook used: Round three hook B", "Delivery link: https://drive.example/folder/abc", "one revision round", "within 7 days of delivery",
    "organic social media usage and 30-day paid advertising usage", "priced separately and agreed in writing"]) assert.ok(msg.includes(needle), "delivery message has: " + needle);
  assert.ok(!msg.includes(EM));
  ok("delivery message auto-fills from intake and package");

  /* client downloads */
  r = await api("GET", `/files/${fileId}`, { key });
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-disposition"), /attachment; filename="final-1.mp4"/);
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert.equal(new Uint8Array(r.data).length, mp4.length);
  r = await api("GET", `/files/${fileId}`);
  assert.equal(r.status, 401);
  /* another client cannot read this project's files */
  const other = (await api("POST", "/submit", { json: goodBrief({ brand: "Other Co", email: "o@other.example" }) })).data.key;
  r = await api("GET", `/files/${fileId}`, { key: other });
  assert.equal(r.status, 404);
  ok("downloads: attachment only, own project only");

  /* revisions */
  r = await api("POST", "/revision", { key, json: { text: "" } });
  assert.equal(r.status, 400);
  r = await api("POST", "/revision", { key, json: { text: "Please shorten the intro" } });
  assert.equal(r.status, 200);
  r = await api("POST", "/revision", { key, json: { text: "A second revision should be refused for Starter" } });
  assert.equal(r.status, 409);
  ok("starter gets one revision round");

  /* window closes after 7 days (growth package, 2 rounds) */
  async function flow(pkg, brand, email) {
    const k = (await api("POST", "/submit", { json: goodBrief({ package: pkg, brand, email }) })).data.key;
    const pid = k.split(".")[0];
    await api("POST", "/finalize", { key: k, json: {} });
    let q = await A("POST", `/projects/${pid}/proposals`, { json: draft() });
    await A("POST", `/proposals/${q.data.id}/publish`, { json: {} });
    const pr = (await api("GET", "/project", { key: k })).data.proposal;
    await api("POST", "/approve", { key: k, json: { proposalId: pr.id, hook: 1, confirmScript: true } });
    await A("POST", `/projects/${pid}/start-production`, { json: {} });
    await A("POST", `/projects/${pid}/deliver`, { json: { videos: 1, link: "https://drive.example/x" } });
    return { k, pid };
  }
  const g = await flow("growth", "Growth Co", "g@growth.example");
  r = await api("POST", "/_dev/backdate", { json: { id: g.pid, column: "revision_until", value: new Date(Date.now() - 3600000).toISOString() } });
  r = await api("POST", "/revision", { key: g.k, json: { text: "Too late for this one" } });
  assert.equal(r.status, 409);
  assert.equal((await api("GET", "/project", { key: g.k })).data.delivery.revisionOpen, false);
  r = await A("POST", `/projects/${g.pid}/extend-revisions`, { json: { days: 3 } });
  assert.equal(r.status, 200);
  r = await api("POST", "/revision", { key: g.k, json: { text: "Now inside the extended window" } });
  assert.equal(r.status, 200);
  r = await api("POST", "/revision", { key: g.k, json: { text: "Second round, growth has two" } });
  assert.equal(r.status, 200);
  r = await api("POST", "/revision", { key: g.k, json: { text: "Third round should be refused" } });
  assert.equal(r.status, 409);
  const gs = await A("GET", "/projects/" + g.pid);
  assert.equal(gs.data.project.package.revisionRounds, 2);
  ok("revision window closes after 7 days; growth gets two rounds; window can be extended");

  /* retainer and scale usage text */
  const sc = await flow("scale", "Scale Co", "s@scale.example");
  const scMsg = (await api("GET", "/project", { key: sc.k })).data.messages.filter((m) => m.kind === "delivery").pop().body;
  assert.ok(scMsg.includes("90-day paid advertising usage") && scMsg.includes("three revision rounds"));
  const rt = await flow("retainer", "Retainer Co", "r@ret.example");
  const rtMsg = (await api("GET", "/project", { key: rt.k })).data.messages.filter((m) => m.kind === "delivery").pop().body;
  assert.ok(rtMsg.includes("flexible monthly usage rights, including paid advertising usage") && rtMsg.includes("priority delivery"));
  ok("usage rights follow the package");

  /* ---------- messages and notify ---------- */
  const s4 = (await mails()).length;
  r = await api("POST", "/message", { key, json: { text: "Thank you, the videos look great" } });
  assert.equal(r.status, 200);
  const alert = await mailWith("Nordic Glow: sent a message", s4);
  assert.equal(alert.to, "hej@tahastudiolabs.com");
  assert.ok(!alert.text.includes("videos look great"), "alerts carry no client content");
  r = await A("POST", `/projects/${id}/messages`, { json: { text: "Glad you like them", notify: true } });
  assert.equal(r.status, 200);
  const nudge = await mailWith("Something is waiting in your dashboard", s4);
  assert.equal(nudge.to, "elin@nordicglow.example");
  assert.ok(!nudge.text.includes("Glad you like them"), "nudge carries no content");
  assert.ok(nudge.text.includes(key));
  ok("client message alerts Harry without content; notify sends a link only nudge");

  /* ---------- link reset, close, cron, erase ---------- */
  r = await A("POST", `/projects/${id}/reset-link`, { json: {} });
  assert.equal(r.status, 200);
  assert.equal((await api("GET", "/project", { key })).status, 401, "old link dead after reset");
  const newKey = /#k=(.+)$/.exec(r.data.clientLink)[1];
  assert.equal((await api("GET", "/project", { key: newKey })).status, 200);
  ok("reset link disables the old link");

  const draftKey = (await api("POST", "/submit", { json: goodBrief({ brand: "Late Co", email: "l@late.example" }) })).data.key;
  const draftId2 = draftKey.split(".")[0];
  await api("POST", "/_dev/backdate", { json: { id: draftId2, column: "created_at", value: new Date(Date.now() - 20 * 60000).toISOString() } });
  const s5 = (await mails()).length;
  await api("POST", "/_dev/sweep", { json: {} });
  const swept = await api("GET", "/project", { key: draftKey });
  assert.equal(swept.data.project.status, "brief_received");
  await mailWith("New AI UGC Brief: Late Co", s5);
  ok("cron sweep finalizes a draft whose browser never finished");

  r = await A("POST", `/projects/${id}/close`, { json: {} });
  assert.equal(r.status, 200);
  assert.equal((await api("GET", "/project", { key: newKey })).data.project.status, "closed");

  r = await A("DELETE", `/projects/${id}`);
  assert.equal(r.status, 200); assert.equal(r.data.filesRemoved, 3);
  assert.equal((await api("GET", "/project", { key: newKey })).status, 401);
  assert.equal((await A("GET", `/projects/${id}`)).status, 404);
  r = await A("GET", "/files/" + fileId);
  assert.equal(r.status, 404);
  ok("erase removes project, messages and files");

  /* ---------- sign out and no em dash anywhere ---------- */
  r = await api("POST", "/admin/logout", { cookie, json: {} });
  assert.equal(r.status, 200);
  assert.equal((await api("GET", "/admin/me", { cookie })).status, 401);
  for (const m of await mails()) assert.ok(!(m.subject + m.text + m.html).includes(EM) && !(m.subject + m.text + m.html).includes(EN), "no dash in mail: " + m.subject);
  ok("sign out ends the session; no dash characters in any email");

  console.log("\nAll " + passed + " checks passed.");
}
