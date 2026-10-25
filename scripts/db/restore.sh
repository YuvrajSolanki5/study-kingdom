#!/usr/bin/env bash
# Restores only into an empty, migrated recovery database. Never overwrites data.
set -euo pipefail
umask 077
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
source "$ROOT/scripts/db/common.sh"
: "${RESTORE_DATABASE_URL:?Set RESTORE_DATABASE_URL to a separate, migrated recovery database}"
: "${BACKUP_KEY_FILE:?Set BACKUP_KEY_FILE to the original backup key file}"
[[ -f "${1:-}" ]] || { echo 'usage: restore.sh BACKUP.skbak' >&2; exit 2; }
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
node "$ROOT/scripts/db/crypto.mjs" decrypt "$1" "$TMP/archive.dump"
# Authenticate the entire archive before making any database changes.
pg_tool "$RESTORE_DATABASE_URL" psql -X -v ON_ERROR_STOP=1 -q <<'SQL'
do $$ declare t record; occupied boolean; begin
  if to_regclass('game.players') is null or to_regclass('auth.users') is null then
    raise exception 'Apply this release migrations and Supabase Auth schema first';
  end if;
  for t in select schemaname,tablename from pg_tables where schemaname='game' or (schemaname='auth' and tablename in ('users','identities')) loop
    execute format('select exists(select 1 from %I.%I)',t.schemaname,t.tablename) into occupied;
    if occupied then raise exception 'Recovery target must be empty: %.%',t.schemaname,t.tablename;end if;
  end loop;
end $$;
SQL
pg_tool "$RESTORE_DATABASE_URL" pg_restore --data-only --no-owner --no-acl \
  --single-transaction --exit-on-error < "$TMP/archive.dump"
pg_tool "$RESTORE_DATABASE_URL" psql -X -v ON_ERROR_STOP=1 -q <<'SQL'
do $$ begin
  if exists(select 1 from game.ledger_mismatches) then raise exception 'Restored ledger does not reconcile';end if;
end $$;
SQL
printf 'Restore complete; ledger reconciles. Verify accounts and battles before switching deployments.\n'
