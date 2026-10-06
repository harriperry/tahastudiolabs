/* D1 schema for the Brain Vault, applied by the Worker itself (see db.js).
   Each migration is a list of single SQL statements. Never edit a shipped migration:
   add a new one with the next id instead. Tables for later phases are created now so the
   data model fits the portal and the ScriptForge panel without a later rebuild.
   Every client-owned row cascades on client delete, which is how GDPR erasure works. */

export const MIGRATIONS = [
  {
    id: 1,
    name: "init",
    statements: [
      `CREATE TABLE IF NOT EXISTS clients (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        language TEXT NOT NULL DEFAULT 'sv' CHECK (language IN ('sv','en')),
        status TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited','profile_in_progress','submitted','brain_ready','campaign_in_production','campaign_delivered')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        invited_at TEXT,
        last_login_at TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS login_tokens (
        token_hash TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('client','admin')),
        client_id TEXT REFERENCES clients(id) ON DELETE CASCADE,
        purpose TEXT NOT NULL CHECK (purpose IN ('login','invite')),
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        used_at INTEGER
      )`,
      `CREATE INDEX IF NOT EXISTS idx_login_tokens_expires ON login_tokens (expires_at)`,
      `CREATE TABLE IF NOT EXISTS sessions (
        session_hash TEXT PRIMARY KEY,
        role TEXT NOT NULL CHECK (role IN ('client','admin')),
        client_id TEXT REFERENCES clients(id) ON DELETE CASCADE,
        email TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        last_seen INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at)`,
      `CREATE TABLE IF NOT EXISTS rate_events (
        bucket TEXT NOT NULL,
        at INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_rate_events_bucket_at ON rate_events (bucket, at)`,
      `CREATE TABLE IF NOT EXISTS consents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        version TEXT NOT NULL,
        language TEXT NOT NULL CHECK (language IN ('sv','en')),
        accepted_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS intake_drafts (
        client_id TEXT PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
        data TEXT NOT NULL,
        answer_language TEXT,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS intakes (
        client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        data TEXT NOT NULL,
        submitted_at TEXT NOT NULL,
        PRIMARY KEY (client_id, version)
      )`,
      `CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY,
        client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        section TEXT NOT NULL CHECK (section IN ('pictures','founderStory','previousPosts','faqs','reviews')),
        mime TEXT NOT NULL,
        size INTEGER NOT NULL,
        r2_key TEXT NOT NULL,
        original_name TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS brains (
        client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        built_from_intake_version INTEGER NOT NULL,
        data TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (client_id, version)
      )`,
      `CREATE TABLE IF NOT EXISTS campaigns (
        client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        campaign_id TEXT NOT NULL,
        brain_version INTEGER NOT NULL,
        month TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('in_production','delivered')),
        data TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (client_id, campaign_id)
      )`,
      `CREATE TABLE IF NOT EXISTS status_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        changed_at TEXT NOT NULL,
        changed_by TEXT NOT NULL CHECK (changed_by IN ('client','admin','system'))
      )`,
      `CREATE INDEX IF NOT EXISTS idx_status_history_client ON status_history (client_id, changed_at)`,
      `CREATE TABLE IF NOT EXISTS erasure_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id_hash TEXT NOT NULL,
        erased_at TEXT NOT NULL
      )`
    ]
  },
  {
    id: 2,
    name: "phase3-admin-seen",
    statements: [
      /* The intake version Harry last opened in ScriptForge. A client whose latest
         submitted intake is newer than this shows the "New" badge. */
      `ALTER TABLE clients ADD COLUMN admin_seen_intake_version INTEGER NOT NULL DEFAULT 0`
    ]
  },
  {
    id: 3,
    name: "phase6-gdpr",
    statements: [
      /* When a client has left. Everything is erased RETENTION_MONTHS after this date. */
      `ALTER TABLE clients ADD COLUMN left_at TEXT`,
      /* Who erased: "admin" (Erase now) or "retention" (the 6 month rule). */
      `ALTER TABLE erasure_log ADD COLUMN reason TEXT`
    ]
  },
  {
    id: 4,
    name: "g1-visual-pack",
    statements: [
      /* Finished files Harry attaches to a campaign (V2 phase G1: images for the Visual Pack
         briefs). Part B later shows them to the client in Your content. The bytes live in R2 at
         c/<clientId>/<id>, so erasing the client's folder removes them. ai_image is 1 when the
         picture was made with an AI tool, 0 for a client photo or other real photo. */
      `CREATE TABLE IF NOT EXISTS deliveries (
        id TEXT PRIMARY KEY,
        client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        campaign_id TEXT NOT NULL,
        visual_id TEXT,
        title TEXT,
        kind TEXT NOT NULL CHECK (kind IN ('image','video','pdf','html')),
        ai_image INTEGER NOT NULL DEFAULT 0 CHECK (ai_image IN (0,1)),
        mime TEXT NOT NULL,
        size INTEGER NOT NULL,
        width INTEGER,
        height INTEGER,
        r2_key TEXT NOT NULL,
        original_name TEXT,
        added_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_deliveries_campaign ON deliveries (client_id, campaign_id, added_at)`,
      /* The client's brand kit as Harry keeps it (colours, fonts, logo notes), used by the
         Visual Pack briefs and, in phase G2, the landing pages. */
      `CREATE TABLE IF NOT EXISTS brand_kits (
        client_id TEXT PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
        data TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`
    ]
  }
];
