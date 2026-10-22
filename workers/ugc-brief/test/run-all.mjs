/* Starts the Worker locally (wrangler dev, in-memory D1 and R2) and runs the end to end test. */
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";

const PORT = 8799;
rmSync(".wrangler/state", { recursive: true, force: true });
const dev = spawn("npx", ["wrangler", "dev", "--local", "--port", String(PORT), "--ip", "127.0.0.1"], { stdio: ["ignore", "pipe", "pipe"] });
let log = "";
dev.stdout.on("data", (d) => (log += d));
dev.stderr.on("data", (d) => (log += d));

async function waitUp() {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/api/brief/health`);
      if (r.ok) return;
    } catch (e) { /* not yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Worker did not start:\n" + log.slice(-2000));
}

let code = 1;
try {
  await waitUp();
  const { run } = await import("./e2e.test.mjs");
  await run(`http://127.0.0.1:${PORT}`);
  code = 0;
} catch (e) {
  console.error("TEST FAILURE:", e && e.stack ? e.stack : e);
  console.error("---- worker log tail ----\n" + log.slice(-1500));
} finally {
  dev.kill("SIGTERM");
  setTimeout(() => process.exit(code), 500);
}
