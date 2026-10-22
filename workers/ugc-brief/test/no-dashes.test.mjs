/* House rule: no em or en dash characters anywhere in the source, pages or tests. */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
const bad = [String.fromCharCode(0x2014), String.fromCharCode(0x2013)];
function walk(d) {
  for (const n of readdirSync(d)) {
    if (n === "node_modules" || n === ".wrangler") continue;
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(js|mjs|html|css|json|md)$/.test(n)) {
      const t = readFileSync(p, "utf8");
      for (const b of bad) if (t.includes(b)) throw new Error("dash character found in " + p);
    }
  }
}
walk(".");
console.log("no dash characters in the project files");
