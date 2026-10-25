#!/usr/bin/env bash
# Encrypted game data and account identities from one consistent snapshot.
# Target restore must have this release's migrations and Supabase Auth schema
# already installed.
set -euo pipefail
umask 077
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
: "${DATABASE_URL:?Set DATABASE_URL to the game_backup (or admin) session-pooler or direct connection}"
: "${BACKUP_KEY_FILE:?Set BACKUP_KEY_FILE to a private key file}"
DEST="${1:-$ROOT/backups/study-kingdom-$(date -u +%Y%m%dT%H%M%SZ).skbak}"
mkdir -p "$(dirname "$DEST")"
[[ ! -e "$DEST" ]] || { echo "Backup destination already exists" >&2;exit 1; }
PART="$DEST.partial.$$"
trap 'rm -f "$PART"' EXIT
node "$ROOT/scripts/db/archive.mjs" export | node "$ROOT/scripts/db/crypto.mjs" encrypt "$PART"
ln "$PART" "$DEST"
printf 'Encrypted backup: %s\n' "$DEST"
