# Licensing and third-party art

## Supercell fan kit

On 25 October 2026 the project owner told us Supercell had granted permission to use and modify assets from the public [Clash of Clans fan kit](https://fankit.supercell.com/d/vkEdmkUCngKw/game-assets) for this project, on two conditions:

- Study Kingdom stays **non-profit**: no charges, purchases or paid features.
- The game states that it is **not endorsed by Supercell**.

Keep the written permission with the owner's records. If either condition changes, stop using the assets until permission is confirmed again. Supercell's general [Fan Content Policy](https://supercell.com/en/fan-content-policy/) still applies where the permission is silent.

The notice "This material is unofficial and is not endorsed by Supercell." appears on the sign-in screen and in Settings. Keep it visible in every build that ships Supercell-derived art.

### Where the files live

The raw kit (~26 GB) stays out of Git on the owner's NAS:

```bash
python3 -I scripts/assets/fetch-fankit.py /Volumes/SolankiNAS/Assets/supercell-coc-fankit
```

The script is resumable and writes `manifest.json` (id, title, categories, size, source URL) beside the files. The Logo (337) and Audio (652) libraries download the same way with `fetch-fankit.py DEST 337 Logo` / `652 Audio`; the Clash font is under `Font/`.

Only processed sprites derived from the kit are committed. Rebuild them after changing a mapping or when more of the kit has downloaded:

```bash
SK_ASSET_SOURCE=/Volumes/SolankiNAS/Assets/supercell-coc-fankit npm run assets:sprites
```

`scripts/assets/build-sprites.mjs` maps each of our structures and levels to a fan kit building and level, picks one 3D render per unit, crops portraits and interface icons, and writes WebP files to `apps/client/public/sprites/` with their index in `apps/client/src/game/sprite-index.json`. Structure, unit and spell names stay our own. Anything without a sprite falls back to the original procedural art in `apps/client/src/game/art/`.

## Original work

Everything else (code, the procedural fallback art, sounds, names and balance data) is original to Study Kingdom. The Clash display font comes from the fan kit and is bundled under the same permission.
