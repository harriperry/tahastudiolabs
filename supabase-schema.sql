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

-- ---------------------------------------------------------------------------
-- Anonymized site visit counter (admin-only)
-- Added: privacy-preserving visit tracking. Never stores raw IP addresses,
-- only a salted SHA-256 hash. Aggregate-only; not linked to any user account.
-- Written by functions/api/track-visit.js, read by functions/api/visit-stats.js
-- (both via the service-role key, so RLS below simply denies anon/authenticated
-- direct access and all access goes through those two server-side functions).
-- ---------------------------------------------------------------------------

create table if not exists public.site_visits (
  ip_hash text primary key,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  visit_count integer not null default 1
);

alter table public.site_visits enable row level security;

-- Atomically upsert a visit for a given salted IP hash.
create or replace function public.increment_visit(p_ip_hash text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.site_visits (ip_hash, first_seen, last_seen, visit_count)
  values (p_ip_hash, now(), now(), 1)
  on conflict (ip_hash)
  do update set last_seen = now(), visit_count = site_visits.visit_count + 1;
end;
$$;

-- Aggregate-only totals for the admin stats view. Never returns per-row data.
create or replace function public.visit_stats()
returns table(unique_visitors bigint, total_visits bigint)
language sql
security definer
set search_path = public
as $$
  select count(*)::bigint as unique_visitors, coalesce(sum(visit_count), 0)::bigint as total_visits
  from public.site_visits;
$$;
