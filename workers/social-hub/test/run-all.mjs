/* node test/run-all.mjs : runs the social-hub suite. No network, no wrangler. */
import { spawnSync } from "node:child_process";
const r = spawnSync(process.execPath, ["--no-warnings", "test/social.test.mjs"], { stdio: "inherit" });
process.exit(r.status === null ? 1 : r.status);
