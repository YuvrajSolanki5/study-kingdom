import type { GameContent } from '@sk/content';
import Phaser from 'phaser';
import { drawBuilding, drawUnder, FALLBACK, SPECS } from './art/buildings.ts';
import { css, type Ctx, footprint, INK, Iso, makeTexture, rng, softShadow, tone } from './art/canvas.ts';
import { drawUnitShadow, FALLBACK_UNIT, UNITS } from './art/units.ts';
import { TH, TW } from './iso.ts';
import sprites from './sprite-index.json';

// Buildings and units use sprites restyled from the Supercell fan kit when
// available (scripts/assets/stylize-sprites.mjs, docs/licensing.md); walls,
// traps and everything else are procedural Canvas 2D art drawn once and cached
// by key. Procedural building textures are `size*TW + 8` wide with the ground
// diamond's bottom corner 2px above the bottom edge. Always place sprites with
// fitSprite().

interface SpriteEntry {
  file: string;
  w: number;
  h: number;
  dy: number;
}
interface UnitEntry {
  file: string;
  h: number;
  left: boolean;
  flying: boolean;
  /** Transparent margin (source pixels) added on every side for the outline. */
  pad: number;
}
interface SpriteMeta {
  scale: number;
  originY: number;
  /** Unit art drawn facing left; the battle scene flips sprites to match movement. */
  faceLeft?: boolean;
}
const SPRITES = sprites as {
  res: number;
  buildings: Record<string, (SpriteEntry | null)[]>;
  units: Record<string, UnitEntry>;
  scenery: Record<string, { file: string; w: number; h: number }>;
};
const SPRITE_URL = `${import.meta.env.BASE_URL}sprites/`;
/** Emitted on a scene when on-demand sprites finish loading, so it can redraw. */
export const SPRITES_READY = 'sk-sprites-ready';

function spriteOf(defId: string, level: number) {
  const e = SPRITES.buildings[defId]?.[level - 1];
  if (!e) return null;
  return {
    key: `sc:b:${defId}:${level}`,
    url: SPRITE_URL + e.file,
    meta: { scale: 1 / SPRITES.res, originY: 1 - e.dy },
  };
}

function unitSpriteOf(defId: string) {
  const e = SPRITES.units[defId];
  if (!e) return null;
  // Feet sit at the bottom of the art; flyers hover a little above their anchor.
  const feet = e.pad + (e.flying ? 0.9 : 0.97) * (e.h - 2 * e.pad);
  const meta = { scale: 1 / SPRITES.res, originY: feet / e.h, faceLeft: e.left };
  return { key: `sc:u:${defId}`, url: SPRITE_URL + e.file, meta };
}

const pending = new WeakMap<Phaser.Scene, Set<string>>();
const metaOf = new Map<string, SpriteMeta>();

function queueSprite(
  scene: Phaser.Scene,
  { key, url, meta }: { key: string; url: string; meta: SpriteMeta },
) {
  let set = pending.get(scene);
  if (!set) {
    set = new Set();
    pending.set(scene, set);
    // The loader drops its listeners when the scene shuts down.
    scene.events.once('shutdown', () => pending.delete(scene));
    scene.load.on('filecomplete', (k: string) => {
      const meta = metaOf.get(k);
      if (meta) scene.textures.get(k).customData = meta;
    });
    scene.load.on('complete', () => {
      set!.clear();
      scene.events.emit(SPRITES_READY);
    });
  }
  if (set.has(key)) return;
  set.add(key);
  metaOf.set(key, meta);
  scene.load.image(key, url);
  // During preload() Phaser starts the loader itself and waits for it before
  // create(); starting it early would make the scene skip that wait.
  if (!scene.load.isLoading() && scene.sys.settings.status !== Phaser.Scenes.LOADING) scene.load.start();
}

/** Queues sprites for these buildings; call from preload() so create() has them. */
export function preloadBuildings(scene: Phaser.Scene, list: { defId: string; level: number }[]) {
  for (const b of list) {
    const s = b.level > 0 ? spriteOf(b.defId, b.level) : null;
    if (s && !scene.textures.exists(s.key)) queueSprite(scene, s);
  }
}

