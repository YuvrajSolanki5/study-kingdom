create table game.clans (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 40),
  code text not null unique default substr(replace(gen_random_uuid()::text,'-',''),1,16),
  created_at timestamptz not null default now()
);
create table game.clan_members (
  user_id uuid primary key references game.players on delete cascade,
  clan_id uuid not null references game.clans on delete cascade,
  role text not null check (role in ('leader','officer','member')),
  joined_at timestamptz not null
);
create index clan_members_clan on game.clan_members(clan_id);
create unique index clan_one_leader on game.clan_members(clan_id) where role='leader';
create table game.clan_invites (
  clan_id uuid not null references game.clans on delete cascade,
  user_id uuid not null references game.players on delete cascade,
  expires_at timestamptz not null,
  primary key(clan_id,user_id)
);
create table game.reinforcement_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references game.players on delete cascade,
  clan_id uuid not null references game.clans on delete cascade,
  capacity integer not null check (capacity between 1 and 100),
  troops jsonb not null default '[]',
  housing integer not null default 0 check (housing between 0 and capacity),
  claimed boolean not null default false,
  created_at timestamptz not null,
  check (jsonb_typeof(troops)='array')
);
create index reinforcement_requests_clan on game.reinforcement_requests(clan_id,created_at);
create unique index reinforcement_one_open on game.reinforcement_requests(user_id) where not claimed;
create table game.clan_objectives (
  clan_id uuid not null references game.clans on delete cascade,
  week timestamptz not null,
  roster jsonb not null,
  target_minutes integer not null,
  primary key(clan_id,week)
);
create table game.cosmetics (
  user_id uuid not null references game.players on delete cascade,
  code text not null,
  earned_at timestamptz not null,
  primary key(user_id,code)
);
create table game.wars (
  id uuid primary key default gen_random_uuid(),
  home uuid not null references game.clans,
  away uuid not null references game.clans,
  home_roster jsonb not null,
  status text not null check (status in ('invited','declined','preparation','battle','settled')),
  invited_at timestamptz not null,
  preparation_until timestamptz,
  battle_until timestamptz,
  settled_at timestamptz,
  result jsonb,
  check (home<>away)
);
create index wars_due on game.wars(status,battle_until,preparation_until);
create table game.war_roster (
  war_id uuid not null references game.wars on delete cascade,
  user_id uuid not null references game.players,
  clan_id uuid not null references game.clans,
  position smallint not null check (position between 1 and 5),
  snapshot jsonb not null,
  preparation_state jsonb not null,
  content_version text not null,
  primary key(war_id,user_id), unique(war_id,clan_id,position)
);
create table game.war_attacks (
  id uuid primary key default gen_random_uuid(),
  war_id uuid not null references game.wars,
  attacker uuid not null references game.players,
  defender uuid not null references game.players,
  attempt smallint not null check (attempt between 1 and 2),
  battle_id uuid unique references game.battles,
  unique(war_id,attacker,attempt),
  foreign key(war_id,attacker) references game.war_roster(war_id,user_id),
  foreign key(war_id,defender) references game.war_roster(war_id,user_id)
);
do $$ declare t text; begin
  foreach t in array array['clans','clan_members','clan_invites','reinforcement_requests','clan_objectives','cosmetics','wars','war_roster','war_attacks'] loop
    execute format('alter table game.%I enable row level security',t);
    execute format('grant select,insert,update,delete on game.%I to game_api',t);
    execute format('create policy api_access on game.%I to game_api using (true) with check (true)',t);
  end loop;
end $$;
