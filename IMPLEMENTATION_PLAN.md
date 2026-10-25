# Study Kingdom — Implementation Plan

Status: local implementation through Phase 7 complete; Phase 8 release/beta gates remain open — see checklists below. Spec: `specs/active/study-kingdom/study-kingdom_spec.md`.

Working title: Study Kingdom. Final branding is undecided.

## Summary

Build a village strategy game with the core depth of Clash of Clans around 2020, powered by studying. Players earn resources through study sessions, build and upgrade a village, research armies, attack enemy bases, and compete with friends and rival clans.

Ship a desktop web application and a downloadable macOS `.dmg`, sharing accounts, progression, content, and combat rules. Support both computer study and paper/books without requiring a phone application.

The reference game already included Town Hall 13, four heroes, siege machines, and Super Troops by 2020. This release concentrates on the main village, army, combat, and clan systems with a smaller roster. Use original names, artwork, sounds, and balance data.

## Release Scope

| Area | First complete release |
| --- | --- |
| Village | One editable village; 10 headquarters tiers |
| Buildings | Headquarters, treasury, barracks, army camps, research library, clan hall, workshop, builder lodge |
| Defences | 8 types, walls, and 4 trap types |
| Army | 12 troop types, 6 spells, 2 heroes, and 1 siege unit |
| Upgrades | Approximately 3–5 meaningful levels per troop/defence; 10 levels per hero |
| Combat | Troop deployment, automatic movement/targeting, manual spells, and hero abilities |
| Campaign | 20 progressively harder enemy bases |
| Multiplayer | Friends, visits, challenges, ranked raids, replays, and weekly friend leagues |
| Clans | Up to 20 members, reinforcement donations, and 5v5 wars |
| Studying | Computer and paper modes, goals, history, and optional recall exercises |
| Platforms | Desktop web and downloadable Mac application with shared progression |

Use a stylised 2D isometric village. Limit initial art production to three broad visual upgrade stages per building family.

Content counts and balance values are initial targets to validate through playtesting.

### Deferred

- Builder Base or a second village.
- Super Troop variants.
- Global tournaments and automated clan matchmaking.
- Public chat, trading, payments, and paid progression.
- Browser extensions and AI document processing.
- Phone applications and continuous webcam/screen monitoring.

## Approach

Build a small playable version of the entire study-to-battle loop before expanding content. Prove web/Mac compatibility early, keep combat independent of rendering, and have the server control economic and competitive results.

### Core Loop and Economy

**Study → earn resources → build/research → strengthen the army → attack → compete with friends.**

Use two spendable resources:

- **Gold:** buildings, walls, and defences.
- **Essence:** troop research, spells, heroes, and siege development.

Study sessions earn both resources. Buildings determine storage, capacity, and unlocks. Two builder slots create upgrade choices, with upgrades continuing while the player is away.

Studying is the primary source of economic progress. Battles primarily award trophies, league points, and cosmetics; repeated attacks must not become a better resource source than studying.

Initial balance targets:

- The first 25-minute study session funds a visible upgrade.
- Early sessions introduce a new unit, defence, or tactical choice.
- Later upgrades require several sessions.
- Interrupted sessions retain proportional credit for eligible time.
- Competitive study scoring caps at 120 minutes per day. Personal study history continues beyond that cap.

Keep earnings, costs, unlocks, and upgrade durations in versioned data files. Simulate progression at 25, 60, and 120 study minutes per day before populating all ten headquarters tiers.

### Technical Architecture

| Layer | Proposed technology and responsibility |
| --- | --- |
| Interface | React + TypeScript: study tools, menus, and social features |
| Village and combat presentation | Phaser: rendering, camera, animation, and battlefield interaction |
| Mac application | Tauri with native application-focus and sleep/lock integrations |
| Game API | Node.js + TypeScript: sessions, purchases, upgrades, matchmaking, and wars |
| Database and authentication | Supabase Auth and PostgreSQL |
| Background worker | Battle verification, scheduled war transitions, and rewards |
| Assets | Object storage/CDN for versioned game assets |

