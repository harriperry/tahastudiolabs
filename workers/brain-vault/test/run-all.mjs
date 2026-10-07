/* Runs every Brain Vault test suite against local copies of the Worker, in one command:
     node test/run-all.mjs
   It starts `wrangler dev` twice with fresh local storage:
     Round 1, the Vault alone on port 8787 (phase 1 and 2 suites: e2e, portal).
     Round 2, the Vault behind a stand-in for tahastudiolabs.com on port 8080 that also fakes
     ScriptForge's /api/me (cookie sf_sid=admin or sf_sid=user). Phase 3 and later suites.
   Plain node suites (schemas and helpers) run first. Nothing here touches the live site.
   Added in Growth Department V2 phase G1. */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WRANGLER = path.join(DIR, "node_modules", ".bin", process.platform === "win32" ? "wrangler.cmd" : "wrangler");
const ADMIN = "agborkak@gmail.com";
const only = process.argv.slice(2);
const results = [];

function want(name) {
  return only.length === 0 || only.includes(name);
}

function runSuite(name, file, env = {}) {
  if (!want(name)) return;
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join("test", file)], {
    cwd: DIR,
    env: { ...process.env, WRANGLER, WORKER_DIR: DIR, ...env },
    encoding: "utf8",
    timeout: 600000
  });
  const out = (r.stdout || "") + (r.stderr || "");
  const passed = (out.match(/^PASS /gm) || []).length;
  const failed = (out.match(/^FAIL /gm) || []).length;
  const ok = r.status === 0 && failed === 0;
  results.push({ name, passed, failed, ok, secs: Math.round((Date.now() - t0) / 1000) });
  console.log((ok ? "ok   " : "FAIL ") + name + "  " + passed + " passed, " + failed + " failed");
  if (!ok) console.log(out.split("\n").filter((l) => /^FAIL |Error|error|    at /.test(l)).slice(0, 15).join("\n"));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startWorker(round, siteOrigin, meUrl) {
  const persist = path.join(DIR, ".wrangler", "test-" + round);
  fs.rmSync(persist, { recursive: true, force: true });
  const log = path.join(DIR, ".wrangler", "dev-" + round + ".log");
  fs.mkdirSync(path.dirname(log), { recursive: true });
  const out = fs.openSync(log, "w");
  const args = ["dev", "--local", "--port", "8787", "--ip", "127.0.0.1", "--test-scheduled", "--persist-to", persist,
    "--var", "ENVIRONMENT:development", "--var", "SITE_ORIGIN:" + siteOrigin, "--var", "MAIL_PROVIDER:log",
    "--var", "SCRIPTFORGE_ME_URL:" + meUrl];
  const child = spawn(WRANGLER, args, { cwd: DIR, stdio: ["ignore", out, out], shell: process.platform === "win32" });
  for (let i = 0; i < 120; i++) {
    await sleep(1000);
    try {
      const r = await fetch("http://127.0.0.1:8787/api/vault/health");
      if (r.status === 200) return { child, log, persist };
    } catch (e) {}
  }
  child.kill();
  throw new Error("wrangler dev did not start, see " + log);
}

function stopWorker(w) {
  try {
    w.child.kill();
  } catch (e) {}
}

/* The stand-in site runs as its own process (test/local-site.mjs): the suites run with
   spawnSync, which would block a server living in this process. */
async function startSite() {
  const siteLog = fs.openSync(path.join(DIR, ".wrangler", "local-site.log"), "w");
  const child = spawn(process.execPath, [path.join(DIR, "test", "local-site.mjs")], { cwd: DIR, stdio: ["ignore", siteLog, siteLog] });
  for (let i = 0; i < 30; i++) {
    await sleep(300);
    try {
      const r = await fetch("http://127.0.0.1:8080/api/me");
      if (r.status === 401) return { close: () => child.kill() };
    } catch (e) {}
  }
  child.kill();
  throw new Error("the local site did not start");
}

/* Plain suites */
runSuite("schemas", "schemas.test.mjs");
runSuite("brain-helpers", "brain-helpers.test.mjs");
runSuite("campaign-helpers", "campaign-helpers.test.mjs");
runSuite("format-gemini", "format-gemini.test.mjs");
if (fs.existsSync(path.join(DIR, "test", "visuals-helpers.test.mjs"))) runSuite("visuals-helpers", "visuals-helpers.test.mjs");
if (fs.existsSync(path.join(DIR, "test", "grok-removed.test.mjs"))) runSuite("grok-removed", "grok-removed.test.mjs");
if (fs.existsSync(path.join(DIR, "test", "reskin.test.mjs"))) runSuite("reskin", "reskin.test.mjs");
if (fs.existsSync(path.join(DIR, "test", "landing-helpers.test.mjs"))) runSuite("landing-helpers", "landing-helpers.test.mjs");

/* Round 1 */
if (want("e2e") || want("portal")) {
  const w = await startWorker("r1", "http://localhost:8787", "http://127.0.0.1:8790/api/me");
  try {
    const env = { DEV_LOG: w.log, PERSIST: w.persist };
    runSuite("e2e", "e2e.test.mjs", env);
    runSuite("portal", "portal.test.mjs", env);
  } finally {
    stopWorker(w);
    await sleep(2000);
  }
}

/* Round 2 */
const round2 = ["panel", "brain", "campaign", "gdpr", "visuals", "photos", "pages", "review", "lang", "rhythm", "results", "videos"];
if (round2.some(want)) {
  const site = await startSite();
  const w = await startWorker("r2", "http://localhost:8080", "http://127.0.0.1:8080/api/me");
  try {
    const env = { DEV_LOG: w.log, PERSIST: w.persist, VAULT_URL: "http://127.0.0.1:8080/api/vault", ORIGIN: "http://localhost:8080" };
    runSuite("panel", "panel.test.mjs", env);
    runSuite("brain", "brain.test.mjs", env);
    runSuite("campaign", "campaign.test.mjs", env);
    if (fs.existsSync(path.join(DIR, "test", "visuals.test.mjs"))) runSuite("visuals", "visuals.test.mjs", env);
    if (fs.existsSync(path.join(DIR, "test", "photos.test.mjs"))) runSuite("photos", "photos.test.mjs", env);
    if (fs.existsSync(path.join(DIR, "test", "pages.test.mjs"))) runSuite("pages", "pages.test.mjs", env);
    if (fs.existsSync(path.join(DIR, "test", "review.test.mjs"))) runSuite("review", "review.test.mjs", env);
    if (fs.existsSync(path.join(DIR, "test", "lang.test.mjs"))) runSuite("lang", "lang.test.mjs", env);
    if (fs.existsSync(path.join(DIR, "test", "rhythm.test.mjs"))) runSuite("rhythm", "rhythm.test.mjs", env);
    if (fs.existsSync(path.join(DIR, "test", "results.test.mjs"))) runSuite("results", "results.test.mjs", env);
    if (fs.existsSync(path.join(DIR, "test", "videos.test.mjs"))) runSuite("videos", "videos.test.mjs", env);
    runSuite("gdpr", "gdpr.test.mjs", env);
  } finally {
    stopWorker(w);
    site.close();
  }
}

const bad = results.filter((r) => !r.ok);
console.log("\n" + results.map((r) => r.name + " " + r.passed + "/" + (r.passed + r.failed)).join(", "));
console.log(bad.length ? bad.length + " suite(s) failed" : "All " + results.length + " suites passed");
process.exit(bad.length ? 1 : 0);
