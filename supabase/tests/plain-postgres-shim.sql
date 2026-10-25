-- Minimal stand-in for the Supabase-managed parts of the database so the
-- migrations can run against plain PostgreSQL in tests and CI. Never applied
-- to a Supabase project.
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key,
  email text unique,
  created_at timestamptz not null default now()
);
create table if not exists auth.identities (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade
);
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end
$$;
