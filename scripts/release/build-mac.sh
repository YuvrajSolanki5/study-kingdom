#!/usr/bin/env bash
# Builds the macOS app for Apple silicon and Intel: DMGs for first install and
# signed updater bundles (.app.tar.gz + .sig) plus latest.json for updates.
# Runs identically on a developer Mac and in GitHub Actions.
#
# Updater signing (always required): TAURI_SIGNING_PRIVATE_KEY[_PASSWORD]
#   - CI: repository secrets.
#   - Local: read from ~/.tauri/study-kingdom.key and the Keychain.
# Apple code signing + notarization (optional, needs a paid Developer ID):
#   APPLE_SIGNING_IDENTITY, APPLE_ID, APPLE_PASSWORD, APPLE_TEAM_ID
#   (or APPLE_API_KEY, APPLE_API_ISSUER, APPLE_API_KEY_PATH). Without them the
#   app is ad-hoc signed and users approve it once in System Settings.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
export PATH="$HOME/.cargo/bin:$PATH"

VERSION="$(node -p "require('./apps/desktop/src-tauri/tauri.conf.json').version")"
OUT="$ROOT/release-out/v$VERSION"
rm -rf "$OUT" && mkdir -p "$OUT"
CONFIG="$(node scripts/release/desktop-config.mjs)"
export VITE_API_URL="${SK_API_URL:-$(node -p "require('./release.config.json').apiUrl")}"

if [[ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]]; then
  KEY_PATH="${TAURI_KEY_PATH:-$HOME/.tauri/study-kingdom.key}"
  [[ -f "$KEY_PATH" ]] || { echo "No updater key. Run scripts/release/updater-key.sh" >&2; exit 1; }
  export TAURI_SIGNING_PRIVATE_KEY="$(cat "$KEY_PATH")"
  export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$(security find-generic-password -s study-kingdom-updater-key -w)"
fi

if [[ -n "${APPLE_SIGNING_IDENTITY:-}" ]]; then
  echo "Apple code signing with: $APPLE_SIGNING_IDENTITY"
else
  echo "No APPLE_SIGNING_IDENTITY: ad-hoc signing (Gatekeeper will ask users to approve the app once)."
fi

# The styled DMG window needs Finder automation (an interactive permission
# prompt). Scripted builds skip that step; set SK_PRETTY_DMG=1 to keep it.
if [[ -z "${SK_PRETTY_DMG:-}" ]]; then export CI=true; fi

TARGETS="${SK_TARGETS:-$(node -p "require('./release.config.json').targets.join(' ')")}"
for target in $TARGETS; do
  arch="${target%%-*}"
  echo "==> Building $target"
  rustup target add "$target" >/dev/null
  (cd apps/desktop && npx tauri build --target "$target" --config "$CONFIG" --bundles app,dmg)
  bundle="apps/desktop/src-tauri/target/$target/release/bundle"
  cp "$(ls "$bundle"/dmg/*.dmg | head -1)" "$OUT/StudyKingdom_${VERSION}_${arch}.dmg"
  cp "$bundle/macos/Study Kingdom.app.tar.gz" "$OUT/StudyKingdom_${VERSION}_${arch}.app.tar.gz"
  cp "$bundle/macos/Study Kingdom.app.tar.gz.sig" "$OUT/StudyKingdom_${VERSION}_${arch}.app.tar.gz.sig"
done

node scripts/release/manifest.mjs "$OUT" "$VERSION"
node scripts/release/verify-updates.mjs "$OUT"
echo "Artifacts in $OUT:"
ls -lh "$OUT"