Proposed repository structure:

```text
apps/client       Shared web interface and Phaser presentation
apps/desktop      Tauri shell and Mac integrations
apps/server       API and background jobs
packages/sim      Combat simulation without rendering
packages/rules    Economy, progression, and validation
packages/content  Buildings, units, spells, and campaign definitions
packages/shared   API contracts and common types
```

The server owns wallets, upgrades, rewards, and battle outcomes. Clients submit actions rather than updated balances.

## Execution Constraints

- Complete the playable three-tier slice before expanding the content roster.
- Share game rules and simulation logic between browser, desktop, and server runtimes.
- Keep simulation logic independent of Phaser and presentation code.
- Version content and simulation rules so saved battles can be replayed correctly.
- Use database transactions and idempotent operations for resource awards, purchases, donations, and war settlement.
- Preserve the same core progression across web and Mac despite different accountability capabilities.
- Do not treat a hidden browser tab or inactivity during paper study as proof of distraction.
- Do not claim to verify learning or reliably detect phone use.
- Deliver battle and social notifications between study sessions.
- Use original assets and game data.
- Keep credentials and signing keys outside source control.

## Ordered Implementation Tasks

### Phase 1 — Foundation and Mac Compatibility

- [x] Create the repository structure and shared packages.
- [x] Configure linting, type checks, tests, and CI. _(ESLint, Prettier, `tsc -b`, Vitest unit/integration, Playwright e2e; `.github/workflows/ci.yml` runs once the repo is on GitHub.)_
- [x] Add authentication, database migrations, and development seed data. _(Supabase Auth via a Worker BFF; `supabase/migrations`, `supabase/seed.sql`.)_
- [x] Create a Phaser scene inside the shared interface.
- [x] Package the scene in Tauri. _(Universal source, per-arch builds for Apple silicon and Intel.)_
- [x] Test rendering, input, and authentication in Chrome, Safari, and the Mac app. _(Playwright Chromium + WebKit end-to-end; desktop client paths in WebKit with a mocked IPC bridge; native Mac commands via `cargo test`; built app boots and reaches the API from `tauri://localhost`. Manual Safari/Mac sign-in is on the release checklist.)_
- [x] Establish content schemas and stable identifiers.

**Completion criteria:** One account opens the same saved village in a browser and the Mac app. Rendering and input work in each supported runtime.

### Phase 2 — Playable Study-to-Battle Slice

Limit initial content to headquarters tiers 1–3.

- [x] Implement a tile grid, placement, movement, collision checks, walls, and saved layouts.
- [x] Implement Gold, Essence, storage limits, and two upgrade queues.
- [x] Add three troop roles: melee attacker, ranged attacker, and tank.
- [x] Add two defences and one spell.
- [x] Add three campaign bases.
- [x] Add a basic study session that awards resources and enables an upgrade.
- [x] Add army selection and one complete attack.
- [x] Playtest the full loop before adding more content. _(Automated playthrough `e2e/slice.spec.ts` passes in Chromium and WebKit: username registration → study → upgrade → train → server-verified win. Human playtesting continues in the beta.)_

**Completion criteria:** A new player can study, upgrade their village, assemble an army, and win a battle without developer intervention.

### Phase 3 — Reliable Study Sessions and Resource Accounting

Implement an explicit session lifecycle:

```text
Created → Running ↔ Paused → Completed / Abandoned
```

