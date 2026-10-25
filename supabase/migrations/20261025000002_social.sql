-- Private social features; all access goes through the authenticated API.
create table game.friendships (
  a uuid not null references game.players on delete cascade,
  b uuid not null references game.players on delete cascade,
  requested_by uuid not null references game.players on delete cascade,
  accepted boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (a,b), check (a < b), check (requested_by in (a,b))
);
create table game.blocks (
  user_id uuid not null references game.players on delete cascade,
  target_id uuid not null references game.players on delete cascade,
  primary key (user_id,target_id), check (user_id <> target_id)
);
create table game.challenges (
  id uuid primary key default gen_random_uuid(),
  sender uuid not null references game.players on delete cascade,
  recipient uuid not null references game.players on delete cascade,
  expires_at timestamptz not null,
  battle_id uuid unique references game.battles,
  created_at timestamptz not null default now(), check (sender <> recipient)
);
create index challenges_recipient on game.challenges(recipient,expires_at);
create table game.leagues (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references game.players on delete cascade,
  name text not null check (char_length(name) between 2 and 40),
  code text not null unique default substr(replace(gen_random_uuid()::text,'-',''),1,16),
  created_at timestamptz not null default now()
);
create table game.league_members (
  league_id uuid not null references game.leagues on delete cascade,
  user_id uuid not null references game.players on delete cascade,
  joined_at timestamptz not null,
  primary key (league_id,user_id)
);
create table game.study_rooms (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references game.players on delete cascade,
  name text not null check (char_length(name) between 2 and 40),
  code text not null unique default substr(replace(gen_random_uuid()::text,'-',''),1,16)
);
create table game.room_members (
  user_id uuid primary key references game.players on delete cascade,
  room_id uuid not null references game.study_rooms on delete cascade,
  last_seen_at timestamptz not null
);
create index room_members_room on game.room_members(room_id);
create table game.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references game.players on delete cascade,
  message text not null,
  dedupe_key text not null,
  created_at timestamptz not null default now(),
  unique (user_id,dedupe_key)
);
create index notifications_user on game.notifications(user_id,id);
do $$ declare t text; begin
  foreach t in array array['friendships','blocks','challenges','leagues','league_members','study_rooms','room_members','notifications'] loop
    execute format('alter table game.%I enable row level security',t);
    execute format('grant select,insert,update,delete on game.%I to game_api',t);
    execute format('create policy api_access on game.%I to game_api using (true) with check (true)',t);
  end loop;
end $$;
grant usage,select on sequence game.notifications_id_seq to game_api;
