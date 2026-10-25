# study-kingdom - Intent and Specifications

<!-- Canonical execution checklist: /IMPLEMENTATION_PLAN.md (kept at repo root at the user's request). -->

## Summary

Study Kingdom is a village-strategy game in the spirit of 2020-era Clash of Clans in which studying is the economy. Players earn Gold and Essence from study sessions, build and upgrade a village across 10 headquarters tiers, research an army, attack campaign and player bases, and compete with friends and clans. It ships as a desktop web app (Cloudflare Workers Static Assets) and a downloadable macOS app (Tauri v2) sharing one account and one progression.

## Problem

Study timers are dull and game-based motivators either reward grinding gameplay or are trivially gamed. The game must make study the primary path to progress, keep battles and social play concentrated around study breaks, and keep economic and competitive results trustworthy without claiming to verify learning.

## Scope

- Everything in the Release Scope table of `IMPLEMENTATION_PLAN.md` (10 HQ tiers, 8 building families, 8 defences + walls + 4 traps, 12 troops, 6 spells, 2 heroes, 1 siege unit, 20 campaign bases, friends/visits/challenges/ranked raids/replays/weekly friend leagues, study rooms, clans of up to 20, donations, 5v5 wars, computer and paper study modes, goals, history, recall exercises).
- Username/password registration with immediate sign-in, login/logout, password changes, owner-assisted password resets, secure persistent sessions and shared web/Mac progression.
- Server-authoritative wallets, purchases, upgrades, study rewards and battle results.
- Mac auto-update through the Tauri updater with locally generated signing keys, an HTTPS manifest and public GitHub Releases with DMGs and signed updater bundles for Apple silicon and Intel; version-tag release automation plus local release commands; in-app update prompt with safe install/relaunch.
- Migrations, `.env.example`, deployment configuration, tests, and concise setup/release documentation.

## Out of Scope

- The plan's Deferred list (second village, Super Troops, global tournaments, automated clan matchmaking, public chat, trading, payments, extensions, AI document processing, phone apps, webcam/screen monitoring).
- Paid infrastructure. Any requirement that cannot be met inside free tiers is documented as a blocker before a paid service is introduced.
- Mac App Store distribution.

## Constraints

- Zero recurring infrastructure cost: Cloudflare Workers Free, Supabase Free, GitHub public repo (Releases + Actions). Workers Free allows 10 ms CPU per invocation (occasional overruns tolerated), 100k requests/day, 50 subrequests/request.
- Supabase Free: 500 MB database, 50k MAU, no automatic backups, projects pause after 1 week of inactivity.
- Combat simulation, rules and content are shared TypeScript packages used unchanged by browser, Tauri webview and Worker.
- Clients submit actions, never balances. Awards, purchases, donations and settlements are transactional and idempotent.
- Credentials and signing keys never enter source control. Tauri updater signatures (minisign keys) are distinct from Apple Developer ID code signing and notarization.
- The game never claims to verify learning or detect phone use; hidden tabs and paper-study inactivity are not treated as distraction.

## Success Criteria

- One account opens the same village on web (Chrome, Safari) and the Mac app; username registration, login, logout and password changes work end-to-end without email.
- A new player can study, earn resources, upgrade, assemble an army and win a campaign battle without developer intervention.
- Replaying requests, a second device, closing the app, or device clock changes cannot duplicate rewards.
- Server re-simulation reproduces client battle results; forged armies and invalid commands are rejected; replays reproduce results.
- Two friends can challenge each other, watch replays and see consistent league standings; a clan war settles exactly once across restarts.
- Tagging a version produces a GitHub Release with per-arch DMGs, `.app.tar.gz` updater bundles, `.sig` files and `latest.json`; an installed app detects, downloads, verifies and relaunches into the update. The same release can be produced locally without CI.
- Server combat verification is benchmarked against the Workers CPU limit with results and any blockers documented.

## Decisions

- Runtime split: one Cloudflare Worker serves the web client from Static Assets and the Hono API under `/api/*`; scheduled (cron) handlers run war transitions, league rollover, stale-session cleanup, pending verification sweeps and a Supabase keep-alive.
- Database access: Postgres.js from the Worker, via Hyperdrive (free plan) when configured, otherwise the Supabase pooler. All game tables have RLS enabled with no client policies; the API owns mutations and an explicitly approved read-only backup role exports account/game data. Production uses Hyperdrive with query caching disabled and full Supabase CA/hostname verification.
- Auth: backend-for-frontend over Supabase Auth (GoTrue REST). Web uses `__Host-` httpOnly Secure SameSite=Lax cookies plus Origin checks; the Mac app receives tokens and keeps the refresh token in the macOS Keychain. Access tokens are verified with Supabase JWKS (or HS256 secret for legacy projects).
- Accounts (user decision, 25 October 2026): trusted beta players use unique usernames and passwords, with no email collection, confirmation or recovery mail. The BFF maps normalized usernames to reserved non-deliverable Supabase identifiers; these stay internal. Forgotten passwords are reset by the owner; signed-in players can change their password with the current password.
- Player state is a single locked aggregate row (`players.state` JSONB plus wallet columns) mutated by shared `packages/rules` functions inside a transaction; every balance change writes an append-only ledger entry with a unique idempotency key.
- Disconnected study time is held for user review; reviewed time grants resources and personal history but never competitive credit.
- Defenders keep their resources; battles award trophies, league points, cosmetics and small capped bonuses.
- Simulation uses 10 ticks/s, integer milli-tile coordinates, seeded integer RNG, and serialisable state so verification can be split across invocations if a single run exceeds the CPU budget.
- Mac release: ad-hoc signing by default; Developer ID signing and notarization activate automatically when Apple credentials are present in the environment.

## Open Questions

- Apple Developer Program membership ($99/year) is a recurring cost; without it, the app is ad-hoc signed and users must approve it in System Settings on first launch.
- Hyperdrive connects through the verified IPv4 Supabase session pooler; hosted API and battle verification pass.
