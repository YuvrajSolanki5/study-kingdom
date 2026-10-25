# ui-art-refresh - Intent and Specifications

## Summary

Make Study Kingdom look like a polished village-strategy game rather than a flat web app. The goal is chunky, tactile UI and hand-crafted-looking isometric art in the spirit of 2020-era Clash of Clans, while every asset stays original (no Supercell names, art, fonts or sounds). Fix the layout bugs that make the first-run experience look broken.

## Problem

- The interface is flat: thin parchment cards, generic system font, emoji icons, low-contrast buttons.
- Buildings are flat-shaded boxes. Most defences and 12 of 16 unit types fall back to a generic box or purple blob, so the art reads as placeholder or "AI generated".
- On first launch the welcome card's buttons sit underneath the Build/Edit layout buttons (web and Mac, every window size).
- A new village opens on empty grass: building sprites are never drawn until the first state change.

## Scope

- **Fixes:** village sprites render on first load; the onboarding card and village tools share one bottom-left dock that never overlaps, down to the Mac minimum window (960×640).
- **UI system:** bundled display/body fonts (OFL, self-hosted for CSP), outlined game-style numerals, 3D bevelled buttons, framed panels with banner headers and a round close button, resource bars with overlapping icons, chunkier HUD and bottom nav, original inline-SVG icon set replacing emoji in primary chrome.
- **Art:** rewrite procedural textures with Canvas 2D (gradients, outlines, textures, soft shadows). The result should be stone foundations, plank/masonry walls, tiled roofs and three visual stages per family (wood → stone → gilded). It covers all 21 structures (including all 8 defences and 4 traps), walls, construction/rubble, every troop, hero and siege unit, and richer ground (soft grass, forest border, rocks and flowers).
- Keep the texture geometry contract (`size*TW+8` wide, ground diamond anchored at the bottom) so scenes and hit-testing are unchanged.

## Out of Scope

- Bitmap or externally sourced art, animation rigs, new gameplay, sound changes.
- Retina-resolution canvas rendering.

## Constraints

- Art and fonts are original or from the Supercell fan kit under the owner's permission (see Decisions); fonts are bundled (CSP `font-src 'self'`).
- Light and dark colour schemes keep working; reduced motion is respected.
- Existing e2e selectors (roles, labels, `.hud .res-gold`, `.campaign-base`, `.battle-hud`, `.tray-card`) keep working.
- Texture generation stays fast enough for the battle scene (cached per key).

## Decisions (25 October 2026)

- The owner obtained Supercell's permission to use and modify fan kit assets non-commercially, with an "unofficial, not endorsed by Supercell" notice (docs/licensing.md). This replaces the original-art-only constraint for art and the display font; names stay original and were made more distinctive (Scholar's Keep, Boltcaster, Squire, Gatebreaker…).
- The raw kit lives on the owner's NAS; only processed sprites are committed.
- The procedural Canvas 2D art is kept as a fallback while sprites load and for anything unmapped.

## Status

Done: village first-draw fix, non-overlapping onboarding dock, Clash font and game-style UI, per-level building sprites (110), unit sprites (15), portraits and icons, fan kit scenery, renamed content. Lint, typecheck, unit, integration and the full e2e suite pass; screenshots checked at 1440/1280/960 px in Chromium and WebKit.

## Iteration 2: restyle and fit (26 October 2026)

Owner feedback: the kit art looked pasted in and did not fit; the build area felt cramped, with buildings too big for it. The NAS is no longer reachable, so the work starts from the committed sprites.

- Committed sprites moved to `assets/sprite-source/` (source, not served). The new `stylize-sprites.mjs` (`npm run assets:stylize`) produces the shipped sprites. It paints over the renders, applies a cel-shaded warm grade, recolours with our own schemes (slate-blue Keep roofs, green barracks, teal arcane glow, new troop hair, robes and skins, new spell vial colours) and adds the procedural art's ink outline.
- Buildings are scaled to 82–92% of their old size. Each building over one tile gets a worn-ground footprint pad (village and battle), so footprints read on the grass.
- Walls and traps use the procedural art: it joins into runs, and the kit's bombs and balloons looked like props. Shop thumbnails without a sprite render the procedural art.
- The village opens framing the whole build area (it used to open on the middle half). Zooming out stops at the map's width, and the canvas background matches the forest floor.
- Map size is unchanged (44 tiles, 40 buildable). At HQ10 the full roster covers only about 600 of 1,600 buildable tiles, so the cramped feel came from oversized art and a close camera, not a lack of tiles.

Verified: lint, format, typecheck, unit (79), integration (45) and the full e2e suite (Chromium and WebKit) pass. Screenshots were checked at 1440×900 in both engines (village, zoomed in and out, shop, battle).

## Success Criteria

- Screenshots at 1440×900, 1280×820 and 960×640 in Chromium and WebKit show the starter village on load, no overlapping controls, and every building and unit with distinct art.
- Lint, typecheck, unit, integration and the full e2e suite pass.
