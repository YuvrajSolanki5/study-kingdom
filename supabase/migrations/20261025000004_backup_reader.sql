-- Nightly exports use a read-only account, separate from migrations and the API.
-- Set its password outside migrations; it has no login credential by default.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'game_backup') then
    create role game_backup login noinherit;
  end if;
end $$;

grant usage on schema game, auth to game_backup;
grant select on all tables in schema game to game_backup;
grant select on all sequences in schema game to game_backup;
grant select on auth.users, auth.identities to game_backup;

do $$ declare t record; begin
  for t in select tablename from pg_tables where schemaname='game' and rowsecurity loop
    execute format('create policy backup_read on game.%I for select to game_backup using (true)', t.tablename);
  end loop;
end $$;
