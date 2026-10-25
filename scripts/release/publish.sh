#!/usr/bin/env bash
# Uploads a built release (DMGs, updater bundles, signatures, latest.json) to a
# public GitHub Release. Requires the GitHub CLI (`gh auth login`) locally, or
# GH_TOKEN in CI.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
VERSION="$(node -p "require('./apps/desktop/src-tauri/tauri.conf.json').version")"
REPO="${GITHUB_REPOSITORY:-$(node -p "require('./release.config.json').githubRepo")}"
OUT="$ROOT/release-out/v$VERSION"
[[ -f "$OUT/latest.json" ]] || { echo "Build first: scripts/release/build-mac.sh" >&2; exit 1; }
NOTES="$(mktemp)"
if [[ -f release-notes.md ]]; then cp release-notes.md "$NOTES"; else echo "Study Kingdom $VERSION" > "$NOTES"; fi
cat >> "$NOTES" <<'TXT'

**Install:** download the DMG for your Mac (aarch64 = Apple silicon, x86_64 = Intel). Installed apps update themselves.
TXT
if gh release view "v$VERSION" --repo "$REPO" >/dev/null 2>&1; then
  gh release upload "v$VERSION" "$OUT"/* --repo "$REPO" --clobber
else
  gh release create "v$VERSION" "$OUT"/* --repo "$REPO" --title "Study Kingdom $VERSION" --notes-file "$NOTES" --latest
fi
echo "Published https://github.com/$REPO/releases/tag/v$VERSION"
