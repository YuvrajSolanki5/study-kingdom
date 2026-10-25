# Progression and combat checks

## Economy

`npm run econ:sim` uses production study rewards, storage caps, placement, costs, upgrade timers and the two builder queues. The policy prioritises storage and headquarters; it awards no battle income or recall bonus. Study occurs once daily and purchases happen afterwards. These figures estimate a **HQ-focused path**, not the time to max an entire village or army.

| Daily study | HQ2 | HQ3 | HQ5 | HQ7 | HQ10 |
| --- | --- | --- | --- | --- | --- |
| 25 minutes | day 3 | 10 | 48 | 134 | 399 |
| 60 minutes | day 2 | 6 | 21 | 58 | 170 |
| 120 minutes | day 2 | 5 | 14 | 34 | 92 |

All ten tiers are reachable without exceeding storage. The first 25-minute session funds a visible treasury upgrade. Each tier lists its tactical unlocks in `packages/content/src/v1/progression.ts`. The simulator is a regression check for resource softlocks and schedule ordering; it does not establish that the pacing is enjoyable.

## Combat

`npm run balance:combat` plays the final six campaign bases with ground, air and summoning compositions, using the same fixed commands on each base. Armies fit the 220 housing cap, with two heroes, one siege unit, spells and clan reinforcements. Max-level armies cleared all six bases with all three compositions after the hidden-defence fix. This establishes that the campaign supports several army types; lower-level armies, reactive spell use and player-created layouts still need human playtesting.

The twenty bases progressively introduce walls, splash, traps, air defence, spells, reinforcements, siege, hidden defences and ramping damage. Campaign star rewards are one-time prizes. Ranked resource bonuses are limited to the first three wins per UTC day (five minutes of study income per win); raids cannot be repeated against the same target for 24 hours, and defenders retain resources.

## Reproducibility

Run `npm test`, `npm run test:integration`, `npm run test:e2e`, `npm run econ:sim`, `npm run balance:combat` and `npm run bench:sim`. Golden version 1 replays pin full results and final hashes. Checkpoints round-trip through JSON. Browser tests compare the complete result object with Node in Chromium and WebKit for both simulation versions.

Human beta feedback should decide later cost/duration changes. Do not change existing versioned combat data after publication without a new content version.
