-- Hosted Supabase owns the auth schema and enables RLS on its tables, so the
-- grants in the previous migration cannot reach accounts there. Exports read
-- them through these owner-privileged functions instead; rows follow the live
-- table definitions, so Auth upgrades that add columns are still captured.
create schema if not exists backup_accounts;
revoke all on schema backup_accounts from public;

create or replace function backup_accounts.users() returns setof auth.users
  language sql stable security definer set search_path = ''
  as $$ select * from auth.users $$;
create or replace function backup_accounts.identities() returns setof auth.identities
  language sql stable security definer set search_path = ''
  as $$ select * from auth.identities $$;

revoke all on all functions in schema backup_accounts from public, anon, authenticated, service_role;
grant usage on schema backup_accounts to game_backup;
grant execute on all functions in schema backup_accounts to game_backup;

-- game_backup no longer reads auth directly. (Hosted projects warn that the
-- schema grant never applied; that is expected.)
revoke select on auth.users, auth.identities from game_backup;
revoke usage on schema auth from game_backup;
