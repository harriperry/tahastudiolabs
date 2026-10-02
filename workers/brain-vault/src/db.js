/* Applies MIGRATIONS once per Worker instance. Safe to run repeatedly: every statement
   uses IF NOT EXISTS and applied ids are recorded in schema_migrations. */
import { MIGRATIONS } from "./migrations.js";

let ready = null;

export function ensureSchema(env) {
  if (!ready) {
    ready = migrate(env).catch((e) => {
      ready = null;
      throw e;
    });
  }
  return ready;
}

async function migrate(env) {
  const db = env.DB;
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)"
  ).run();
  const done = await db.prepare("SELECT id FROM schema_migrations").all();
  const applied = new Set((done.results || []).map((r) => r.id));
  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue;
    const stmts = m.statements.map((s) => db.prepare(s));
    stmts.push(
      db.prepare("INSERT OR IGNORE INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)").bind(
        m.id,
        m.name,
        new Date().toISOString()
      )
    );
    await db.batch(stmts);
  }
}