/** Queues every unit sprite; they are small and any unit can appear in a battle. */
export function preloadUnits(scene: Phaser.Scene) {
  for (const id of Object.keys(SPRITES.units)) {
    const s = unitSpriteOf(id)!;
    if (!scene.textures.exists(s.key)) queueSprite(scene, s);
  }
}

/** Queues the trees, bushes and rocks drawn into the ground texture. */
export function preloadScenery(scene: Phaser.Scene) {
  for (const [id, e] of Object.entries(SPRITES.scenery)) {
    const key = `sc:s:${id}`;
    if (!scene.textures.exists(key))
      queueSprite(scene, { key, url: SPRITE_URL + e.file, meta: { scale: 1, originY: 1 } });
  }
}

/** True when the image shows fan kit art (not procedural art). */
export function isFanArt(img: Phaser.GameObjects.Image) {
  return img.texture.key.startsWith('sc:');
}

export function facesLeft(img: Phaser.GameObjects.Image) {
  return !!(img.texture.customData as SpriteMeta).faceLeft;
}

/**
 * Scales and anchors any building or unit image by its texture's metadata.
 * Procedural textures fall back to `originY` (default: the building anchor).
 */
export function fitSprite(img: Phaser.GameObjects.Image, scale = 1, originY?: number) {
  const meta = img.texture.customData as Partial<SpriteMeta>;
  img.setScale((meta.scale ?? 1) * scale);
  img.setOrigin(0.5, meta.originY ?? originY ?? (img.height - 2) / img.height);
  return img;
}

export function stageOf(content: GameContent, defId: string, level: number): number {
  const stages = content.structures[defId]?.visualStages ?? [1, 2, 3];
  return level >= stages[2] ? 2 : level >= stages[1] ? 1 : 0;
}

/**
 * Ensures the texture for a building at a level exists and returns its key.
 * `variant` is a wall's connection mask: bit 1 joins toward +x, bit 2 toward +y.
 */
export function buildingTexture(
  scene: Phaser.Scene,
  content: GameContent,
  defId: string,
  level: number,
  variant = 0,
): string {
  const size = content.structures[defId]?.size ?? 2;
  if (level <= 0) return constructionTexture(scene, size);
  // Fan kit art when its sprite is loaded; otherwise load it and draw procedural
  // art until SPRITES_READY.
  const sprite = spriteOf(defId, level);
  if (sprite) {
    if (scene.textures.exists(sprite.key)) return sprite.key;
    queueSprite(scene, sprite);
  }
  const stage = stageOf(content, defId, level);
  const key = `b:${defId}:${stage}${variant ? `:${variant}` : ''}`;
  if (scene.textures.exists(key)) return key;
  const spec = SPECS[defId] ?? FALLBACK;
  const w = size * TW + 8,
    h = size * TH + spec.head;
  return makeTexture(
    scene,
    key,
    w,
    h,
    (ctx) => drawBuilding(ctx, spec, size, w, h, stage, variant),
    (ctx) => drawUnder(ctx, spec, size, w, h),
    defId === 'wall' ? 1.1 : 1.6,
  );
}

/**
 * Worn ground under a building's footprint, drawn beneath it so the tiles it
 * occupies read on the grass. Same geometry as procedural building textures.
 */
export function padTexture(scene: Phaser.Scene, size: number): string {
  const key = `b:pad:${size}`;
  if (scene.textures.exists(key)) return key;
  const w = size * TW + 8,
    h = size * TH + 8;
  return makeTexture(
    scene,
    key,
    w,
    h,
    () => {},
    (ctx) => footprint(ctx, new Iso(ctx, w / 2, h - 2 - (size * TH) / 2), size * 0.47, 0x6f8f3a),
    0,
  );
}

