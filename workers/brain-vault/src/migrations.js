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
  },
  {
    id: 5,
    name: "g2a-photo-requests",
    statements: [
      /* Photos Harry asks the client for, one per Visual Pack brief marked Photo needed from
         client. The client answers in the portal; the uploaded picture (file_id) then becomes
         that brief's photo. text_sv and text_en say what to shoot. */
      `CREATE TABLE IF NOT EXISTS photo_requests (
        id TEXT PRIMARY KEY,
        client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        campaign_id TEXT NOT NULL,
        visual_id TEXT NOT NULL,
        placement TEXT,
        text_sv TEXT,
        text_en TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','received','cancelled')),
        file_id TEXT,
        created_at TEXT NOT NULL,
        received_at TEXT
      )`,
      `CREATE INDEX IF NOT EXISTS idx_photo_requests_client ON photo_requests (client_id, state, created_at)`
    ]
  },
  {
    id: 6,
    name: "g2b-pages-tracking-enquiries",
    statements: [
      /* One hosted landing page per campaign, at /go/<client_slug>/<slug>. The HTML is built in
         ScriptForge (in the browser) and stored in R2 at c/<clientId>/p/<pageId>/... so erasing
         the client's folder removes it. ended_key holds the "offer has ended" version. The token
         lets a downloaded copy of the page post enquiries. */
      `CREATE TABLE IF NOT EXISTS pages (
        id TEXT PRIMARY KEY,
        client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        campaign_id TEXT NOT NULL,
        client_slug TEXT NOT NULL,
        slug TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 0,
        state TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','published','unpublished')),
        language TEXT NOT NULL DEFAULT 'sv',
        offer_end TEXT,
        html_key TEXT,
        ended_key TEXT,
        token TEXT NOT NULL,
        form_on INTEGER NOT NULL DEFAULT 0 CHECK (form_on IN (0,1)),
        notice_version TEXT,
        settings TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        published_at TEXT,
        unpublished_at TEXT,
        UNIQUE (client_slug, slug),
        UNIQUE (client_id, campaign_id)
      )`,
      /* Tracked short links: /go/r/<code>. One per output and per printed item (QR codes). */
      `CREATE TABLE IF NOT EXISTS links (
        code TEXT PRIMARY KEY,
        client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        page_id TEXT NOT NULL,
        channel TEXT NOT NULL,
        medium TEXT NOT NULL,
        output_key TEXT NOT NULL,
        label TEXT,
        offer_code TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_links_page ON links (page_id)`,
      /* Raw counting events, kept 90 days. No cookies, no IP address: visitor is a hash of IP
         and browser with a salt that changes and is deleted every day. */
      `CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        page_id TEXT NOT NULL,
        link_code TEXT,
        type TEXT NOT NULL,
        button TEXT,
        channel TEXT NOT NULL,
        utm_source TEXT,
        utm_medium TEXT,
        utm_campaign TEXT,
        utm_content TEXT,
        device TEXT,
        country TEXT,
        visitor TEXT,
        day TEXT NOT NULL,
        hour INTEGER NOT NULL,
        at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_events_page_day ON events (page_id, day)`,
      `CREATE INDEX IF NOT EXISTS idx_events_visitor ON events (page_id, day, visitor)`,
      /* Daily totals per page, channel and event type. They identify no one and stay while the
         client is active. type: view, unique, click_<button>, form, scan. */
      `CREATE TABLE IF NOT EXISTS daily_stats (
        client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        page_id TEXT NOT NULL,
        day TEXT NOT NULL,
        channel TEXT NOT NULL,
        type TEXT NOT NULL,
        n INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (page_id, day, channel, type)
      )`,
      /* Enquiries from the page form. The client business is the controller; deleted 90 days
         after the offer ends. */
      `CREATE TABLE IF NOT EXISTS leads (
        id TEXT PRIMARY KEY,
        client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        page_id TEXT NOT NULL,
        campaign_id TEXT NOT NULL,
        name TEXT NOT NULL,
        phone TEXT,
        email TEXT,
        message TEXT,
        future_offers INTEGER NOT NULL DEFAULT 0 CHECK (future_offers IN (0,1)),
        notice_version TEXT,
        channel TEXT,
        state TEXT NOT NULL DEFAULT 'new' CHECK (state IN ('new','contacted')),
        at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_leads_client ON leads (client_id, at)`,
      /* Before and after numbers per campaign (metric keys such as orders, new_customers,
         followers_instagram, redemptions_SANDY-IG). period: before or after. */
      `CREATE TABLE IF NOT EXISTS baselines (
        client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        campaign_id TEXT NOT NULL,
        metric TEXT NOT NULL,
        period TEXT NOT NULL CHECK (period IN ('before','after')),
        value REAL NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (client_id, campaign_id, metric, period)
      )`,
      /* What the campaign cost: Harry's fee, ad spend per channel, and the client's average
         order value for the estimated return. */
      `CREATE TABLE IF NOT EXISTS costs (
        client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        campaign_id TEXT NOT NULL,
        currency TEXT NOT NULL DEFAULT 'SEK',
        fee REAL NOT NULL DEFAULT 0,
        ad_spend TEXT NOT NULL DEFAULT '{}',
        avg_order_value REAL,
        baseline_period TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (client_id, campaign_id)
      )`,
      /* The daily salt for visitor hashes. Today's row only; older rows are deleted daily. */
      `CREATE TABLE IF NOT EXISTS salts (
        day TEXT PRIMARY KEY,
        salt TEXT NOT NULL
      )`
    ]
  },
  {
    id: 7,
    name: "parts-a-b-review-and-content",
    statements: [
      /* Part A: a frozen copy of the campaign as the client sees it, one per review round.
         state: waiting (sent, no answer), changes (she asked for changes), approved,
         withdrawn (replaced by a newer round before she answered). */
      `CREATE TABLE IF NOT EXISTS reviews (
        id TEXT PRIMARY KEY,
        client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        campaign_id TEXT NOT NULL,
        round INTEGER NOT NULL,
        state TEXT NOT NULL DEFAULT 'waiting' CHECK (state IN ('waiting','changes','approved','withdrawn')),
        data TEXT NOT NULL,
        sent_at TEXT NOT NULL,
        decided_at TEXT,
        UNIQUE (client_id, campaign_id, round)
      )`,
      `CREATE TABLE IF NOT EXISTS review_items (
        review_id TEXT NOT NULL,
        client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        output_key TEXT NOT NULL,
        verdict TEXT NOT NULL CHECK (verdict IN ('ok','change')),
        comment TEXT,
        at TEXT NOT NULL,
        PRIMARY KEY (review_id, output_key)
      )`,
      /* What happened to a campaign that is not in other tables: rounds sent, decisions, and
         Mark delivered without approval (with Harry's reason). */
      `CREATE TABLE IF NOT EXISTS campaign_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        campaign_id TEXT NOT NULL,
        event TEXT NOT NULL,
        detail TEXT,
        at TEXT NOT NULL
      )`,
      /* Part B: large delivered files (videos, PDFs) go to R2 in parts. */
      `CREATE TABLE IF NOT EXISTS uploads (
        id TEXT PRIMARY KEY,
        client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        campaign_id TEXT NOT NULL,
        r2_key TEXT NOT NULL,
        upload_id TEXT NOT NULL,
        name TEXT,
        title TEXT,
        mime TEXT NOT NULL,
        kind TEXT NOT NULL,
        size INTEGER NOT NULL,
        ai_image INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      )`,
      /* Server-side secrets the Worker makes itself (the key that signs download links). */
      `CREATE TABLE IF NOT EXISTS secrets (
        name TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )`
    ]
  },
  {
    id: 8,
    name: "part-h-language-review",
    statements: [
      /* Part H: the TAHA team (Swedish language reviewers). Not clients: a member signs in
         with a magic link of their own and sees only the language items of clients Harry
         assigned. agreement_at must be set before the invite works. */
      `CREATE TABLE IF NOT EXISTS team_members (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL DEFAULT 'reviewer' CHECK (role IN ('reviewer')),
        languages TEXT NOT NULL DEFAULT 'sv',
        agreement_at TEXT,
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
        created_at TEXT NOT NULL,
        last_login_at TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS team_access (
        member_id TEXT NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
        client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        PRIMARY KEY (member_id, client_id)
      )`,
      /* Login links and sessions for team members, kept apart from client and admin ones. */
      `CREATE TABLE IF NOT EXISTS member_tokens (
        token_hash TEXT PRIMARY KEY,
        member_id TEXT NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        used_at INTEGER
      )`,
      `CREATE TABLE IF NOT EXISTS member_sessions (
        session_hash TEXT PRIMARY KEY,
        member_id TEXT NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        last_seen INTEGER NOT NULL
      )`,
      /* One Swedish text field of one campaign output. */
      `CREATE TABLE IF NOT EXISTS lang_items (
        id TEXT PRIMARY KEY,
        client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        campaign_id TEXT NOT NULL,
        field_path TEXT NOT NULL,
        output_key TEXT NOT NULL,
        label TEXT NOT NULL,
        kind TEXT NOT NULL,
        max_len INTEGER,
        language TEXT NOT NULL DEFAULT 'sv',
        state TEXT NOT NULL DEFAULT 'waiting' CHECK (state IN ('waiting','done','flagged','sent_back','approved','kept','outdated')),
        round INTEGER NOT NULL DEFAULT 1,
        member_id TEXT,
        due TEXT,
        note TEXT,
        flag_comment TEXT,
        reviewer_note TEXT,
        draft TEXT,
        sent_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (client_id, campaign_id, field_path)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_lang_items_member ON lang_items (member_id, state)`,
      /* Every version of every item, never overwritten. kind: machine, reviewed, approved. */
      `CREATE TABLE IF NOT EXISTS lang_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id TEXT NOT NULL,
        client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('machine','reviewed','approved')),
        text TEXT NOT NULL,
        author TEXT NOT NULL,
        round INTEGER NOT NULL,
        base_hash TEXT NOT NULL,
        at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_lang_versions_item ON lang_versions (item_id, id)`,
      `CREATE TABLE IF NOT EXISTS lang_notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        preferred TEXT NOT NULL,
        reason TEXT,
        from_item TEXT,
        at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS lang_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        member_id TEXT,
        item_id TEXT,
        action TEXT NOT NULL,
        detail TEXT,
        at TEXT NOT NULL
      )`,
      /* Always review Swedish (on by default). */
      `ALTER TABLE clients ADD COLUMN lang_review INTEGER NOT NULL DEFAULT 1`
    ]
  },
  {
    id: 9,
    name: "part-c-monthly-rhythm",
    statements: [
      /* Part C: each client's monthly plan. No row means the defaults (1 a month, ready on the
         25th for the next month, Instagram, Facebook and Google Business, goal sales). */
      `CREATE TABLE IF NOT EXISTS plans (
        client_id TEXT PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
        per_month INTEGER NOT NULL DEFAULT 1 CHECK (per_month BETWEEN 1 AND 4),
        ready_day INTEGER NOT NULL DEFAULT 25 CHECK (ready_day BETWEEN 1 AND 28),
        channels TEXT NOT NULL,
        goal TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        start_month TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      /* When a once-a-month job last ran (the reminder on the 20th). No client data. */
      `CREATE TABLE IF NOT EXISTS job_runs (
        name TEXT PRIMARY KEY,
        period TEXT NOT NULL,
        at TEXT NOT NULL
      )`
    ]
  },
  {
    id: 10,
    name: "part-d-results",
    statements: [
      /* Part D: the client's business type picks her results questions (restaurant, salon, other). */
      `ALTER TABLE clients ADD COLUMN niche TEXT NOT NULL DEFAULT 'other'`,
      /* One row per campaign: what the client reported (client_data) and Harry's corrections
         and note (harry_data, note), kept apart so her own answers are never overwritten. */
      `CREATE TABLE IF NOT EXISTS results (
        client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        campaign_id TEXT NOT NULL,
        month TEXT NOT NULL,
        client_data TEXT,
        client_at TEXT,
        skipped INTEGER NOT NULL DEFAULT 0,
        harry_data TEXT,
        note TEXT,
        harry_at TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (client_id, campaign_id)
      )`
    ]
  }
];
