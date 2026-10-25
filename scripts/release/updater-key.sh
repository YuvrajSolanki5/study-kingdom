#!/usr/bin/env bash
# Creates (once) the Tauri UPDATER signing key pair and prints the public key.
#
# This key signs update bundles so installed apps only accept updates from you.
# It is NOT an Apple Developer ID certificate: Apple code signing/notarization
# is separate (see docs/release.md).
#
#   Private key: $TAURI_KEY_PATH (default ~/.tauri/study-kingdom.key) — back it up!
#                Losing it means existing installs can never update again.
#   Password:    macOS Keychain item "study-kingdom-updater-key".
set -euo pipefail
KEY_PATH="${TAURI_KEY_PATH:-$HOME/.tauri/study-kingdom.key}"
SERVICE="study-kingdom-updater-key"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

if [[ ! -f "$KEY_PATH" ]]; then
  mkdir -p "$(dirname "$KEY_PATH")"
  chmod 700 "$(dirname "$KEY_PATH")"
  PASSWORD="$(openssl rand -base64 32)"
  security add-generic-password -a "$USER" -s "$SERVICE" -w "$PASSWORD" -U
  (cd "$ROOT/apps/desktop" && npx tauri signer generate --ci -w "$KEY_PATH" -p "$PASSWORD" >/dev/null)
  chmod 600 "$KEY_PATH"
  echo "Generated updater key at $KEY_PATH (password stored in Keychain item '$SERVICE')." >&2
else
  echo "Using existing updater key at $KEY_PATH" >&2
fi
cat "$KEY_PATH.pub"
echo
