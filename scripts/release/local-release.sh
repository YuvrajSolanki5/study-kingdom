#!/usr/bin/env bash
# Builds and publishes a release from this Mac — no paid CI needed.
#   npm run release:version -- 0.2.0   # bump, commit, tag
#   npm run release:local              # build both architectures and publish
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
VERSION="$(node -p "require('./apps/desktop/src-tauri/tauri.conf.json').version")"
if [[ -n "$(git status --porcelain)" ]]; then echo "Commit your changes first." >&2; exit 1; fi
if ! git rev-parse "v$VERSION" >/dev/null 2>&1; then
  echo "Tag v$VERSION does not exist. Run: git tag v$VERSION && git push --follow-tags" >&2
  exit 1
fi
bash scripts/release/build-mac.sh
read -r -p "Publish v$VERSION to GitHub Releases now? [y/N] " answer
[[ "$answer" =~ ^[Yy]$ ]] || { echo "Not published. Artifacts are in release-out/v$VERSION."; exit 0; }
bash scripts/release/publish.sh
