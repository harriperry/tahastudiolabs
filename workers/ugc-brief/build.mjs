import { build } from "esbuild";
const textPublic = {
  name: "text-public",
  setup(b) {
    b.onLoad({ filter: /\/public\/.*\.(html|css|js)$/ }, async (a) => {
      const fs = await import("node:fs/promises");
      return { contents: await fs.readFile(a.path, "utf8"), loader: "text" };
    });
  }
};
await build({ entryPoints: ["src/index.js"], bundle: true, format: "esm", target: "es2022", outfile: "dist/worker.mjs", plugins: [textPublic], logLevel: "info", legalComments: "none" });
