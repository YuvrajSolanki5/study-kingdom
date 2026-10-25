# Beta and release gates

Local feature implementation includes the study-to-clan-war loop, twenty campaign bases, onboarding, procedural upgrade art, battle animation/sound, encrypted backups and recovery tooling. The following gates require real accounts, hardware or elapsed time and are deliberately left open.

## Deployment prerequisites

- [x] Create `YuvrajSolanki5/study-kingdom` and configure release destinations.
- [x] Deploy Cloudflare, Supabase migrations without seeds, and the HMAC-protected Edge verifier; production account/study/battle checks pass.
- [x] Replace email accounts with immediate username/password signup at the user’s request. Production registration, login and password changes pass; no SMTP/domain is needed.
- [x] Exercise hosted recovery with generated local test fixtures: 25 matching tables, 46 accounts, 15 replay hashes, restored login and zero ledger mismatches. Approved read-only backup credentials and the encryption key are configured in GitHub.
- [ ] Verify the first scheduled backup artifact and keep a separate offline copy of the local ignored `study-kingdom-backup.key`.
- [ ] Configure Apple Developer ID/notarization credentials if normal Gatekeeper installation is required. The downloadable beta DMGs are ad-hoc signed.

## Mac distribution checks

- [ ] On a fresh Apple silicon Mac and Intel Mac running macOS 12.3+, install from the DMG, sign in, restart and verify the Keychain session.
- [ ] Test computer allowlists, grace periods, lock/sleep, reconnect, paper mode and shared browser/Mac progression.
- [ ] Publish two real versions; test update discovery, signature verification, installation/relaunch and preserved login. Confirm a tampered update fails.
- [ ] Benchmark a large battle on an older supported Intel Mac and record hardware, OS and browser versions. The existing local measurements cover this Apple silicon machine.

## Two-week group beta

Recruit several small friend groups with at least two clans of five players. Before starting, record the build version, contact channel and a daily backup location.

- [ ] Days 1–2: register with a username, use onboarding, finish a study session, upgrade, train, attack and change a password and exercise an owner-assisted reset.
- [ ] Days 3–5: paper/computer study, second-device takeover, disconnected-time review, allowlists, sleep/lock and honest-browser-material use.
- [ ] Days 6–8: friend invitations/blocking, visits, friendly challenges, ranked limits, replay sharing, leagues and rooms.
- [ ] Days 9–11: clan roles, simultaneous donations/claims, weekly objective, a direct 5v5 war, deadline transitions and settlement.
- [ ] Days 12–14: multiple army compositions, progression pacing, resource reconciliation, install/update issues and a recovery drill.

Record each issue with player ID, UTC time, platform/build, expected/actual behaviour and the relevant session/battle/war ID. Avoid collecting passwords, signing keys or raw study material. Triage missing/duplicate rewards, account access and failed recovery first. Repeat affected automated checks after fixes.

Exit only when session credit and ledger reconciliation are reliable, friend/clan outcomes agree across devices, installation and signed updates work, the hosted recovery drill passes, and high-priority beta issues have been fixed.
