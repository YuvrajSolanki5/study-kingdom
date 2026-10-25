# battle-modes - Intent and Specifications

## Summary

Let players resolve battles quickly and fight their friends directly.

## Decisions (26 October 2026, from the owner)

- **Quick simulate:** auto-battle, plus speed controls and skip-to-end in live battles. No practice preview.
- **Friend fights:** an Attack button on each friend with a choice of a friendly battle (no stakes) or a ranked raid (trophies and the daily win bonus, with the usual limits).

## Scope

- `autoPlan(setup)` in `@sk/sim` builds a valid command list. It finds the side nearest the village, then deploys siege and tanks, then heroes, wall breakers, the main force and healers along a funnel. Spells go on the nearest defences or just ahead of the troops, and hero abilities follow. It does not change the simulation (`SIM_VERSION` is unchanged). The server verifies auto-battles like any other battle.
- Battle tray: **Auto-battle** before the first deployment (records the plan, then skips to the result). After the first deployment: **1×/2×/4×** and **Skip to end**, which simulates the rest at once with no further commands. Effects and sounds are skipped while fast-forwarding, and the outcome is identical.
- Friendly battles accept a friend's user id as the target as well as a challenge id. These direct attacks need an accepted friendship, are limited to 10 per hour, use no army and award nothing. The defender is told "… practised on your village".
- A ranked raid on a chosen player follows the normal matching rules. When the target is not eligible, the server returns 409 `not_raidable` with the reason: Keep or trophy gap, shield, or the 24-hour cooldown.

## Also fixed

- The village scene's resize listener outlived the scene. A resize after switching to a battle threw inside Phaser's step and froze the game loop.
- The slice e2e test now waits for the HUD gold to update after studying.

## Status

Done. Lint, format and typecheck pass, along with unit (82), integration (46) and the full e2e suite in Chromium and WebKit, including the new `e2e/battle-modes.spec.ts`. The slice test failed once in WebKit on the HUD-gold race above and passed on rerun; it was then fixed.
