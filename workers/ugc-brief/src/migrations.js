/* D1 schema, applied by the Worker itself (see db.js). Never edit a shipped migration:
   add a new one with the next id. Every project owned row cascades on project delete,
   which is how erasure works. */

export const MIGRATIONS = [
  {
    id: 1,
    name: "init",
    statements: [
      `CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        key_version INTEGER NOT NULL DEFAULT 1,
        brand TEXT NOT NULL,
        contact_name TEXT NOT NULL,
        email TEXT NOT NULL,
        package TEXT NOT NULL CHECK (package IN ('starter','growth','scale','retainer')),
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','brief_received','script_review','changes_requested','approved','in_production','delivered','closed')),
        brief TEXT NOT NULL,
        delivery_date TEXT,
        consent_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        finalized_at TEXT,
        change_rounds_used INTEGER NOT NULL DEFAULT 0,
        extra_rounds INTEGER NOT NULL DEFAULT 0,
        approved_proposal_id TEXT,
        approved_hook INTEGER,
        approved_at TEXT,
        production_started_at TEXT,
        delivered_at TEXT,
        revision_until TEXT,
        revisions_used INTEGER NOT NULL DEFAULT 0,
        videos_delivered INTEGER,
        delivery_link TEXT,
        delivery_note TEXT
      )`,
      `CREATE INDEX IF NOT EXISTS idx_projects_email ON projects (email)`,
      `CREATE INDEX IF NOT EXISTS idx_projects_status ON projects (status, updated_at)`,
      `CREATE TABLE IF NOT EXISTS proposals (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        hooks TEXT NOT NULL,
        recommended INTEGER NOT NULL,
        script TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','superseded','approved')),
        created_at TEXT NOT NULL,
        published_at TEXT
      )`,
      `CREATE INDEX IF NOT EXISTS idx_proposals_project ON proposals (project_id, version)`,
      `CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        author TEXT NOT NULL CHECK (author IN ('client','admin','system')),
        kind TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_messages_project ON messages (project_id, id)`,
      `CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        area TEXT NOT NULL CHECK (area IN ('asset','delivery')),
        name TEXT NOT NULL,
        ext TEXT NOT NULL,
        size INTEGER NOT NULL,
        r2_key TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_files_project ON files (project_id, area)`,
      `CREATE TABLE IF NOT EXISTS login_tokens (
        token_hash TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        used_at INTEGER
      )`,
      `CREATE TABLE IF NOT EXISTS sessions (
        session_hash TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS rate_events (
        bucket TEXT NOT NULL,
        at INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_rate_events_bucket_at ON rate_events (bucket, at)`
    ]
  }
];
