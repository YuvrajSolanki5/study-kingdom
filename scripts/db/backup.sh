#!/usr/bin/env bash
# Encrypted game data and account identities. Target restore must have this
# release's migrations and Supabase Auth schema already installed.
set -euo pipefail
umask 077
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
source "$ROOT/scripts/db/common.sh"
: "${DATABASE_URL:?Set DATABASE_URL to the admin session-pooler or direct connection}"
: "${BACKUP_KEY_FILE:?Set BACKUP_KEY_FILE to a private key file}"
DEST="${1:-$ROOT/backups/study-kingdom-$(date -u +%Y%m%dT%H%M%SZ).skbak}"
mkdir -p "$(dirname "$DEST")"
[[ ! -e "$DEST" ]] || { echo "Backup destination already exists" >&2;exit 1; }
PART="$DEST.partial.$$"
trap 'rm -f "$PART"' EXIT
# pg_dump obtains one consistent snapshot of all game/account tables.
pg_tool "$DATABASE_URL" pg_dump --format=custom --data-only --no-owner --no-acl --enable-row-security \
  --table='game.*' --table=auth.users --table=auth.identities \
  | node "$ROOT/scripts/db/crypto.mjs" encrypt "$PART"
ln "$PART" "$DEST"
printf 'Encrypted backup: %s\n' "$DEST"