export function constructionTexture(scene: Phaser.Scene, size: number): string {
  const key = `b:construction:${size}`;
  if (scene.textures.exists(key)) return key;
  const w = size * TW + 8,
    h = size * TH + 64;
  return makeTexture(
    scene,
    key,
    w,
    h,
    (ctx) => {
      const iso = new Iso(ctx, w / 2, h - 2 - (size * TH) / 2);
      const H = size / 2;
      // Fresh foundation slab, scaffold poles, a plank walkway and supplies.
      iso.box(0, 0, 0.72 * H, 0.72 * H, 0, 6, 0xb9a77f);
      const poles: [number, number][] = [
        [-0.6, -0.6],
        [0.6, -0.6],
        [-0.6, 0.6],
        [0.6, 0.6],
      ];
      for (const [u, v] of poles) pole(ctx, iso.p(u * H, v * H, 6), 34 + size * 4);
      for (const z of [22, 36 + size * 2]) {
        iso.box(0, 0.6 * H, 0.66 * H, 0.08, z, 3, 0xc08a50);
        iso.box(0.6 * H, 0, 0.08, 0.66 * H, z, 3, 0xc08a50);
      }
      const b = iso.p(-0.25 * H, 0.15 * H, 6);
      for (let i = 0; i < 3; i++)
        for (let j = 0; j < 3 - i; j++) {
          ctx.fillStyle = css(tone(0xb8573a, 0.9 + ((i + j) % 2) * 0.15));
          ctx.fillRect(b.x - 10 + j * 7 + i * 3.5, b.y - 4 - i * 4, 6.5, 4);
          ctx.strokeStyle = INK;
          ctx.lineWidth = 0.8;
          ctx.strokeRect(b.x - 10 + j * 7 + i * 3.5, b.y - 4 - i * 4, 6.5, 4);
        }
      // Striped warning plank.
      const s = iso.p(0.2 * H, 0.75 * H, 10);
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(-0.46);
      ctx.fillStyle = '#f2c94c';
      ctx.fillRect(-14, -3, 28, 6);
      ctx.fillStyle = '#2a1a0e';
      for (let x = -12; x < 14; x += 7) ctx.fillRect(x, -3, 3, 6);
      ctx.strokeRect(-14, -3, 28, 6);
      ctx.restore();
    },
    (ctx) => {
      const c = { x: w / 2, y: h - 2 - (size * TH) / 2 };
      softShadow(ctx, c.x + 4, c.y + 2, size * TW * 0.38, size * TH * 0.45, 0.28);
    },
  );
}

function pole(ctx: Ctx, b: { x: number; y: number }, h: number) {
  ctx.fillStyle = '#9a6a3c';
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1;
  ctx.fillRect(b.x - 1.6, b.y - h, 3.2, h);
  ctx.strokeRect(b.x - 1.6, b.y - h, 3.2, h);
}

export function rubbleTexture(scene: Phaser.Scene, size: number): string {
  const key = `b:rubble:${size}`;
  if (scene.textures.exists(key)) return key;
  const w = size * TW + 8,
    h = size * TH + 24;
  return makeTexture(
    scene,
    key,
    w,
    h,
    (ctx) => {
      const iso = new Iso(ctx, w / 2, h - 2 - (size * TH) / 2);
      const r = rng(size * 31 + 5);
      // Scorched ground first (no outline effect: it is flat), then debris.
      for (let i = 0; i < size * 7; i++) {
        const a = r() * Math.PI * 2,
          d = Math.sqrt(r()) * 0.36 * size;
        const p = iso.p(Math.cos(a) * d, Math.sin(a) * d);
        if (r() < 0.35) {
          ctx.save();
          ctx.translate(p.x, p.y - 2);
          ctx.rotate(r() * 3);
          ctx.fillStyle = '#7a4b25';
          ctx.fillRect(-6, -1.6, 12, 3.2);
          ctx.strokeStyle = INK;
          ctx.lineWidth = 0.9;
          ctx.strokeRect(-6, -1.6, 12, 3.2);
          ctx.restore();
        } else {
          const rr = 2.5 + r() * 3.5;
          ctx.beginPath();
          ctx.moveTo(p.x - rr, p.y);
          ctx.lineTo(p.x - rr * 0.4, p.y - rr);
          ctx.lineTo(p.x + rr * 0.7, p.y - rr * 0.8);
          ctx.lineTo(p.x + rr, p.y);
          ctx.closePath();
          ctx.fillStyle = css(tone(0x9a958c, 0.85 + r() * 0.3));
          ctx.fill();
          ctx.strokeStyle = INK;
          ctx.lineWidth = 0.9;
          ctx.stroke();
        }
      }
    },
    (ctx) => {
      const c = { x: w / 2, y: h - 2 - (size * TH) / 2 };
      softShadow(ctx, c.x, c.y, size * TW * 0.34, size * TH * 0.4, 0.55);
    },
    0.9,
  );
}

