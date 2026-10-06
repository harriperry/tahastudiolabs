/* A stand-in for tahastudiolabs.com on port 8080, for the local test suites.
   /api/me answers like ScriptForge's sign-in check:
     cookie sf_sid=admin -> agborkak@gmail.com (the admin), sf_sid=user -> someone@example.com.
   Every other request goes to the local Brain Vault Worker on port 8787.
   Started by test/run-all.mjs, or on its own with: node test/local-site.mjs */
import http from "node:http";

const ADMIN = "agborkak@gmail.com";

http.createServer((req, res) => {
  if (req.url.startsWith("/api/me")) {
    const c = req.headers.cookie || "";
    let email = null;
    if (/sf_sid=admin/.test(c)) email = ADMIN;
    else if (/sf_sid=user/.test(c)) email = "someone@example.com";
    res.writeHead(email ? 200 : 401, { "Content-Type": "application/json" });
    res.end(JSON.stringify(email ? { email, status: "active", tier: "pro" } : { error: "Not signed in." }));
    return;
  }
  const headers = { ...req.headers, host: "127.0.0.1:8787" };
  const up = http.request({ host: "127.0.0.1", port: 8787, method: req.method, path: req.url, headers }, (ur) => {
    res.writeHead(ur.statusCode, ur.headers);
    ur.pipe(res);
  });
  up.on("error", () => {
    res.writeHead(502);
    res.end();
  });
  req.pipe(up);
}).listen(8080, "127.0.0.1");
