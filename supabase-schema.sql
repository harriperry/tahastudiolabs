-- ScriptForge minimal schema. Run in Supabase SQL Editor.
-- Data-minimization contract: NOTHING here may ever hold script content or API keys.

create table if not exists public.subscriptions (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  status     text not null default 'inactive' check (status in ('active','inactive')),
  tier       text not null default 'free'     check (tier in ('free','pro')),
  updated_at timestamptz not null default now()
);

create table if not exists public.license_redemptions (
  license_key text primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  redeemed_at timestamptz not null default now()
);

create table if not exists public.active_sessions (
  session_id uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_seen  timestamptz not null default now()
);
create index if not exists active_sessions_user_idx on public.active_sessions(user_id);

-- Lock everything down: no client-side access at all.
-- Only the Pages Functions (service role) can read/write these tables.
alter table public.subscriptions       enable row level security;
alter table public.license_redemptions enable row level security;
alter table public.active_sessions     enable row level security;
-- (no policies created on purpose: anon/authenticated roles get zero access)
