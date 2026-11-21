/* node test/run-all.mjs : runs the social-hub suites. No network, no wrangler. */
import { spawnSync } from "node:child_process";
let code = 0;
for (const f of ["test/social.test.mjs", "test/meta.test.mjs", "test/phase3.test.mjs", "test/media.test.mjs"]) {
  const r = spawnSync(process.execPath, ["--no-warnings", f], { stdio: "inherit" });
  if (r.status !== 0) code = 1;
}
process.exit(code);
