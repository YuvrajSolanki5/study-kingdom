# Free-tier operation

Study Kingdom is designed to run with **zero recurring infrastructure cost**. This page records the quotas it depends on (checked 25 October 2026), how the design fits inside them, benchmark results, and the items that are not free.

## Quotas relied on

| Service | Free allowance used | Source |
| --- | --- | --- |
| Cloudflare Workers | 100,000 requests/day; **10 ms CPU per invocation** (occasional overruns tolerated, persistent overruns terminated); 128 MB memory; 50 subrequests/request; 5 Cron Triggers per account | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) |
| Workers Static Assets | Asset requests free and unlimited; 20,000 files, 25 MiB per file | [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) |
| Hyperdrive (production database pool) | 100,000 database queries/day; 10 configs | [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [Hyperdrive limits](https://developers.cloudflare.com/hyperdrive/platform/limits/) |
| Workers Logs | 200,000 events/day, 3-day retention | [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) |
| Supabase Free | 500 MB database, 50,000 MAU, 5 GB egress, 2 active projects; **paused after 1 week of inactivity; no automatic backups**; 1-day logs | [Supabase pricing](https://supabase.com/pricing) |
| Supabase Edge Functions | 500,000 invocations/month; **2 s CPU**, 150 s wall clock, 256 MB per request | [Edge Function limits](https://supabase.com/docs/guides/functions/limits) |
| GitHub | Public repos: standard hosted runners (incl. macOS) free; Releases: 1,000 assets/release, < 2 GiB/file, no bandwidth limit | [Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions), [Releases](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases) |

## How the design fits

- **Web hosting**: the client is static assets (free, unlimited). Only `/api/*` invokes the Worker (`run_worker_first`).
- **CPU per request**: ordinary API calls do small amounts of work (JWT verification uses native WebCrypto; the rules package touches one player row). Battle re-simulation is the exception — see the benchmark.
- **Battle verification**: the Worker forwards each submitted battle to the `verify-battle` Supabase Edge Function (2 s CPU budget) with an HMAC signature. If the function is unavailable or runs a different simulation version, the Worker falls back to **chunked verification**: it simulates a bounded number of deterministic work units per invocation, saves a checkpoint, and continues on the next request or cron run. Chunked and uninterrupted runs are proven identical by tests.
- **Scheduled work**: two Cron Triggers (every 2 minutes, daily) — under the limit of 5. Each run processes a bounded batch.
- **Keep-alive**: the daily cron queries the database, so the Supabase project is not paused for inactivity while the game is in use.
- **Accounts**: usernames and passwords, immediate sign-in and owner-assisted resets. No email sending or paid domain is needed.

### Request budget (estimate)

| Activity per active player per day | Requests |
| --- | --- |
| 2 hours of study (heartbeat every 30 s) | ~250 |
| Village, army and history views/actions | ~50 |
| 5 battles (start, progress uploads, submit, polls) | ~80 |
| **Total** | **~380** |

100,000 requests/day ÷ 380 ≈ **260 daily active players** at two hours of study each. Through Hyperdrive, each request issues 2–6 SQL statements, so its 100,000 queries/day would cap use near **50–80 daily players**. Production uses Hyperdrive because Workers cannot verify Supabase’s private CA directly. Hyperdrive verifies the CA and hostname; query caching is disabled. Plan the trusted beta around this smaller SQL budget.

## Combat verification benchmark

`npm run bench:sim` runs representative battles in Node (V8, the engine used by Workers and Supabase Edge Functions) and reports CPU time:

| Scenario | Ticks | Units | Cold run (fresh isolate) | Warm median | Work units |
| --- | --- | --- | --- | --- | --- |
| HQ1 campaign, 20 swordsmen | 280 | 20 | 31.7 ms | 2.4 ms | 18,155 |
| HQ2 campaign, mixed 50 housing | 220 | 42 | 46.4 ms | 4.6 ms | 32,767 |
| HQ3 walled base, 60 housing + Thunder | 230 | 44 | 52.5 ms | 3.6 ms | 27,439 |
| HQ10 combined army, heroes, siege and reinforcements | 250 | 161 including summons | 108.6 ms | 16.3 ms | 76,918 |
| HQ10 maximum-count village and combined army | 375 | 173 including summons | 151.3 ms | 40.2 ms | 204,545 |

Measured on Apple silicon, Node 24, on 25 October 2026. Each cold measurement now runs in its own fresh child process; warm timings use twenty runs. This is a local V8 CPU proxy, not a measurement of deployed Worker or Edge hardware. The maximum-village case packs every allowed HQ10 structure, wall and trap without overlaps.

**Finding:** even three-tier battles exceed the 10 ms Workers Free CPU limit on a cold isolate, and larger armies at higher tiers grow roughly with units × ticks. Verifying inside the Worker would breach the limit persistently, so it is not used as the primary path.

**Resolution within free tiers:** the Supabase Edge Function verifier remains the primary path (2 s CPU). The local Deno edge runtime reproduces Node results for both supported simulation versions, including the large combined-army replay (`apps/server/test/edge`). The Worker fallback budgets 2,500 deterministic work units per checkpoint; uninterrupted and resumed results match. Work budgets approximate CPU cost and are not a hard millisecond guarantee, especially when rebuilding a large runtime.

**Not a blocker:** no paid service is required. Workers Paid ($5/month, 30 s CPU) would remove the need for the Edge Function, but is not needed.

## Not free (documented blockers)

| Item | Cost | Without it |
| --- | --- | --- |
| Apple Developer Program (Developer ID signing + notarization) | US$99/year | The app is ad-hoc signed. On first launch macOS blocks it; users open **System Settings → Privacy & Security → Open Anyway** once. Updates installed by the app's updater are not quarantined, so they install without further prompts. |
| Database backups | Supabase Free has none | `scripts/db/backup.sh` streams authenticated encrypted `pg_dump` backups. The isolated restore drill passes; see [operations.md](operations.md). The nightly GitHub workflow has its approved read-only database login and encryption key in repository secrets. |

## Watch list

- Supabase pauses free projects after a week without activity — the daily cron prevents this while the Worker is deployed.
- Supabase Free is 500 MB. Battle commands and request receipts are the largest tables; receipts are pruned after 3 days. Battle deletion is currently manual; preserve war references and shared replays when planning retention.
- Workers Logs keep 3 days; client errors are stored in `game.client_errors` for 30 days.
