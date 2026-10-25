# Mac releases and updates

The Mac app is a Tauri v2 shell around the shared web client. Each release publishes, to a **public GitHub Release**:

| File | Purpose |
| --- | --- |
| `StudyKingdom_<v>_aarch64.dmg`, `StudyKingdom_<v>_x86_64.dmg` | First install (Apple silicon / Intel) |
| `StudyKingdom_<v>_<arch>.app.tar.gz` | Updater bundle |
| `StudyKingdom_<v>_<arch>.app.tar.gz.sig` | Updater signature for that bundle |
| `latest.json` | Update manifest: version, notes, per-arch URL + signature |

Installed apps check `https://github.com/<owner>/<repo>/releases/latest/download/latest.json` (HTTPS only) at launch and every 6 hours, show an update prompt, verify the bundle's signature against the public key compiled into the app, install it, and relaunch. Updates wait while a study session or battle is in progress.

## Two different kinds of signing

| | Updater signature (required) | Apple Developer ID signing + notarization (optional) |
| --- | --- | --- |
| What | Minisign-style signature over each updater bundle | Apple code signature on the `.app`/`.dmg`, notarization ticket |
| Proves | The update came from you; the app refuses anything else | To macOS Gatekeeper that the app is from an identified developer and malware-scanned |
| Key | Generated locally, free: `scripts/release/updater-key.sh` | Apple Developer Program (US$99/year) |
| Without it | Updates cannot be published | App is ad-hoc signed; first launch needs **System Settings → Privacy & Security → Open Anyway** (once) |

The updater key is **not** an Apple certificate and Apple signing does not replace it.

## One-time setup

1. **Updater key** (already generated on this Mac by `scripts/release/updater-key.sh`):
   - Private key: `~/.tauri/study-kingdom.key` — **back it up** (password manager or offline storage). If it is lost, existing installs can never update again.
   - Password: macOS Keychain item `study-kingdom-updater-key` (`security find-generic-password -s study-kingdom-updater-key -w`).
   - Public key: in `release.config.json` (safe to commit).
2. **`release.config.json`**: set `githubRepo` (`owner/name`, public) and `apiUrl` (your Worker URL, `https://...`). The bundle identifier `app.studykingdom.desktop` must not change after the first release.
3. **GitHub** (for tag-triggered builds): repository secrets
   - `TAURI_SIGNING_PRIVATE_KEY` = contents of `~/.tauri/study-kingdom.key`
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` = the Keychain password
   - optional variable `SK_API_URL` to override `apiUrl`
   - optional Apple secrets: `APPLE_CERTIFICATE` (base64 .p12), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_ID`, `APPLE_PASSWORD` (app-specific), `APPLE_TEAM_ID`

   ```bash
   gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/study-kingdom.key
   security find-generic-password -s study-kingdom-updater-key -w | gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD
   ```

## Releasing

Write the user-facing notes in `release-notes.md` (optional), then:

```bash
npm run release:version -- 0.2.0     # updates package.json, tauri.conf.json, Cargo.toml
git commit -am "Release v0.2.0"
git tag v0.2.0
git push --follow-tags               # GitHub Actions builds both architectures and publishes
```

### Without CI (local release from this Mac)

```bash
npm run release:local                # builds aarch64 + x86_64, then asks before publishing with `gh`
```

Or step by step: `bash scripts/release/build-mac.sh` (artifacts in `release-out/v<version>/`), inspect, then `bash scripts/release/publish.sh`. Building the Intel binary on Apple silicon needs only `rustup target add x86_64-apple-darwin` (done by the script).

The scripted build skips the Finder-styled DMG window (it needs an interactive automation permission); set `SK_PRETTY_DMG=1` to keep it when building interactively.

## Verifying an update end to end

1. Install the previous version from its DMG and sign in.
2. Publish the new version.
3. Relaunch the old app (or Settings → Check for updates): the prompt shows the new version and notes.
4. Choose **Update and restart**; the app relaunches on the new version, still signed in (refresh token in the Keychain).
5. A tampered bundle or manifest fails signature verification and the current version keeps running.

## Supported Macs

macOS 12.3 or later, Apple silicon and Intel.

## Current beta packages

The Apple silicon and Intel packages use the production API and GitHub updater destination in `release.config.json`. Each release includes DMGs, signed updater archives and `latest.json`. They are ad-hoc signed; Developer ID signing/notarization and fresh-machine update checks remain open in [beta.md](beta.md). Username/password registration opens the village immediately.
