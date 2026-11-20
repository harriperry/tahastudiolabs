/* Test harness: a D1 look-alike on node:sqlite, loaded with the Vault's real migrations and then
   social-hub's own. No network, no wrangler, nothing touches the live site. */
import { DatabaseSync } from "node:sqlite";
import { MIGRATIONS as VAULT_MIGRATIONS } from "../../brain-vault/src/migrations.js";
import { resetSchemaCache } from "../src/db.js";
import { handle } from "../src/index.js";
import { b64url, nowMs, sha256hex } from "../src/util.js";

class Stmt {
  constructor(db, sql, params = []) { this.db = db; this.sql = sql; this.params = params; }
  bind(...p) { return new Stmt(this.db, this.sql, p); }
  async first() { const r = this.db.prepare(this.sql).get(...this.params); return r === undefined ? null : { ...r }; }
  async all() { return { results: this.db.prepare(this.sql).all(...this.params).map((r) => ({ ...r })) }; }
  async run() { const r = this.db.prepare(this.sql).run(...this.params); return { meta: { changes: r.changes } }; }
}

export function fakeD1() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  return {
    raw: db,
    prepare: (sql) => new Stmt(db, sql),
    async batch(stmts) {
      db.exec("BEGIN");
      try {
        const out = [];
        for (const s of stmts) out.push(await s.run());
        db.exec("COMMIT");
        return out;
      } catch (e) { db.exec("ROLLBACK"); throw e; }
    }
  };
}

export function newKey() {
  return b64url(crypto.getRandomValues(new Uint8Array(32)));
}

export function makeEnv(extra = {}) {
  const DB = fakeD1();
  DB.raw.exec("CREATE TABLE schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)");
  for (const m of VAULT_MIGRATIONS) {
    for (const s of m.statements) DB.raw.exec(s);
    DB.raw.prepare("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)").run(m.id, m.name, new Date().toISOString());
  }
  resetSchemaCache();
  return {
    DB, ENVIRONMENT: "development", SITE_ORIGIN: "https://tahastudiolabs.com",
    ADMIN_EMAILS: "admin@example.com", SOCIAL_CONNECTORS: "mock", SOCIAL_CONSENT_VERSION: "s-1",
    SOCIAL_TOKEN_KEY: newKey(), ...extra
  };
}

export async function seedClient(env, id, email) {
  const now = new Date().toISOString();
  await env.DB.prepare("INSERT INTO clients (id, name, email, language, status, created_at, updated_at) VALUES (?, ?, ?, 'en', 'invited', ?, ?)")
    .bind(id, "Client " + id, email, now, now).run();
}

export async function makeSession(env, { role, clientId = null, email, expiresAt }) {
  const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const t = nowMs();
  await env.DB.prepare("INSERT INTO sessions (session_hash, role, client_id, email, created_at, expires_at, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(await sha256hex(token), role, clientId, email, t, expiresAt || t + 86400000, t).run();
  return "__Host-tv_session=" + token;
}

export async function call(env, method, path, { cookie, body, origin = "https://tahastudiolabs.com" } = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  if (method !== "GET") { headers.Origin = origin; headers["Content-Type"] = "application/json"; }
  const res = await handle(new Request("https://tahastudiolabs.com/api/vault/social" + path, {
    method, headers, body: method === "GET" ? undefined : JSON.stringify(body || {})
  }), env);
  let data = null;
  try { data = await res.json(); } catch (e) {}
  return { status: res.status, data };
}

export function counter() {
  let pass = 0, fail = 0;
  return {
    ok(c, n) { if (c) { pass++; console.log("PASS " + n); } else { fail++; console.log("FAIL " + n); } },
    done() { console.log("\n" + pass + " passed, " + fail + " failed"); process.exit(fail ? 1 : 0); }
  };
}
