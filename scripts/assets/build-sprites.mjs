// Builds game sprites from the Supercell fan kit (used with permission; see
// docs/licensing.md). Reads the raw kit downloaded by fetch-fankit.py, trims and
// scales each chosen image, and writes WebP files and their index into
// assets/sprite-source. stylize-sprites.mjs turns those into the game's own look.
//
//   SK_ASSET_SOURCE=/Volumes/SolankiNAS/Assets/supercell-coc-fankit node scripts/assets/build-sprites.mjs
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const SRC = process.env.SK_ASSET_SOURCE ?? process.argv[2];
if (!SRC) throw new Error('Set SK_ASSET_SOURCE to the fan kit folder');
const ROOT = join(import.meta.dirname, '../..');
const OUT = join(ROOT, 'assets/sprite-source/sprites');
const INDEX = join(ROOT, 'assets/sprite-source/index.json');
const manifest = JSON.parse(readFileSync(join(SRC, 'manifest.json'), 'utf8'));
const TW = 64;
/** Sprites are stored at twice their on-screen size so zoomed-in views stay crisp. */
const RES = 2;

// Our structure → fan kit family, and the fan kit level shown at each of our levels.
// `k` scales the trimmed width relative to the footprint; `dy` nudges the
// anchor (in footprint-height fractions) for art whose shadow hangs below.
const BUILDINGS = {
  headquarters: { family: 'Town_Hall', levels: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
  treasury: { family: 'Gold_Storage', levels: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
  barracks: { family: 'Barracks', levels: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
  army_camp: { family: 'Army_Camp', levels: [1, 2, 3, 4, 5, 5, 7, 7] },
  research_library: { family: 'Laboratory', levels: [1, 2, 3, 4, 5, 6, 7, 8, 9] },
  clan_hall: { family: 'Clan_Castle', levels: [1, 3, 5, 6, 7] },
  workshop: { family: 'Workshop', levels: [1, 4, 5] },
  builder_lodge: { family: 'Builder_Hut', levels: [1] },
  bolt_thrower: { family: 'Cannon', levels: [1, 3, 7, 10, 13] },
  watchtower: { family: 'Archer_Tower', levels: [1, 4, 7, 10, 13] },
  catapult: { family: 'Mortar', levels: [1, 3, 6, 9] },
  skyspear: { family: 'Air_Defense', levels: [1, 3, 6, 9] },
  arcane_spire: { family: 'Wizard_Tower', levels: [1, 3, 6, 9] },
  storm_totem: { family: 'Hidden_Tesla', levels: [1, 5, 9] },
  repeater: { family: 'X-Bow', levels: [1, 2, 4] },
  ember_tower: { family: 'Inferno_Tower', levels: [1, 3, 5] },
  wall: { family: 'Wall', levels: [1, 2, 3, 5, 7, 9, 11, 13], single: true },
  blast_mine: { family: 'Bomb', levels: [1, 5, 9] },
  spring_snare: { family: 'Spring_Trap', levels: [1, 3, 5] },
  sky_mine: { family: 'Air_Bomb', levels: [1, 3, 5] },
  seeker_mine: { family: 'Seeking_Air_Mine', levels: [1, 3, 5] },
};
const SIZES = {
  headquarters: 4,
  army_camp: 4,
  builder_lodge: 2,
  storm_totem: 2,
  ember_tower: 2,
  wall: 1,
  blast_mine: 1,
  spring_snare: 1,
  sky_mine: 1,
  seeker_mine: 1,
};
// Visual width of the art as a fraction of the footprint (art rarely fills its
// base: a cannon sits in the middle of 3×3 tiles), optionally per level.
const TUNE = {
  headquarters: { k: 0.98 },
  treasury: { k: 0.86 },
  barracks: { k: 0.9 },
  army_camp: { k: [0.5, 0.82, 0.82, 0.86, 0.86, 0.86, 0.9, 0.9] },
  research_library: { k: 0.86 },
  clan_hall: { k: 0.88 },
  workshop: { k: 0.9 },
  builder_lodge: { k: 0.9 },
  bolt_thrower: { k: 0.62 },
  watchtower: { k: 0.66 },
  catapult: { k: 0.66 },
  skyspear: { k: 0.78 },
  arcane_spire: { k: 0.66 },
  storm_totem: { k: 0.72 },
  repeater: { k: 0.8 },
  ember_tower: { k: 0.95 },
  wall: { k: 0.8 },
  blast_mine: { k: 0.55 },
  spring_snare: { k: 0.75 },
  sky_mine: { k: 0.6 },
  seeker_mine: { k: 0.6 },
};
// Units: one hand-picked 3D render per unit (not the 2D cartoon variants).
// `h` is the on-screen height in pixels; `left` marks art facing left, so the
// battle scene flips it to match movement.
const UNITS = {
  swordsman: { title: 'Troop_HV_Barbarian_1', h: 51, left: true },
  archer: { title: 'Troop_HV_Archer_3', h: 51 },
  bulwark: { title: 'Troop_HV_Giant_15', h: 71 },
  sapper: { title: 'Troop_HV_Wall_Breaker_2', h: 44 },
  looter: { title: 'Troop_HV_Goblin_2', h: 46, left: true },
  wyvern: { title: 'Troop_HV_Minion_1', h: 48, flying: true },
  mage: { title: 'Troop_HV_Wizard_8', h: 53 },
  skyship: { title: 'Troop_HV_Balloon_1', h: 74, flying: true },
  vaulter: { title: 'Troop_HV_Hog_Rider_08', h: 57 },
  drake: { title: 'Troop_HV_Dragon_1', h: 97, flying: true },
  mender: { title: 'Troop_HV_Healer_1', h: 60, flying: true },
  necromancer: { title: 'Troop_HV_Witch_17', h: 57 },
  warlord: { title: 'Barbarian_King_4', h: 53 },
  sage: { title: 'Grand_Warden_1', h: 53 },
  battering_ram: { title: 'Siege_Machine_HV_Wall_Wrecker_1', h: 60 },
};

// Scenery for the forest edge, kept at native size (the ground is drawn at 1×).
const SCENERY = {
  tree_large: 'Obstacle_HV_Large_Tree',
  tree_medium: 'Obstacle_HV_Medium_Tree',
  pine: 'Obstacle_HV_Small_Tree',
  bush: 'Obstacle_HV_Bush',
  rock_large: 'Obstacle_HV_Stone_large',
  rock_1: 'Obstacle_HV_Stone_1',
  rock_3: 'Obstacle_HV_Stone_3',
  mushroom: 'Obstacle_HV_Mushroom',
  trunk: 'Obstacle_HV_Fallen_Trunk',
};

// Interface icons (square, `px` on-screen). `crop` is [left, top, width, height]
// as fractions of the source, for icons baked into larger buttons.
const UI = {
  gold: { title: 'Icon_HV_Resource_Gold_1', px: 48 },
  essence: { title: 'Icon_HV_Resource_Elixir_1', px: 48 },
  builder: { title: 'Builder_avatar', px: 48 },
  hammer: { title: 'building upgrade hammer', px: 48 },
  magnifier: { title: 'magnifying_glass', px: 48 },
  clan: { title: 'Clan_Badge_1', px: 48 },
  social: { title: 'hud_button_social', px: 48, crop: [0.1, 0.1, 0.8, 0.8] },
  sword: { title: 'hud_button_battle', px: 48, crop: [0.1, 0.27, 0.8, 0.5] },
  league_bronze: { title: 'Icon_HV_League_Bronze_2', px: 40 },
  league_silver: { title: 'Icon_HV_League_Silver_2', px: 40 },
  league_gold: { title: 'Icon_HV_League_Gold_2', px: 40 },
  league_crystal: { title: 'Icon_HV_League_Crystal_2', px: 40 },
  league_master: { title: 'Icon_HV_League_Master_2', px: 40 },
  league_champion: { title: 'Icon_HV_League_Champion', px: 40 },
  league_titan: { title: 'Icon_HV_League_Titan_1', px: 40 },
  league_legend: { title: 'Icon_HV_League_Legend_4', px: 40 },
  // Spells, heroes and siege share our ids so panels can look them up directly.
  thunder: { title: 'icon_hv_spell_lightning_new', px: 64 },
  mending: { title: 'icon_hv_spell_heal', px: 64 },
  fury: { title: 'icon_hv_spell_rage', px: 64 },
  frost: { title: 'icon_hv_spell_freeze_new', px: 64 },
  leap: { title: 'icon_hv_spell_jump', px: 64 },
  aegis: { title: 'icon_hv_spell_invisibility', px: 64 },
  warlord: { title: 'Icon_HV_Hero_Barbarian_King', px: 64 },
  sage: { title: 'Icon_HV_Hero_Grand_Warden', px: 64 },
  battering_ram: { title: 'icon_hv_siege_machine_wall_wrecker', px: 64 },
};

/** Source fixes: [left, top, width, height] fractions to keep from these images. */
const CROP = {
  // A "Level 1" caption plate sits under the campfire.
  Building_HV_Army_Camp_level_01: [0, 0, 1, 0.58],
  // Three views of the hut side by side; keep the first.
  Building_HV_Builder_Hut_Level_1: [0, 0, 0.34, 1],
};

function have(a) {
  return a.ext === 'png' && existsSync(join(SRC, a.path));
}

/**
 * Fan kit levels covered by a title. "level_1_2" and "level_2_3_4" are ranges
 * (consecutive numbers); "level_12_1" is view 1 of level 12. Walls' "_1"/"_2"
 * suffixes are a single block and a cluster.
 */
function levelsOf(title, single) {
  // Some titles join ranges with '&' ("level_1&2", even "level_7.&8").
  const m = title.replace(/[.&]+/g, '_').match(/_level_([\d_]+)$/i);
  if (!m) return null;
  const nums = m[1].split('_').filter(Boolean).map(Number);
  const range = nums.length > 1 && nums.every((n, i) => i === 0 || n === nums[i - 1] + 1);
  return { levels: range && !single ? nums : [nums[0]], view: range ? 0 : (nums[1] ?? 0) };
}

/** Best source image for a family at a fan kit level. */
function pickBuilding(family, level, single) {
  const prefix = new RegExp(`^building_hv_${family.replace(/[-_]/g, '[-_ ]')}_level_`, 'i');
  const cands = manifest.filter((a) => {
    // Huge marketing renders are skipped unless a crop makes them usable.
    if (!prefix.test(a.title) || (a.width >= 2000 && !CROP[a.title]) || !have(a)) return false;
    const l = levelsOf(a.title, single);
    return l && l.levels.includes(level) && (!single || l.view !== 2);
  });
  if (!cands.length) return null;
  // Walls: the small single block. Others: the in-game render nearest 600px wide.
  const score = (a) =>
    single ? a.width : Math.abs(Math.min(a.width, 600) - 600) + (a.width < 150 ? 1000 : 0);
  return cands.sort((x, y) => score(x) - score(y))[0];
}

async function sprite(file, targetW, title, targetH) {
  let input = sharp(file);
  const crop = CROP[title];
  if (crop) {
    const { width, height } = await input.metadata();
    const [l, t, w, h] = crop;
    const box = {
      left: Math.round(l * width),
      top: Math.round(t * height),
      width: Math.round(w * width),
      height: Math.round(h * height),
    };
    input = sharp(await input.extract(box).toBuffer());
  }
  const trimmed = await input.trim({ threshold: 8 }).toBuffer({ resolveWithObject: true });
  const img =
    targetH !== undefined
      ? sharp(trimmed.data).resize({ height: Math.round(targetH * RES), kernel: 'lanczos3' })
      : sharp(trimmed.data).resize({ width: Math.round(targetW * RES), kernel: 'lanczos3' });
  const { data, info } = await img
    .webp({ quality: 88, alphaQuality: 95, effort: 5 })
    .toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

async function main() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(join(OUT, 'b'), { recursive: true });
  mkdirSync(join(OUT, 'u'), { recursive: true });
  mkdirSync(join(OUT, 's'), { recursive: true });
  mkdirSync(join(OUT, 'ui'), { recursive: true });
  const index = { res: RES, buildings: {}, units: {}, scenery: {}, ui: {}, missing: [] };
  for (const [id, cfg] of Object.entries(BUILDINGS)) {
    const size = SIZES[id] ?? 3;
    const t = TUNE[id] ?? {};
    index.buildings[id] = [];
    for (let i = 0; i < cfg.levels.length; i++) {
      const src = pickBuilding(cfg.family, cfg.levels[i], cfg.single);
      if (!src) {
        index.missing.push(`${id} L${i + 1} (${cfg.family} ${cfg.levels[i]})`);
        index.buildings[id].push(null);
        continue;
      }
      const name = `b/${id}-${i + 1}.webp`;
      const k = Array.isArray(t.k) ? t.k[i] : (t.k ?? 1);
      const s = await sprite(join(SRC, src.path), size * TW * k, src.title);
      writeFileSync(join(OUT, name), s.data);
      index.buildings[id].push({ file: name, w: s.w, h: s.h, dy: t.dy ?? 0, src: src.title });
    }
  }
  for (const [id, cfg] of Object.entries(UNITS)) {
    const src = manifest.find((a) => a.title.toLowerCase() === cfg.title.toLowerCase() && have(a));
    if (!src) {
      index.missing.push(`unit ${id} (${cfg.title})`);
      continue;
    }
    const name = `u/${id}.webp`;
    const s = await sprite(join(SRC, src.path), 0, src.title, cfg.h);
    writeFileSync(join(OUT, name), s.data);
    index.units[id] = { file: name, w: s.w, h: s.h, left: !!cfg.left, flying: !!cfg.flying, src: src.title };
  }
  for (const [id, title] of Object.entries(SCENERY)) {
    const src = manifest.find((a) => a.title.toLowerCase() === title.toLowerCase() && have(a));
    if (!src) {
      index.missing.push(`scenery ${id} (${title})`);
      continue;
    }
    const name = `s/${id}.webp`;
    const { data, info } = await sharp(join(SRC, src.path))
      .trim({ threshold: 8 })
      .webp({ quality: 90, alphaQuality: 95 })
      .toBuffer({ resolveWithObject: true });
    writeFileSync(join(OUT, name), data);
    index.scenery[id] = { file: name, w: info.width, h: info.height };
  }
  for (const [id, cfg] of Object.entries(UI)) {
    const src = manifest.find((a) => a.title.toLowerCase() === cfg.title.toLowerCase() && have(a));
    if (!src) {
      index.missing.push(`ui ${id} (${cfg.title})`);
      continue;
    }
    let input = sharp(join(SRC, src.path));
    if (cfg.crop) {
      const { width, height } = await input.metadata();
      const [l, t, w, h] = cfg.crop;
      input = sharp(
        await input
          .extract({
            left: Math.round(l * width),
            top: Math.round(t * height),
            width: Math.round(w * width),
            height: Math.round(h * height),
          })
          .toBuffer(),
      );
    }
    const name = `ui/${id}.webp`;
    const size = cfg.px * RES;
    const { data } = await sharp(await input.trim({ threshold: 8 }).toBuffer())
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .webp({ quality: 90, alphaQuality: 95 })
      .toBuffer({ resolveWithObject: true });
    writeFileSync(join(OUT, name), data);
    index.ui[id] = name;
  }
  // Troop portraits: head and shoulders cropped from each unit's render.
  for (const [id, cfg] of Object.entries(UNITS)) {
    if (UI[id]) continue;
    const src = manifest.find((a) => a.title.toLowerCase() === cfg.title.toLowerCase() && have(a));
    if (!src) continue;
    const trimmed = await sharp(join(SRC, src.path))
      .trim({ threshold: 8 })
      .toBuffer({ resolveWithObject: true });
    const { width, height } = trimmed.info;
    const side = Math.min(width, height, Math.round(Math.max(width, height) * (cfg.flying ? 0.8 : 0.62)));
    const left = Math.round((width - side) / 2);
    const name = `ui/${id}.webp`;
    const { data } = await sharp(trimmed.data)
      .extract({ left, top: 0, width: side, height: side })
      .resize(64 * RES, 64 * RES)
      .webp({ quality: 90, alphaQuality: 95 })
      .toBuffer({ resolveWithObject: true });
    writeFileSync(join(OUT, name), data);
    index.ui[id] = name;
  }
  writeFileSync(INDEX, JSON.stringify(index, null, 1) + '\n');
  console.log(
    `sprites: ${Object.values(index.buildings).flat().filter(Boolean).length} buildings, ${Object.keys(index.units).length} units; missing ${index.missing.length}`,
  );
  for (const m of index.missing) console.log('  missing', m);
}

await main();
