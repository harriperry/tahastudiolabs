/* V2 Part E test: client video uploads. The clip length read from MP4 and MOV headers, start
   checks (type, 200 MB, 60 s, 10 clips, consent), parts of the right size, continuing after a
   dropped connection, refusing a 61 second clip after upload, Harry's download, removal, the
   daily sweep of unfinished uploads, the consent text, export and erasure.
   Same local setup as review.test.mjs (started by test/run-all.mjs). */
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { durationFromMoov, durationOf, looksLikeMp4 } from "../src/mp4.js";

const BASE = process.env.VAULT_URL || "http://127.0.0.1:8080/api/vault";
const ORIGIN = process.env.ORIGIN || "http://localhost:8080";
const SITE = ORIGIN.replace("localhost", "127.0.0.1");
const DEV_LOG = process.env.DEV_LOG;
const run = Date.now().toString(36);
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("PASS " + n); } else { fail++; console.log("FAIL " + n); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function call(path, { method = "GET", body, raw, headers = {}, cookie, origin = ORIGIN, abs } = {}) {
  const h = Object.assign({ Accept: "application/json" }, headers);
  if (body !== undefined) h["Content-Type"] = "application/json";
  if (cookie) h.Cookie = cookie;
  if (origin && method !== "GET") h.Origin = origin;
  /* Retried only when the connection itself drops: the local server can restart for a moment
     right after the test reads or writes its database directly. App errors are never retried. */
  let r;
  for (let i = 0; ; i++) {
    try {
      r = await fetch(abs || BASE + path, { method, headers: h, body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
      break;
    } catch (e) {
      if (i >= 8) throw e;
      await sleep(1000);
    }
  }
  const text = await r.text();
  let data = null;
  try { data = JSON.parse(text); } catch (e) {}
  return { status: r.status, data, text, headers: r.headers };
}
const logSize = () => fs.statSync(DEV_LOG).size;
async function mailAfter(re, after) {
  for (let i = 0; i < 40; i++) {
    const log = fs.readFileSync(DEV_LOG).subarray(after).toString("utf8");
    const m = log.match(re);
    if (m) return log.slice(m.index, m.index + 1500);
    await sleep(150);
  }
  return null;
}
async function linkFor(email, after) {
  for (let i = 0; i < 40; i++) {
    const log = fs.readFileSync(DEV_LOG).subarray(after).toString("utf8");
    const m = [...log.matchAll(new RegExp("\\[dev mail\\] to=" + email.replace(/[.+]/g, "\\$&") + "[\\s\\S]*?#t=([A-Za-z0-9_-]+)", "g"))];
    if (m.length) return m.at(-1)[1];
    await sleep(150);
  }
  return null;
}
function sql(command) {
  for (let i = 0; i < 3; i++) {
    try {
      const out = execFileSync(process.env.WRANGLER || "wrangler", ["d1", "execute", "brain-vault-db", "--local", "--persist-to", process.env.PERSIST || ".wrangler/state", "--json", "--command", command], { encoding: "utf8", cwd: process.env.WORKER_DIR || process.cwd() });
      return JSON.parse(out)[0].results;
    } catch (e) {
      if (i === 2) throw e;
    }
  }
}
const read = (p) => JSON.parse(fs.readFileSync(new URL(p, import.meta.url)));
const ADMIN = "sf_sid=admin";
const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000" + "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082", "hex");
const cookieOf = (r) => (r.headers.getSetCookie().find((x) => x.startsWith("__Host-tv_session=")) || "").split(";")[0];

async function newClient(name, language, withBrain = true) {
  const email = "vd-" + name.toLowerCase().replace(/[^a-z]+/g, "-") + "-" + run + "@example.com";
  const mark = logSize();
  let r = await call("/admin/clients", { method: "POST", cookie: ADMIN, body: { name, email, language: "sv" } });
  const id = r.data.client.id;
  r = await call("/auth/verify", { method: "POST", body: { t: await linkFor(email, mark) } });
  const cookie = cookieOf(r);
  await call("/consent", { method: "POST", cookie, body: { accepted: true, language: "sv" } });
  r = await call("/uploads?section=pictures", { method: "POST", cookie, raw: PNG, headers: { "Content-Type": "image/png", "X-File-Name": "photo.png" } });
  const fixture = read("./fixtures/pilot-intake-v1.json");
  await call("/intake", { method: "PUT", cookie, body: { answerLanguage: "sv", campaignLanguage: language, profile: fixture.profile, uploads: { pictures: [{ fileId: r.data.file.id, name: "photo.png", mime: "image/png" }], founderStory: { text: "Story.", fileId: null }, previousPosts: [], faqs: { rows: [], fileId: null } } } });
  await call("/intake/submit", { method: "POST", cookie, body: {} });
  if (withBrain) {
    const brain = Object.assign(read("./fixtures/pilot-brain-v1.json"), { builtFromIntakeVersion: 1, editedByHarry: false });
    await call("/admin/brain/" + id, { method: "POST", cookie: ADMIN, body: { brain } });
  }
  return { id, email, cookie };
}
function campaign(clientId, month, extra) {
  const m = read("./fixtures/pilot-campaign-model.json");
  m.socialCopy = m.socialCopy.map((p) => (p.channel === "google_business" ? Object.assign(p, { hashtags: [] }) : p));
  return Object.assign({ schemaVersion: "campaign-1", clientId, campaignId: "cp_" + month.replace("-", "_") + "_en", brainVersion: 1, name: "Campaign " + month, month, goal: "sales", language: "en", channels: ["instagram", "facebook", "google_business"], status: "in_production" }, m, extra || {});
}
/* A minimal MP4: ftyp, moov with mvhd (time scale 1000), and an mdat that fills up to `bytes`. */
function box(type, payload) {
  const b = Buffer.alloc(8 + payload.length);
  b.writeUInt32BE(8 + payload.length, 0);
  b.write(type, 4, "latin1");
  payload.copy(b, 8);
  return b;
}
function mvhd(seconds, v1) {
  const p = Buffer.alloc(v1 ? 108 : 96);
  p[0] = v1 ? 1 : 0;
  if (v1) { p.writeUInt32BE(1000, 20); p.writeUInt32BE(0, 24); p.writeUInt32BE(Math.round(seconds * 1000), 28); }
  else { p.writeUInt32BE(1000, 12); p.writeUInt32BE(Math.round(seconds * 1000), 16); }
  return box("mvhd", p);
}
function clip(seconds, bytes, { moovAtEnd = false, v1 = false, brand = "isom" } = {}) {
  const ftyp = box("ftyp", Buffer.from(brand + "\0\0\0\0" + brand, "latin1"));
  const moov = box("moov", Buffer.concat([mvhd(seconds, v1), box("trak", Buffer.alloc(32))]));
  const fill = Math.max(0, bytes - ftyp.length - moov.length - 8);
  const mdat = box("mdat", Buffer.alloc(fill, 7));
  return Buffer.concat(moovAtEnd ? [ftyp, mdat, moov] : [ftyp, moov, mdat]);
}
const MB = 1024 * 1024, PART = 5 * MB;
const reader = (buf) => async (off, len) => new Uint8Array(buf.subarray(off, off + len));
async function sendParts(cookie, id, buf, only) {
  const total = Math.ceil(buf.length / PART);
  for (let n = 1; n <= total; n++) {
    if (only && !only.includes(n)) continue;
    const r = await call("/portal/videos/" + id + "/part?n=" + n, { method: "PUT", cookie, raw: buf.subarray((n - 1) * PART, n * PART), headers: { "Content-Type": "application/octet-stream" } });
    if (r.status !== 200) return r;
  }
  return { status: 200 };
}
const WORKER = "http://127.0.0.1:8787";
async function scheduled() {
  for (let i = 0; i < 8; i++) {
    try { const r = await fetch(WORKER + "/__scheduled?cron=17+3+*+*+*"); if (r.ok) return; } catch (e) {}
    await sleep(1000);
  }
  throw new Error("the scheduled handler did not answer");
}

try {
  /* ---------- reading the length ---------- */
  const c30 = clip(30, 12 * MB), c45end = clip(45, 7 * MB, { moovAtEnd: true }), c61 = clip(61.2, 6 * MB), cv1 = clip(59, 2 * MB, { v1: true, brand: "qt  " });
  ok((await durationOf(reader(c30), c30.length)) === 30 && (await durationOf(reader(c45end), c45end.length)) === 45, "the length is read with moov at the start or at the end of the file");
  ok((await durationOf(reader(cv1), cv1.length)) === 59 && Math.round((await durationOf(reader(c61), c61.length)) * 10) === 612, "64-bit (version 1) headers and MOV files work; 61.2 s reads as 61.2");
  ok((await durationOf(reader(Buffer.alloc(4096, 1)), 4096)) === null && durationFromMoov(box("moov", Buffer.alloc(16))) === null, "a file without the header gives no length instead of a wrong one");
  ok(looksLikeMp4(new Uint8Array(c30.subarray(0, 16))) && !looksLikeMp4(new Uint8Array(Buffer.from("%PDF-1.7 hello world"))), "a renamed PDF is not taken for a video");

  /* ---------- start checks ---------- */
  const A = await newClient("Video Kafé", "en");
  const B = await newClient("Video Salong", "en");
  let r = await call("/portal/videos", { cookie: A.cookie });
  ok(r.status === 200 && r.data.videos.length === 0 && r.data.limits.maxSeconds === 60 && r.data.limits.maxBytes === 200 * MB && r.data.limits.maxCount === 10, "the portal gets the limits: 60 s, 200 MB, 10 clips");
  r = await call("/portal/videos/start", { method: "POST", cookie: A.cookie, body: { name: "clip.avi", size: 1000 } });
  ok(r.status === 415 && r.data.message.sv && r.data.message.en, "only MP4 or MOV, in Swedish and English");
  r = await call("/portal/videos/start", { method: "POST", cookie: A.cookie, body: { name: "big.mp4", size: 201 * MB } });
  ok(r.status === 413 && /200 MB/.test(r.data.message.en) && /200 MB/.test(r.data.message.sv), "a 201 MB file is refused with a bilingual message");
  r = await call("/portal/videos/start", { method: "POST", cookie: A.cookie, body: { name: "long.mov", size: 5 * MB, duration: 61 } });
  ok(r.status === 413 && r.data.error === "long" && /60/.test(r.data.message.sv), "a 61 second clip (measured by the phone) is refused before upload, bilingual");
  r = await call("/portal/videos/start", { method: "POST", cookie: ADMIN, body: { name: "a.mp4", size: 1000 } });
  ok(r.status === 403, "the admin cannot upload into a client's videos");

  /* ---------- upload in parts, drop, continue ---------- */
  r = await call("/portal/videos/start", { method: "POST", cookie: A.cookie, body: { name: "Kitchen tour.mp4", size: c30.length, duration: 30 } });
  ok(r.status === 201 && r.data.parts === 3 && r.data.partBytes === PART, "a 12 MB clip goes up in three parts of 5 MB");
  const id1 = r.data.id;
  r = await call("/portal/videos/" + id1 + "/part?n=1", { method: "PUT", cookie: A.cookie, raw: c30.subarray(0, PART - 10) });
  ok(r.status === 413, "a part of the wrong size is refused");
  r = await call("/portal/videos/" + id1 + "/part?n=1", { method: "PUT", cookie: A.cookie, raw: Buffer.concat([Buffer.from("%PDF-1.7 not a vid"), Buffer.alloc(PART - 18)]) });
  ok(r.status === 415, "the first part must look like a video");
  r = await sendParts(A.cookie, id1, c30, [1, 2]);
  ok(r.status === 200, "parts 1 and 2 arrive, then the connection drops");
  r = await call("/portal/videos/" + id1 + "/complete", { method: "POST", cookie: A.cookie, body: {} });
  ok(r.status === 409 && r.data.partsDone.join() === "1,2", "it cannot finish with a part missing");
  r = await call("/portal/videos", { cookie: A.cookie });
  ok(r.data.pending.length === 1 && r.data.pending[0].bytesDone === 2 * PART && r.data.pending[0].name === "Kitchen tour.mp4", "after a reload the portal shows the unfinished upload and how far it got");
  r = await call("/portal/videos/" + id1, { cookie: A.cookie });
  ok(r.status === 200 && r.data.partsDone.join() === "1,2", "picking the file again: the Vault says which parts it already has");
  r = await call("/portal/videos/" + id1, { cookie: B.cookie });
  ok(r.status === 404, "another client cannot see or continue it");
  r = await call("/portal/videos/" + id1 + "/part?n=3", { method: "PUT", cookie: B.cookie, raw: c30.subarray(2 * PART) });
  ok(r.status === 404, "or send parts into it");
  r = await sendParts(A.cookie, id1, c30, [2, 3]);
  ok(r.status === 200, "she continues: part 2 again (no harm) and part 3");
  r = await call("/portal/videos/" + id1 + "/complete", { method: "POST", cookie: A.cookie, body: {} });
  ok(r.status === 201 && r.data.video.duration === 30 && r.data.video.size === c30.length && r.data.video.name === "Kitchen tour.mp4", "the clip is complete: 30 seconds read from the file");
  ok(sql("SELECT COUNT(*) AS n FROM upload_parts WHERE upload_id = '" + id1 + "'")[0].n === 0 && sql("SELECT COUNT(*) AS n FROM uploads WHERE id = '" + id1 + "'")[0].n === 0, "the part records are gone once it is done");

  /* moov at the end, MOV */
  r = await call("/portal/videos/start", { method: "POST", cookie: A.cookie, body: { name: "Staff.MOV", size: c45end.length } });
  const id2 = r.data.id;
  await sendParts(A.cookie, id2, c45end);
  r = await call("/portal/videos/" + id2 + "/complete", { method: "POST", cookie: A.cookie, body: {} });
  ok(r.status === 201 && r.data.video.duration === 45 && r.data.video.mime === "video/quicktime", "a MOV with its header at the end: 45 seconds, kept as QuickTime");

  /* 61 seconds that the phone could not measure */
  r = await call("/portal/videos/start", { method: "POST", cookie: A.cookie, body: { name: "sneaky.mp4", size: c61.length } });
  const id3 = r.data.id;
  await sendParts(A.cookie, id3, c61);
  r = await call("/portal/videos/" + id3 + "/complete", { method: "POST", cookie: A.cookie, body: {} });
  ok(r.status === 413 && r.data.error === "long" && r.data.seconds === 61.2 && r.data.message.sv && r.data.message.en, "a 61 second clip the phone could not measure is refused after upload, bilingual");
  ok(sql("SELECT COUNT(*) AS n FROM files WHERE id = '" + id3 + "'")[0].n === 0 && sql("SELECT COUNT(*) AS n FROM uploads WHERE id = '" + id3 + "'")[0].n === 0, "and nothing of it is kept");

  /* ---------- ten at most ---------- */
  const extra = [];
  for (let i = 0; i < 8; i++) {
    r = await call("/portal/videos/start", { method: "POST", cookie: A.cookie, body: { name: "c" + i + ".mp4", size: 1000 } });
    extra.push(r.data.id);
  }
  r = await call("/portal/videos/start", { method: "POST", cookie: A.cookie, body: { name: "eleven.mp4", size: 1000 } });
  ok(r.status === 409 && r.data.message.sv && r.data.message.en, "the eleventh clip is refused (unfinished uploads count), bilingual");
  r = await call("/portal/videos/" + extra[0], { method: "DELETE", cookie: A.cookie });
  ok(r.status === 200, "she cancels an unfinished upload");
  r = await call("/portal/videos/start", { method: "POST", cookie: A.cookie, body: { name: "ten.mp4", size: 1000 } });
  ok(r.status === 201, "then there is room again");

  /* ---------- old route, consent ---------- */
  r = await call("/uploads?section=pictures", { method: "POST", cookie: A.cookie, raw: c30.subarray(0, 1000), headers: { "Content-Type": "video/mp4", "X-File-Name": "clip.mp4" } });
  ok(r.status === 415 && /Videos/.test(r.data.message.en), "the picture upload still refuses videos and points to the Videos section");
  sql("UPDATE consents SET version = 'c-4' WHERE client_id = '" + B.id + "'");
  r = await call("/portal/videos/start", { method: "POST", cookie: B.cookie, body: { name: "b.mp4", size: 1000 } });
  ok(r.status === 403 && r.data.error === "consent_required", "a client on the old consent version confirms the new text (c-5) before uploading videos");

  /* ---------- Harry ---------- */
  r = await call("/admin/intake/" + A.id, { cookie: ADMIN });
  const vids = r.data.files.filter((f) => f.section === "videos");
  ok(vids.length === 2 && vids.some((v) => v.duration === 30) && vids.every((v) => /^\/api\/vault\/files\/f_/.test(v.url)), "the Intake tab lists her two clips with their length and a download link");
  const dl = await fetch(BASE + "/files/" + id1, { headers: { Cookie: ADMIN } });
  const got = Buffer.from(await dl.arrayBuffer());
  ok(dl.status === 200 && dl.headers.get("content-type") === "video/mp4" && /attachment/.test(dl.headers.get("content-disposition") || "") && got.length === c30.length && got.equals(c30), "Harry downloads the clip byte for byte, as a download");
  r = await call("/files/" + id2, { method: "DELETE", cookie: A.cookie });
  ok(r.status === 200 && (await call("/portal/videos", { cookie: A.cookie })).data.videos.length === 1, "she removes a clip");
  const brainJs = fs.readFileSync(new URL("../../../assets/growth-brain.js", import.meta.url), "utf8");
  ok(/clientVideoNames: files\.filter\(\(f\) => f\.section === "videos"\)\.map\(\(f\) => f\.name\)/.test(brainJs) && !/section === "videos"[^\n]*(fetch|base64|readFile)/.test(brainJs), "the Business Brain gets the clips' names only");

  /* ---------- the daily sweep ---------- */
  sql("UPDATE uploads SET created_at = '2020-01-01T00:00:00.000Z' WHERE client_id = '" + A.id + "'");
  await scheduled();
  await sleep(2000);
  ok(sql("SELECT COUNT(*) AS n FROM uploads WHERE client_id = '" + A.id + "'")[0].n === 0, "unfinished uploads left for two days are cleared by the daily job");

  /* ---------- wording, export, erasure ---------- */
  const i18n = JSON.parse(fs.readFileSync(new URL("../src/public/i18n.json", import.meta.url)));
  ok(Object.keys(i18n.sv.uploads.vid).join() === Object.keys(i18n.en.uploads.vid).join() && i18n.sv.consent.points.some((p) => p.h === "Videoklipp") && i18n.en.consent.points.some((p) => p.h === "Video clips"), "the Videos section and the consent line exist in Swedish and English");
  const wr = JSON.parse(fs.readFileSync(new URL("../wrangler.json", import.meta.url)));
  const priv = fs.readFileSync(new URL("../../../privacy.html", import.meta.url), "utf8");
  ok(wr.vars.CONSENT_VERSION === "c-5" && /<strong>Video clips\.<\/strong>/.test(priv) && /<strong>Videoklipp\.<\/strong>/.test(priv), "consent moves to c-5 and the privacy policy covers video clips in both languages");
  const files = ["../src/videos.js", "../src/mp4.js", "../src/public/portal.js", "../src/public/i18n.json", "../../../privacy.html"].map((f) => fs.readFileSync(new URL(f, import.meta.url), "utf8")).join("");
  ok(!files.includes("—"), "no em-dash in the new code and wording");
  r = await call("/admin/export/" + A.id, { cookie: ADMIN });
  ok(r.status === 200 && r.data.files.some((f) => f.section === "videos" && f.duration === 30), "the export lists her clips with their length");
  r = await call("/admin/clients/" + A.id, { method: "DELETE", cookie: ADMIN, body: { confirm: A.email } });
  ok(r.status === 200 && sql("SELECT COUNT(*) AS n FROM files WHERE client_id = '" + A.id + "'")[0].n === 0 && sql("SELECT COUNT(*) AS n FROM upload_parts WHERE client_id = '" + A.id + "'")[0].n === 0, "erasure removes her clips and any part records");
  const left = await fetch(BASE + "/files/" + id1, { headers: { Cookie: ADMIN } });
  ok(left.status === 404, "the clip is gone from storage too");

  r = await call("/health");
  ok(/^[a-z0-9]+$/.test(r.data.part), "health reports the current part");
} catch (e) {
  fail++;
  console.log("FAIL crashed: " + e.stack);
}
console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