export function unitTexture(scene: Phaser.Scene, defId: string, team = 0): string {
  const sprite = unitSpriteOf(defId);
  if (sprite) {
    if (scene.textures.exists(sprite.key)) return sprite.key;
    queueSprite(scene, sprite);
  }
  const key = `u:${defId}:${team}`;
  if (scene.textures.exists(key)) return key;
  const art = UNITS[defId] ?? FALLBACK_UNIT;
  // Scenes anchor units at 86% of the texture height.
  const base = Math.round(art.h * 0.86);
  return makeTexture(
    scene,
    key,
    art.w,
    art.h,
    (ctx) => art.draw(ctx, art.w / 2, base, team),
    art.flying ? undefined : (ctx) => drawUnitShadow(ctx, art.w / 2, base, art.w),
    1.3,
  );
}

export function effectTextures(scene: Phaser.Scene) {
  if (scene.textures.exists('fx:dot')) return;
  const g = scene.make.graphics({}, false);
  g.fillStyle(0xffffff, 1);
  g.fillCircle(8, 8, 8);
  g.generateTexture('fx:dot', 16, 16);
  g.clear();
  g.lineStyle(4, 0xffffff, 1);
  g.strokeCircle(32, 32, 28);
  g.generateTexture('fx:ring', 64, 64);
  g.clear();
  g.fillStyle(0x2a1a0e, 1);
  g.fillRect(0, 0, 15, 5);
  g.fillStyle(0x7a4b25, 1);
  g.fillRect(1, 1, 13, 3);
  g.fillStyle(0xd6dbe0, 1);
  g.fillTriangle(14, -0.5, 19, 2.5, 14, 5.5);
  g.generateTexture('fx:bolt', 20, 6);
  g.clear();
  g.lineStyle(1.5, 0x5a3b1e, 1);
  g.lineBetween(0, 2, 12, 2);
  g.fillStyle(0xe4e8ec, 1);
  g.fillTriangle(12, 0, 15, 2, 12, 4);
  g.fillStyle(0xd23b2c, 1);
  g.fillTriangle(0, 0, 3, 2, 0, 4);
  g.generateTexture('fx:arrow', 16, 4);
  g.clear();
  g.fillStyle(0xfff59d, 1);
  g.fillTriangle(6, 0, 12, 0, 4, 22);
  g.fillTriangle(4, 18, 14, 18, 2, 44);
  g.generateTexture('fx:lightning', 16, 44);
  g.destroy();
}

