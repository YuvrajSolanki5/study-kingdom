-- Study Kingdom core schema: players, append-only ledger, idempotent request
-- receipts, study sessions and battles.
--
-- Game tables live in the `game` schema, which is NOT exposed through the
-- Supabase Data API. Only the Worker API (role game_api) reads or writes them.

create schema if not exists game;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'game_api') then
    -- Password is set out of band (see docs/setup.md); never in a migration.
    create role game_api login noinherit;
  end if;
end
$$;

grant usage on schema game to game_api;
revoke all on schema game from public;
alter default privileges in schema game revoke all on tables from public;

-- ---------------------------------------------------------------------------
-- Players: one locked aggregate row per account.
-- ---------------------------------------------------------------------------
create table game.players (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 2 and 24),
  friend_code text not null unique check (friend_code ~ '^[A-Z0-9]{8}$'),
  timezone text not null default 'UTC',
  hq_level smallint not null default 1 check (hq_level between 1 and 10),
  trophies integer not null default 0 check (trophies >= 0),
  gold bigint not null check (gold >= 0),
  essence bigint not null check (essence >= 0),
  state jsonb not null,
  state_version integer not null default 1,
  content_version text not null,
  settings jsonb not null default '{}'::jsonb,
  army_strength integer not null default 0,
  defense_strength integer not null default 0,
  shield_until timestamptz,
  last_active_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index players_matchmaking on game.players (hq_level, trophies);

-- ---------------------------------------------------------------------------
-- Ledger: every Gold/Essence change, append-only, idempotent per key.
-- ---------------------------------------------------------------------------
create table game.ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references game.players (user_id) on delete cascade,
  resource text not null check (resource in ('gold', 'essence')),
  amount bigint not null check (amount <> 0),
  balance_after bigint not null check (balance_after >= 0),
  reason text not null,
  ref text,
  idempotency_key text not null,
  created_at timestamptz not null default now()
);

create unique index ledger_idempotency on game.ledger (user_id, idempotency_key, resource);
create index ledger_user_time on game.ledger (user_id, created_at desc);

create function game.reject_ledger_change() returns trigger
language plpgsql as $$
begin
  raise exception 'game.ledger is append-only';
end;
$$;

create trigger ledger_append_only
  before update on game.ledger
  for each row execute function game.reject_ledger_change();

create trigger ledger_no_truncate
  before truncate on game.ledger
  for each statement execute function game.reject_ledger_change();

-- Balances must always equal the sum of the ledger. Used by tests and the
-- reconciliation check; never by gameplay.
create view game.ledger_mismatches as
select p.user_id, p.gold, p.essence,
       coalesce(sum(l.amount) filter (where l.resource = 'gold'), 0) as ledger_gold,
       coalesce(sum(l.amount) filter (where l.resource = 'essence'), 0) as ledger_essence
from game.players p
left join game.ledger l on l.user_id = p.user_id
group by p.user_id
having p.gold <> coalesce(sum(l.amount) filter (where l.resource = 'gold'), 0)
    or p.essence <> coalesce(sum(l.amount) filter (where l.resource = 'essence'), 0);

-- ---------------------------------------------------------------------------
-- Request receipts: replaying a request returns the stored response.
-- ---------------------------------------------------------------------------
create table game.requests (
  user_id uuid not null references game.players (user_id) on delete cascade,
  request_id uuid not null,
  kind text not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, request_id)
);

create index requests_created on game.requests (created_at);

-- ---------------------------------------------------------------------------
-- Study sessions: Created -> Running <-> Paused -> Completed / Abandoned.
-- ---------------------------------------------------------------------------
create table game.study_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references game.players (user_id) on delete cascade,
  device_id text not null check (char_length(device_id) between 8 and 64),
  platform text not null check (platform in ('web', 'desktop')),
  mode text not null check (mode in ('computer', 'paper')),
  status text not null check (status in ('created', 'running', 'paused', 'completed', 'abandoned')),
  goal text not null default '' check (char_length(goal) <= 200),
  subjects jsonb not null default '[]'::jsonb check (jsonb_typeof(subjects) = 'array'),
  planned_minutes smallint not null check (planned_minutes between 5 and 240),
  clock jsonb not null,
  heartbeat_seq integer not null default 0,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  ended_at timestamptz,
  last_seen_at timestamptz not null default now(),
  local_date date,
  eligible_seconds integer not null default 0,
  unreviewed_seconds integer not null default 0,
  reviewed_seconds integer not null default 0,
  reviewed_at timestamptz,
  competitive_seconds integer not null default 0,
  reward_gold integer not null default 0,
  reward_essence integer not null default 0,
  overflow_gold integer not null default 0,
  overflow_essence integer not null default 0,
  bonus_percent smallint not null default 0,
  recall jsonb,
  end_reason text
);