- [x] Record server start/end times and periodic heartbeats.
- [x] Enforce one earning session per account across devices. _(Partial unique index; explicit “continue on this device” takeover.)_
- [x] Award resources through an append-only transaction ledger.
- [x] Make completion requests idempotent so retries cannot duplicate rewards.
- [x] Handle sleep, lock, crashes, reconnects, and device-clock changes. _(Server clock only; gaps held for review; stale sessions closed at the last heartbeat; Mac lock detection.)_
- [x] Add goals, subject tags, breaks, and session history.
- [x] Add an optional end-of-session recall exercise. _(Recap, Q&A cards, confidence; cards resurface as a warm-up before later sessions.)_
- [x] Implement Mac application allowlists and a grace period before pausing earnings.
- [x] Implement paper mode without requiring keyboard or mouse activity. _(Keeps the Mac awake via a power assertion / screen wake lock on web.)_
- [x] Implement lighter web accountability while allowing users to switch to study materials. _(Hidden tabs are fine; periodic check-ins; unanswered time goes to review.)_
- [x] Require review of disconnected time rather than automatically granting competitive credit. _(Reviewed time earns resources only; per-session and per-day caps; an abandoned session's trailing silence is never reviewable.)_

Computer mode can identify selected active applications, but identifying a browser does not establish which website is being used. Paper mode uses elapsed time, a declared goal, and the optional recap. Neither mode establishes comprehension or guarantees honest participation.

**Completion criteria:** Closing the app, replaying requests, changing the device clock, or opening a second device cannot duplicate rewards. Legitimate paper study and browser-based study remain usable.

### Phase 4 — Reusable Combat Simulation

- [x] Implement fixed simulation ticks, seeded randomness, and stable targeting rules.
- [x] Implement ground movement, flying movement, walls, and pathfinding.
- [x] Implement target preferences, attack range, projectiles, splash damage, and healing.
- [x] Enforce deployment boundaries, army capacity, and spell limits.
- [x] Add hero abilities, traps, and siege behaviour.
- [x] Implement three-minute battles with destruction percentage and three-star scoring.
- [x] Freeze the defending layout, army, content version, and random seed at attack start.
- [x] Record timestamped deployment, spell, and ability commands.
- [x] Validate commands and rerun battles on the server before awarding results.
- [x] Implement replays using the recorded inputs and pinned versions.
- [x] Test identical results across browser and server runtimes.

Use integer or fixed-point calculations where practical. Keep movement, targeting, and result calculation inside `packages/sim` rather than duplicating them in rendering code.

**Completion criteria:** Replays reproduce the same result, forged armies are rejected, and wall/targeting edge cases behave consistently.

**Validation:** Pinned version 1 golden results, JSON checkpoint resumes, Node/Chromium/WebKit comparisons for simulation versions 1 and 2, and local Deno Edge verification. HQ10 combined-army and maximum-village benchmarks are recorded in `docs/free-tier.md`. Version 2 fixes final hidden defences; version 1 replays retain their original outcomes.

### Phase 5 — Friends and Asynchronous Rivalry

- [x] Add friend codes, requests, removal, and blocking.
- [x] Add village visits and private friendly challenges.
- [x] Add attack/defence history and replay sharing.
- [x] Match ranked raids by headquarters tier, army strength, and trophies.
- [x] Add weekly private friend leagues.
- [x] Add simple shared study rooms with focus/break/finished statuses.
- [x] Limit ranked rewards and repeated attacks against the same account.
- [x] Queue social notifications until study breaks.

Attack snapshots of defending villages. Defenders retain their earned resources and buildings. Players do not need to be online together for attacks or challenges.

**Completion criteria:** Two friends can study separately, challenge each other, watch results, and see consistent league standings.

**Validation:** Two-player browser flow plus Postgres permission, blocking, snapshot, cooldown, scoring and idempotency tests. Friendly challenges preserve the ready army; ranked resource bonuses cap at three wins/day and raids cap at twenty/day. Notifications wait until breaks.

### Phase 6 — Clans, Reinforcements, and Wars

- [x] Add clan creation, invitations, membership, and leader/officer/member roles.
- [x] Enforce a maximum of 20 members per clan.
- [x] Implement reinforcement requests with atomic donation and claim handling.
- [x] Add a shared weekly study objective with capped individual contributions.
- [x] Implement direct clan challenges with a fixed 5v5 roster.
- [x] Implement preparation and battle phases.
- [x] Freeze war layouts and rosters at their phase boundaries.
- [x] Give each participant two attacks; count the best result against each base.
- [x] Determine winners by stars, followed by destruction percentage.
- [x] Implement idempotent settlement and cosmetic clan rewards.
- [x] Test phase transitions and settlement across server restarts.

Study contributions unlock shared rewards; combat results decide the war. Start with direct challenges between known clans and defer automated clan matchmaking.

**Completion criteria:** A complete war survives server restarts and settles exactly once.

**Validation:** PostgreSQL tests cover racing clan joins at the 20-member cap, roles, concurrent donation/claim retries, weekly contribution caps, late joiners, war roster restrictions, preparation deadlines, two attacks, best-base scoring, pending verification and repeated settlement after recreating the app.

### Phase 7 — Content Expansion and Progression Balance

- [x] Expand to 10 headquarters tiers and all scoped buildings and defences.
- [x] Expand to 12 troop types covering melee, ranged, tanking, wall breaking, resource targeting, splash, wall jumping, flying, bombing, heavy air damage, healing, and summoning.
- [x] Add 6 spells covering healing, damage amplification, freezing, direct damage, traversal, and protection.
- [x] Complete 2 heroes with distinct offensive and support strategies.
- [x] Complete 1 siege unit.
- [x] Expand the campaign to 20 bases.
- [x] Add troop, defence, and hero upgrades to the scoped level ranges.
- [x] Build an economy simulator for 25-, 60-, and 120-minute daily study patterns.
- [x] Check that every headquarters tier introduces a tactical decision.
- [x] Playtest multiple army compositions and defensive layouts.

**Completion criteria:** Progression supports different study schedules, each headquarters tier adds a meaningful choice, and multiple army compositions are viable.

**Validation:** Twenty layouts pass content validation; production-rule economy simulation reaches HQ10 at 399/170/92 days for 25/60/120 minutes daily on a HQ/storage-focused path. Ground, air and summoning compositions clear the final six campaign bases. Human pacing/playtesting remains part of beta; see `docs/balance.md`.

### Phase 8 — Polish, Distribution, and Beta

- [x] Complete onboarding, animations, sound, and upgrade visuals.
- [x] Test resource concurrency, account permissions, replay compatibility, and war deadlines.
- [ ] Benchmark representative battles on Apple silicon and an older supported Mac.
- [x] Add error monitoring, database backups, and a tested restore procedure. _(Authenticated AES-GCM archives; isolated local PostgreSQL restore and tamper/overwrite rejection pass. Hosted Supabase recovery also passes: 25 tables, 46 generated test accounts, 15 pinned replays and restored login.)_
- [x] Publish the web build. _(https://study-kingdom.yuvraj-658.workers.dev; production account/session/study/battle smoke checks pass.)_
- [x] Build Apple silicon and Intel Mac packages. _(Both architectures build against the real API with signed updater bundles. Developer ID/notarization remain unconfigured.)_
- [ ] Sign and notarize the Mac application and disk images.
- [ ] Test fresh installation, login, permissions, and signed updates.
- [ ] Run a two-week beta with several small friend groups.
- [ ] Fix session-credit, combat, progression, and installation issues found during beta.

Detailed remaining gates: `docs/beta.md`; recovery and monitoring: `docs/operations.md`. GitHub repository: `YuvrajSolanki5/study-kingdom`; Cloudflare and Supabase are deployed. CI passes on GitHub (fresh-checkout fixes, 25 October 2026). The nightly backup now runs as the read-only `game_backup` role via snapshot export (migration 5, applied to production); a manual run produced a verified archive, and the first scheduled run is part of release verification.

Direct Mac distribution requires Developer ID signing and notarization for the normal installation experience, without App Store publication. Developer membership and signing credentials are release prerequisites.

**Completion criteria:** Both platforms support the complete study-to-clan-war loop, fresh Mac installations work, and beta users can complete sessions and compete without manual account repairs.

### Platform, Hosting and Release (added with the implementation request)

- [x] Serve the web client from Cloudflare Workers Static Assets and run the API as a Worker (`apps/server/wrangler.jsonc`).
- [x] Username/password registration, immediate login, logout, password changes and persistent sessions (httpOnly cookies on web, Keychain on Mac).
- [x] Remove email collection, confirmation and recovery mail per user request (25 October 2026). Owner-assisted resets replace forgotten-password emails; no SMTP/domain is needed.
- [x] Deploy to Cloudflare and Supabase, using Hyperdrive with verified TLS and the hosted Edge verifier.
- [x] Tauri updater: locally generated signing key, HTTPS `latest.json`, per-arch DMGs and signed `.app.tar.gz` bundles, update prompt with safe install/relaunch.
- [x] Version-tag release automation (`.github/workflows/release.yml`) and local release commands (`npm run release:local`).
- [x] Verify current free-tier quotas and benchmark server combat verification against the Workers CPU limit (`docs/free-tier.md`).

## Validation Strategy

### Automated Checks

- Unit-test economy calculations, unlock requirements, session transitions, and combat rules.
- Integration-test transaction atomicity, permissions, idempotency, and cross-device session ownership.
- Compare simulation results across supported browser and server runtimes.
- Test replay compatibility against pinned content and simulation versions.
- Exercise war transitions, duplicate jobs, delayed jobs, and server restarts.
- Add end-to-end coverage for study → reward → upgrade → attack and friend challenge → replay → standings.

### Manual and Release Checks

- Test computer study, paper study, application switching, browser switching, sleep, lock, crashes, and reconnection.
- Verify shared progression between web and Mac.
- Playtest pathfinding, walls, traps, flying units, spells, and hero abilities.
- Check performance on the chosen reference Macs and supported browsers.
- Verify fresh installation and signed updates on both Mac architectures.
- Restore a database backup in a separate environment.

### Beta Questions

- Do completed sessions reliably award the expected resources?
- Does progression remain satisfying across different study schedules?
- Do battles support multiple viable strategies?
- Do friends return to compete and cooperate?
- Does game interaction remain concentrated around study breaks?
- Can the team diagnose and recover failures without manually editing player balances?

## Risks and Follow-ups

| Risk or open decision | Resolution point |
| --- | --- |
| Combat/pathfinding complexity | Prove core behaviour in Phase 2; complete deterministic verification in Phase 4 |
| Differences between browser and Tauri webview | Test the shared scene and authentication in Phase 1; repeat representative checks in Phase 8 |
| Study accountability cannot prove learning or detect all phone use | Apply transparent mode limitations in Phase 3 and capped competition in Phases 5–6 |
| Balance may reward long hours or excessive gameplay | Simulate study schedules in Phase 7 and evaluate behaviour in beta |
| Ten tiers create substantial art/content work | Use shared visual stages and expand content only after the playable slice |
| Supported macOS versions, reference hardware, and performance budgets | Select during Phase 1; measure in Phases 4 and 8 |
| Exact war durations, trophy formulas, donation limits, and economic values | Specify before the relevant phase, keep configurable, and tune in Phase 7 |
| Developer membership, signing credentials, and production hosting | Arrange before Phase 8; never commit secrets |
| Final branding and art direction | Set before production asset creation in Phase 7 |

## Planning Estimate

Allow approximately **6–9 months for one experienced full-time developer with dedicated art support**. A playable alpha may be achievable in approximately **8–12 weeks**. These are rough planning estimates, not delivery commitments; combat, animation, content, and polish are the main uncertainties.

The first implementation target is the **three-tier playable slice**: shared web/Mac account, study rewards, village upgrades, and a working battle.

## Research References

- [Supercell: Town Hall 13 release, December 2019](https://supercell.com/en/games/clashofclans/blog/news/december-update-patch-notes/)
- [Supercell: Spring 2020 update](https://supercell.com/en/games/clashofclans/blog/news/the-spring-update-is-here-2/)
- [Phaser documentation](https://docs.phaser.io/)
- [Tauri architecture](https://tauri.app/concept/architecture/)
- [Tauri distribution](https://tauri.app/distribute/)
- [Apple: Developer ID distribution](https://developer.apple.com/developer-id/)
- [Apple: Notarizing macOS software](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)
- [MDN: Page Visibility API](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API)
- [Apple: Frontmost application API](https://developer.apple.com/documentation/appkit/nsworkspace/frontmostapplication)