/** The grass clearing, forest edge and deploy border, rendered once. */
export function groundTexture(
  scene: Phaser.Scene,
  mapSize: number,
  buildMin: number,
  buildMax: number,
): string {
  const scenery = (id: string) => {
    const k = `sc:s:${id}`;
    return scene.textures.exists(k)
      ? (scene.textures.get(k).getSourceImage() as CanvasImageSource & { width: number; height: number })
      : null;
  };
  const fan = !!scenery('tree_large');
  const key = `ground:${mapSize}${fan ? ':sc' : ''}`;
  if (scene.textures.exists(key)) return key;
  const w = mapSize * TW,
    h = mapSize * TH;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.lineJoin = 'round';
  const r = rng(7);
  const tile = (x: number, y: number) => ({ x: w / 2 + ((x - y) * TW) / 2, y: ((x + y) * TH) / 2 });
  const diamond = (x0: number, y0: number, x1: number, y1: number) => {
    const a = tile(x0, y0),
      b = tile(x1, y0),
      c = tile(x1, y1),
      d = tile(x0, y1);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(c.x, c.y);
    ctx.lineTo(d.x, d.y);
    ctx.closePath();
  };

  // Forest floor beyond the map.
  ctx.fillStyle = '#3f7a2a';
  ctx.fillRect(0, 0, w, h);
  // Meadow: the deploy border is a shade darker than the village clearing.
  diamond(0, 0, mapSize, mapSize);
  ctx.fillStyle = '#6aac3c';
  ctx.fill();
  diamond(buildMin, buildMin, buildMax, buildMax);
  const mid = tile(mapSize / 2, mapSize / 2);
  const g = ctx.createRadialGradient(mid.x, mid.y, 40, mid.x, mid.y, w * 0.42);
  g.addColorStop(0, '#8fca4c');
  g.addColorStop(1, '#7db943');
  ctx.fillStyle = g;
  ctx.fill();
  // Soft light and shade patches.
  ctx.save();
  diamond(0, 0, mapSize, mapSize);
  ctx.clip();
  for (let i = 0; i < mapSize * 3; i++) {
    const p = tile(r() * mapSize, r() * mapSize);
    const rad = 30 + r() * 70;
    const light = r() < 0.5;
    const pg = ctx.createRadialGradient(p.x, p.y, 2, p.x, p.y, rad);
    pg.addColorStop(0, light ? 'rgba(190,230,120,0.16)' : 'rgba(30,70,20,0.14)');
    pg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = pg;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, rad, rad / 2, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // Faint placement grid inside the clearing.
  for (let y = buildMin; y < buildMax; y++)
    for (let x = buildMin; x < buildMax; x++)
      if ((x + y) % 2 === 0) {
        diamond(x, y, x + 1, y + 1);
        ctx.fillStyle = 'rgba(255,255,200,0.045)';
        ctx.fill();
      }
  // Grass tufts and flowers.
  for (let i = 0; i < mapSize * mapSize * 5; i++) {
    const tx = r() * mapSize,
      ty = r() * mapSize;
    const p = tile(tx, ty);
    const inside = tx >= buildMin && ty >= buildMin && tx < buildMax && ty < buildMax;
    const c = r();
    ctx.strokeStyle = c < 0.5 ? (inside ? '#8fcd5e' : '#78b44c') : inside ? '#5c9a3c' : '#4c8534';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(p.x - 2, p.y);
    ctx.lineTo(p.x - 3, p.y - 3.5);
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x, p.y - 4.5);
    ctx.moveTo(p.x + 2, p.y);
    ctx.lineTo(p.x + 3, p.y - 3);
    ctx.stroke();
    if (r() < 0.012) {
      ctx.fillStyle = r() < 0.5 ? '#fff6d8' : '#ffd34d';
      ctx.beginPath();
      ctx.arc(p.x + 4, p.y - 2, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Edge of the clearing: a soft band marking where building stops.
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(40,80,25,0.18)';
  diamond(buildMin, buildMin, buildMax, buildMax);
  ctx.stroke();
  ctx.restore();

  // Trees and rocks: in the deploy border sparsely, beyond the map densely.
  const props: { x: number; y: number; kind: number; s: number }[] = [];
  for (let y = -4; y < mapSize + 4; y++)
    for (let x = -4; x < mapSize + 4; x++) {
      const onMap = x >= 0 && y >= 0 && x < mapSize && y < mapSize;
      const inside = x >= buildMin - 1 && y >= buildMin - 1 && x <= buildMax && y <= buildMax;
      if (inside) continue;
      const chance = onMap ? 0.07 : 0.55;
      if (r() > chance) continue;
      const p = tile(x + 0.5 + (r() - 0.5) * 0.6, y + 0.5 + (r() - 0.5) * 0.6);
      if (p.x < -40 || p.x > w + 40 || p.y < -20 || p.y > h + 60) continue;
      props.push({ x: p.x, y: p.y, kind: onMap && r() < 0.35 ? 2 : r() < 0.4 ? 1 : 0, s: 0.8 + r() * 0.5 });
    }
  props.sort((a, b) => a.y - b.y);
  // Fan kit obstacles when loaded; procedural trees and rocks otherwise.
  const trees = ['tree_large', 'tree_medium', 'pine', 'tree_medium', 'bush'].map(scenery).filter((x) => !!x);
  const rocks = ['rock_large', 'rock_1', 'rock_3', 'bush', 'mushroom', 'trunk']
    .map(scenery)
    .filter((x) => !!x);
  for (const p of props) {
    if (fan) {
      const pool = p.kind === 2 ? rocks : trees;
      const img = pool[Math.floor(r() * pool.length)]!;
      const sc = 0.75 + p.s * 0.25;
      softShadow(ctx, p.x + 8 * sc, p.y + 2, img.width * 0.42 * sc, img.width * 0.16 * sc, 0.3);
      ctx.drawImage(
        img,
        p.x - (img.width * sc) / 2,
        p.y - img.height * sc * 0.92,
        img.width * sc,
        img.height * sc,
      );
    } else if (p.kind === 2) groundRock(ctx, p.x, p.y, 5 * p.s);
    else if (p.kind === 1) pine(ctx, p.x, p.y, p.s);
    else roundTree(ctx, p.x, p.y, p.s, r);
  }
  scene.textures.addCanvas(key, canvas);
  return key;
}

function roundTree(ctx: Ctx, x: number, y: number, s: number, r: () => number) {
  softShadow(ctx, x + 6 * s, y + 2, 16 * s, 7 * s, 0.35);
  ctx.fillStyle = '#6b4423';
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.2;
  ctx.fillRect(x - 2.5 * s, y - 12 * s, 5 * s, 12 * s);
  ctx.strokeRect(x - 2.5 * s, y - 12 * s, 5 * s, 12 * s);
  const blobs: [number, number, number][] = [
    [-7, -18, 9],
    [7, -19, 9],
    [0, -27, 11],
    [-2, -17, 9],
  ];
  const base = r() < 0.5 ? 0x3f8a36 : 0x4a9a3a;
  // Outline pass, then fills, then highlights, so blobs merge into one crown.
  ctx.fillStyle = INK;
  for (const [dx, dy, rr] of blobs) {
    ctx.beginPath();
    ctx.arc(x + dx * s, y + dy * s, rr * s + 1.4, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const [dx, dy, rr] of blobs) {
    const gg = ctx.createRadialGradient(
      x + (dx - 3) * s,
      y + (dy - 4) * s,
      1,
      x + dx * s,
      y + dy * s,
      rr * s,
    );
    gg.addColorStop(0, css(tone(base, 1.3)));
    gg.addColorStop(1, css(tone(base, 0.8)));
    ctx.fillStyle = gg;
    ctx.beginPath();
    ctx.arc(x + dx * s, y + dy * s, rr * s, 0, Math.PI * 2);
    ctx.fill();
  }
}

function pine(ctx: Ctx, x: number, y: number, s: number) {
  softShadow(ctx, x + 6 * s, y + 2, 13 * s, 6 * s, 0.35);
  ctx.fillStyle = '#5a3b1e';
  ctx.fillRect(x - 2 * s, y - 8 * s, 4 * s, 8 * s);
  for (let i = 0; i < 3; i++) {
    const ty = y - 6 * s - i * 9 * s,
      wd = (13 - i * 3) * s;
    ctx.beginPath();
    ctx.moveTo(x - wd, ty);
    ctx.lineTo(x, ty - 15 * s);
    ctx.lineTo(x + wd, ty);
    ctx.quadraticCurveTo(x, ty + 4 * s, x - wd, ty);
    ctx.closePath();
    const gg = ctx.createLinearGradient(x - wd, 0, x + wd, 0);
    gg.addColorStop(0, '#3e8a3e');
    gg.addColorStop(0.45, '#2f7a34');
    gg.addColorStop(1, '#1f5a28');
    ctx.fillStyle = gg;
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = INK;
    ctx.stroke();
  }
}

function groundRock(ctx: Ctx, x: number, y: number, rr: number) {
  softShadow(ctx, x + 2, y + 1, rr * 1.4, rr * 0.6, 0.3);
  ctx.beginPath();
  ctx.moveTo(x - rr, y);
  ctx.quadraticCurveTo(x - rr, y - rr, x, y - rr * 1.1);
  ctx.quadraticCurveTo(x + rr, y - rr, x + rr, y);
  ctx.quadraticCurveTo(x, y + rr * 0.4, x - rr, y);
  ctx.fillStyle = '#9a958c';
  ctx.fill();
  ctx.lineWidth = 1.1;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath();
  ctx.ellipse(x - rr * 0.3, y - rr * 0.6, rr * 0.35, rr * 0.18, -0.3, 0, Math.PI * 2);
  ctx.fill();
}
