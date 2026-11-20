/* social-hub migrations. Tracked in social_migrations, never in the Vault's schema_migrations,
   so the two Workers cannot disturb each other. Every table carries client_id and every
   statement is idempotent. Tokens are stored only as AES-GCM ciphertext. */
export const MIGRATIONS = [
  {
    id: 1,
    name: "social-core",
    statements: [
      `CREATE TABLE IF NOT EXISTS social_global (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        paused INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      )`,
      `INSERT OR IGNORE INTO social_global (id, paused, updated_at) VALUES (1, 0, '1970-01-01T00:00:00.000Z')`,
      `CREATE TABLE IF NOT EXISTS social_settings (
        client_id TEXT PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
        enabled INTEGER NOT NULL DEFAULT 0,
        paused INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS social_consents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        version TEXT NOT NULL,
        accepted_at TEXT NOT NULL,
        accepted_by TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_social_consents_client ON social_consents (client_id, version)`,
      `CREATE TABLE IF NOT EXISTS social_accounts (
        id TEXT PRIMARY KEY,
        client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        platform TEXT NOT NULL,
        external_ref TEXT NOT NULL,
        display_name TEXT NOT NULL,
        token_enc TEXT NOT NULL,
        refresh_enc TEXT,
        token_expires_at INTEGER,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked','expired')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (client_id, platform, external_ref)
      )`,
      `CREATE TABLE IF NOT EXISTS social_oauth_states (
        state_hash TEXT PRIMARY KEY,
        client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        platform TEXT NOT NULL,
        session_hash TEXT NOT NULL,
        verifier_enc TEXT NOT NULL,
        redirect_uri TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        used_at INTEGER
      )`,
      `CREATE INDEX IF NOT EXISTS idx_social_oauth_expires ON social_oauth_states (expires_at)`,
      `CREATE TABLE IF NOT EXISTS social_versions (
        id TEXT PRIMARY KEY,
        client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        platform TEXT NOT NULL,
        body TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','withdrawn')),
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        approved_at TEXT,
        approved_by TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS social_jobs (
        id TEXT PRIMARY KEY,
        client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        account_id TEXT NOT NULL REFERENCES social_accounts(id),
        version_id TEXT NOT NULL REFERENCES social_versions(id),
        platform TEXT NOT NULL,
        run_at INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','publishing','published','failed','needs_check','cancelled')),
        attempts INTEGER NOT NULL DEFAULT 0,
        idempotency_key TEXT NOT NULL UNIQUE,
        last_error TEXT,
        claimed_at INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_social_jobs_due ON social_jobs (status, run_at)`,
      `CREATE TABLE IF NOT EXISTS social_publications (
        job_id TEXT PRIMARY KEY REFERENCES social_jobs(id),
        client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        external_id TEXT NOT NULL,
        url TEXT,
        published_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS social_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id TEXT,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        detail TEXT,
        at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_social_audit_client ON social_audit (client_id, at)`
    ]
  }
];
