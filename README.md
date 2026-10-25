# Study Kingdom

A village-strategy game powered by studying. Study sessions earn Gold and Essence; you build and upgrade a village, research an army, attack bases and compete with friends and clans. Runs on the web and as a Mac app with one account and one progression.

- **Plan & checklist:** [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) · **Spec:** [specs/active/study-kingdom](specs/active/study-kingdom/study-kingdom_spec.md)
- **Setup & deploy:** [docs/setup.md](docs/setup.md) · **Mac releases & updates:** [docs/release.md](docs/release.md) · **Free-tier limits & benchmarks:** [docs/free-tier.md](docs/free-tier.md)

## Architecture

| Path | What |
| --- | --- |
| `packages/content` | Versioned game data (buildings, units, spells, campaign) with stable ids |
| `packages/sim` | Deterministic combat simulation: integer maths, seeded RNG, 10 ticks/s, resumable checkpoints |
| `packages/rules` | Economy, upgrades, layouts, army, study accounting — pure functions shared by client and server |
| `packages/shared` | API contracts (zod) |
| `apps/server` | Cloudflare Worker: Hono API under `/api/*`, cron jobs; serves the web client from Static Assets |
| `apps/client` | React + Phaser 4 client (web and Mac) |
| `apps/desktop` | Tauri v2 shell: app allowlist, screen-lock/idle detection, sleep prevention, Keychain, updater |
| `supabase/` | Migrations, local config, username Auth, `verify-battle` Edge Function |
| `scripts/` | Release, benchmark, auth configuration, icon generation |

The server owns wallets, upgrades, rewards and battle results: clients send actions, the API applies the shared rules inside a database transaction and records every balance change in an append-only, idempotent ledger. Battles are re-simulated on the server from the frozen setup and the recorded commands.

## Current state

The deployed game includes friends, private challenges and replays, ranked raids, weekly leagues, study rooms, clans, atomic donations and 5v5 wars, plus the full roster and twenty campaign bases. Simulation versions 1 and 2 remain replayable.

[Operations & recovery](docs/operations.md) · [Balance checks](docs/balance.md) · [Beta/release gates](docs/beta.md). Play at [Study Kingdom](https://study-kingdom.yuvraj-658.workers.dev). Create a username and password; your village opens immediately. Notarization, fresh-machine updates and the two-week beta remain release gates.

## Quick start

```bash
npm install
npm run db:start                         # needs Docker (Colima works)
cp apps/server/.dev.vars.example apps/server/.dev.vars   # add the publishable key from `npx supabase status`
npm run dev & npm run dev:client         # http://localhost:5173 — demo1 / study-kingdom-dev
```

## Commands

| Command | Does |
| --- | --- |
| `npm run lint` / `npm run typecheck` / `npm run format` | Static checks |
| `npm test` | Unit tests (content, rules, simulation) |
| `npm run test:integration` | API tests against Postgres (`scripts/test-db.sh up` first) |
| `npm run test:e2e` | Playwright in Chromium and WebKit against the local stack |
| `npm run bench:sim` | Combat CPU benchmark, including a maximum HQ10 village |
| `npm run econ:sim` / `npm run balance:combat` | Progression schedules and army composition checks |
| `PGTOOLS_CONTAINER=sk-test-pg npm run test:backup` | Encrypted backup and isolated restore drill |
| `npm run deploy` | Build the client and deploy the Worker |
| `npm run deploy:edge` | Bundle the simulation and deploy the verification Edge Function |
| `npm run release:version -- 0.2.0` / `npm run release:local` | Version bump / build and publish a Mac release from this machine |