-- One earning session per account across all devices.
create unique index study_one_active on game.study_sessions (user_id)
  where status in ('created', 'running', 'paused');
create index study_user_time on game.study_sessions (user_id, created_at desc);
create index study_user_day on game.study_sessions (user_id, local_date);
create index study_stale on game.study_sessions (last_seen_at)
  where status in ('created', 'running', 'paused');

-- ---------------------------------------------------------------------------
-- Battles: frozen setup at start, commands at submit, verified result.
-- ---------------------------------------------------------------------------
create table game.battles (
  id uuid primary key default gen_random_uuid(),
  attacker_id uuid not null references game.players (user_id) on delete cascade,
  defender_id uuid references game.players (user_id) on delete set null,
  kind text not null check (kind in ('campaign', 'ranked', 'friendly', 'war')),
  target_ref text,
  status text not null check (status in ('active', 'verifying', 'settled', 'rejected')),
  sim_version integer not null,
  content_version text not null,
  seed bigint not null check (seed between 0 and 4294967295),
  setup jsonb not null,
  commands jsonb,
  client_hash text,
  result jsonb,
  checkpoint jsonb,
  verify_attempts integer not null default 0,
  rewards jsonb,
  attacker_trophies_delta integer,
  defender_trophies_delta integer,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  submitted_at timestamptz,
  settled_at timestamptz,
  share_token text unique,
  reject_reason text
);

create index battles_attacker on game.battles (attacker_id, started_at desc);
create index battles_defender on game.battles (defender_id, started_at desc) where defender_id is not null;
create unique index battles_one_active on game.battles (attacker_id) where status in ('active', 'verifying');
create index battles_pending on game.battles (status, expires_at) where status in ('active', 'verifying');

-- ---------------------------------------------------------------------------
-- Client error reports (free-tier error monitoring).
-- ---------------------------------------------------------------------------
create table game.client_errors (
  id bigint generated always as identity primary key,
  user_id uuid,
  platform text,
  app_version text,
  message text not null,
  stack text,
  url text,
  created_at timestamptz not null default now()
);

create index client_errors_time on game.client_errors (created_at desc);

-- ---------------------------------------------------------------------------
-- Privileges: the API role gets exactly what it needs. RLS is enabled with no
-- policies so the Data API roles (anon, authenticated) can never read rows
-- even if the schema were exposed by mistake.
-- ---------------------------------------------------------------------------
alter table game.players enable row level security;
alter table game.ledger enable row level security;
alter table game.requests enable row level security;
alter table game.study_sessions enable row level security;
alter table game.battles enable row level security;
alter table game.client_errors enable row level security;

alter role game_api set search_path = game, public;
grant select, insert, update on game.players to game_api;
grant select, insert on game.ledger to game_api;
grant select on game.ledger_mismatches to game_api;
grant select, insert, delete on game.requests to game_api;
grant select, insert, update on game.study_sessions to game_api;
grant select, insert, update on game.battles to game_api;
grant insert, select, delete on game.client_errors to game_api;

-- The API role enforces per-player access in code; give it a permissive policy.
create policy api_all on game.players for all to game_api using (true) with check (true);
create policy api_all on game.ledger for all to game_api using (true) with check (true);
create policy api_all on game.requests for all to game_api using (true) with check (true);
create policy api_all on game.study_sessions for all to game_api using (true) with check (true);
create policy api_all on game.battles for all to game_api using (true) with check (true);
create policy api_all on game.client_errors for all to game_api using (true) with check (true);
