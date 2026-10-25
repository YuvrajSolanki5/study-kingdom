import type { GameContent } from '@sk/content';
import type Phaser from 'phaser';
import { TH, TW } from './iso.ts';

// All art is procedural and original: each texture is drawn once with vector
// primitives and cached by key.

type G = Phaser.GameObjects.Graphics;
type Pt = { x: number; y: number };

export function shade(color: number, f: number): number {
  const r = Math.min(255, Math.round(((color >> 16) & 0xff) * f));
  const g = Math.min(255, Math.round(((color >> 8) & 0xff) * f));
  const b = Math.min(255, Math.round((color & 0xff) * f));
  return (r << 16) | (g << 8) | b;
}

const OUTLINE = 0x2b2118;

/** Visual palette for the three upgrade stages of every building family. */
const STAGES = [
  { wall: 0xa0703c, trim: 0x6b4423, roof: 0xb5482f, metal: 0x6f6f6f },
  { wall: 0x9aa3ad, trim: 0x5f6b78, roof: 0x3d6fb6, metal: 0x8a8f96 },
  { wall: 0xe9e2cf, trim: 0xe0b23c, roof: 0x6c3fb0, metal: 0xe0b23c },
] as const;

class Painter {
  readonly g: G;
  readonly s: number;
  readonly cx: number;
  readonly cy: number;
  constructor(g: G, s: number, w: number, h: number) {
    this.g = g;
    this.s = s;
    this.cx = w / 2;
    this.cy = h - 2 - (s * TH) / 2;
  }

  diamond(k: number, elev: number, dx = 0, dy = 0): { T: Pt; R: Pt; B: Pt; L: Pt } {
    const hw = (k * this.s * TW) / 2;
    const hh = (k * this.s * TH) / 2;
    const x = this.cx + dx;
    const y = this.cy + dy - elev;
    return { T: { x, y: y - hh }, R: { x: x + hw, y }, B: { x, y: y + hh }, L: { x: x - hw, y } };
  }

  poly(points: Pt[], color: number, alpha = 1, outline = true) {
    const g = this.g;
    g.fillStyle(color, alpha);
    g.beginPath();
    g.moveTo(points[0]!.x, points[0]!.y);
    for (let i = 1; i < points.length; i++) g.lineTo(points[i]!.x, points[i]!.y);
    g.closePath();
    g.fillPath();
    if (outline) {
      g.lineStyle(1, OUTLINE, 0.55);
      g.strokePath();
    }
  }

  ground(color: number, k = 1) {
    const d = this.diamond(k, 0);
    this.poly([d.T, d.R, d.B, d.L], color, 1, false);
  }

  prism(k: number, z: number, height: number, color: number, dx = 0, dy = 0) {
    const a = this.diamond(k, z, dx, dy);
    const b = this.diamond(k, z + height, dx, dy);
    this.poly([a.L, a.B, b.B, b.L], shade(color, 0.82));
    this.poly([a.B, a.R, b.R, b.B], shade(color, 0.64));
    this.poly([b.T, b.R, b.B, b.L], shade(color, 1.08));
  }

  pyramid(k: number, z: number, height: number, color: number, dx = 0, dy = 0) {
    const a = this.diamond(k, z, dx, dy);
    const apex = { x: this.cx + dx, y: this.cy + dy - z - height };
    this.poly([a.L, a.B, apex], shade(color, 0.92));
    this.poly([a.B, a.R, apex], shade(color, 0.7));
  }

  cylinder(r: number, z: number, height: number, color: number, dx = 0, dy = 0) {
    const g = this.g;
    const x = this.cx + dx;
    const y = this.cy + dy - z;
    g.fillStyle(shade(color, 0.8), 1);
    g.fillEllipse(x, y, r * 2, r);
    g.fillRect(x - r, y - height, r * 2, height);
    g.fillStyle(shade(color, 0.64), 1);
    g.fillRect(x, y - height, r, height);
    g.fillStyle(shade(color, 1.08), 1);
    g.fillEllipse(x, y - height, r * 2, r);
    g.lineStyle(1, OUTLINE, 0.5);
    g.strokeEllipse(x, y - height, r * 2, r);
    g.lineBetween(x - r, y - height, x - r, y);
    g.lineBetween(x + r, y - height, x + r, y);
  }

  cone(r: number, z: number, height: number, color: number, dx = 0, dy = 0) {
    const x = this.cx + dx;
    const y = this.cy + dy - z;
    this.poly(
      [
        { x: x - r, y },
        { x, y: y + r / 2 },
        { x, y: y - height },
      ],
      shade(color, 0.92),
    );
    this.poly(
      [
        { x, y: y + r / 2 },
        { x: x + r, y },
        { x, y: y - height },
      ],
      shade(color, 0.7),
    );
  }

  disc(rx: number, z: number, color: number, dx = 0, dy = 0, alpha = 1) {
    this.g.fillStyle(color, alpha);
    this.g.fillEllipse(this.cx + dx, this.cy + dy - z, rx * 2, rx);
  }

  flag(z: number, color: number, dx = 0) {
    const g = this.g;
    const x = this.cx + dx;
    const y = this.cy - z;
    g.lineStyle(2, 0x3b2a1a, 1);
    g.lineBetween(x, y, x, y - 26);
    this.poly(
      [
        { x, y: y - 26 },
        { x: x + 16, y: y - 21 },
        { x, y: y - 16 },
      ],
      color,
    );
  }

  window(dx: number, z: number, w = 5, h = 7, color = 0x2a1d12) {
    this.g.fillStyle(color, 1);
    this.g.fillRect(this.cx + dx - w / 2, this.cy - z - h, w, h);
  }
}

interface Spec {
  head: number;
  draw(p: Painter, stage: (typeof STAGES)[number], stageIndex: number): void;
}

const SPECS: Record<string, Spec> = {
  headquarters: {
    head: 150,
    draw(p, c, i) {
      p.ground(0x6e5b43, 0.95);
      p.prism(0.86, 0, 34, c.wall);
      p.prism(0.6, 34, 30 + i * 6, shade(c.wall, 1.05));
      p.pyramid(0.66, 64 + i * 6, 34, c.roof);
      for (const dx of [-30, -12, 12, 30]) p.window(dx, 14);
      p.window(0, 46 + i * 3, 6, 9);
      p.g.fillStyle(c.trim, 1);
      p.g.fillRect(p.cx - 9, p.cy - 2 - 18, 18, 18);
      p.flag(98 + i * 6, i === 2 ? 0xe0b23c : 0xc0392b);
      if (i >= 1) for (const dx of [-44, 44]) p.cylinder(7, 0, 44, c.wall, dx, -2);
      if (i >= 2) for (const dx of [-44, 44]) p.cone(9, 44, 18, c.roof, dx, -2);
    },
  },
  treasury: {
    head: 90,
    draw(p, c, i) {
      p.ground(0x6e5b43, 0.9);
      p.prism(0.78, 0, 22, c.wall);
      p.disc(26, 22, 0xe0b23c);
      p.disc(18 + i * 3, 30, shade(0xe0b23c, 1.15));
      p.g.fillStyle(0x7d4fd1, 1);
      p.g.fillCircle(p.cx + 16, p.cy - 30, 5 + i);
      p.g.fillStyle(0xfff3b0, 1);
      p.g.fillCircle(p.cx - 10, p.cy - 36, 4);
      p.window(0, 4, 10, 12, c.trim);
    },
  },
  barracks: {
    head: 90,
    draw(p, c, i) {
      p.ground(0x6e5b43, 0.9);
      p.prism(0.78, 0, 26, c.wall);
      p.pyramid(0.84, 26, 22 + i * 3, c.roof);
      p.window(0, 3, 10, 14, c.trim);
      const g = p.g;
      g.lineStyle(3, 0xd9d9d9, 1);
      g.lineBetween(p.cx - 12, p.cy - 62, p.cx + 12, p.cy - 40);
      g.lineBetween(p.cx + 12, p.cy - 62, p.cx - 12, p.cy - 40);
    },
  },
  army_camp: {
    head: 60,
    draw(p, c, i) {
      p.ground(0x8a7353, 0.92);
      p.ground(0x9c855f, 0.7);
      const tents: [number, number][] = [
        [-34, -6],
        [30, -8],
        [0, 14],
        ...(i >= 1 ? ([[0, -26]] as [number, number][]) : []),
      ];
      for (const [dx, dy] of tents) {
        p.cone(14, 0, 22, i === 2 ? 0xe9e2cf : 0xc9b48a, dx, dy);
      }
      p.disc(8, 1, 0x5a3b1e);
      p.g.fillStyle(0xff8c1a, 1);
      p.g.fillTriangle(p.cx - 5, p.cy - 2, p.cx + 5, p.cy - 2, p.cx, p.cy - 16);
      p.g.fillStyle(0xffd34d, 1);
      p.g.fillTriangle(p.cx - 2, p.cy - 2, p.cx + 2, p.cy - 2, p.cx, p.cy - 10);
      if (c) p.flag(4, 0x3b82f6, 44);
    },
  },
  research_library: {
    head: 120,
    draw(p, c, i) {
      p.ground(0x6e5b43, 0.9);
      p.prism(0.72, 0, 26, c.wall);
      p.cylinder(16, 26, 26 + i * 6, shade(c.wall, 1.05));
      p.cone(20, 52 + i * 6, 30, 0x2f5fa8);
      p.window(-14, 8);
      p.window(14, 8);
      p.g.fillStyle(0x9fd3ff, 1);
      p.g.fillCircle(p.cx, p.cy - 40 - i * 3, 4);
    },
  },
  builder_lodge: {
    head: 60,
    draw(p, c) {
      p.ground(0x6e5b43, 0.9);
      p.prism(0.7, 0, 18, c.wall);
      p.pyramid(0.8, 18, 16, 0xd9822b);
      p.window(0, 2, 6, 9, c.trim);
      const g = p.g;
      g.lineStyle(3, 0x5a3b1e, 1);
      g.lineBetween(p.cx + 18, p.cy - 8, p.cx + 26, p.cy - 22);
      g.fillStyle(0x777777, 1);
      g.fillRect(p.cx + 22, p.cy - 26, 9, 5);
    },
  },
  clan_hall: {
    head: 110,
    draw(p, c, i) {
      p.ground(0x6e5b43, 0.9);
      p.prism(0.8, 0, 28, c.wall);
      p.prism(0.5, 28, 14, shade(c.wall, 1.05));
      p.pyramid(0.56, 42, 22, c.roof);
      p.flag(64, 0x16a34a, -6);
      p.flag(64, 0xe0b23c, 8);
      p.window(0, 3, 10, 14, c.trim);
      if (i >= 2) p.disc(6, 70, 0xe0b23c);
    },
  },
  workshop: {
    head: 90,
    draw(p, c, i) {
      p.ground(0x6e5b43, 0.9);
      p.prism(0.8, 0, 24, c.wall);
      p.pyramid(0.86, 24, 14, c.roof);
      const g = p.g;
      g.lineStyle(4, c.metal, 1);
      g.strokeCircle(p.cx + 4, p.cy - 50, 9 + i);
      g.fillStyle(c.metal, 1);
      g.fillCircle(p.cx + 4, p.cy - 50, 3);
    },
  },
  bolt_thrower: {
    head: 70,
    draw(p, c, i) {
      p.ground(0x6e5b43, 0.9);
      p.prism(0.74, 0, 14, c.wall);
      p.disc(18, 14, shade(c.trim, 1.1));
      const g = p.g;
      g.fillStyle(i === 2 ? 0x8f6a12 : 0x3a3a3a, 1);
      g.fillRoundedRect(p.cx - 4, p.cy - 34, 30, 10, 4);
      g.fillStyle(0x222222, 1);
      g.fillCircle(p.cx + 26, p.cy - 29, 4);
      g.fillStyle(0x5a3b1e, 1);
      g.fillRect(p.cx - 10, p.cy - 28, 10, 10);
    },
  },
  watchtower: {
    head: 140,
    draw(p, c, i) {
      p.ground(0x6e5b43, 0.9);
      const g = p.g;
      g.lineStyle(4, shade(c.trim, 0.9), 1);
      for (const [dx, dy] of [
        [-22, 0],
        [22, 0],
        [0, 12],
        [0, -12],
      ] as [number, number][])
        g.lineBetween(p.cx + dx, p.cy + dy, p.cx + dx * 0.5, p.cy + dy * 0.5 - 70);
      p.prism(0.5, 70, 14 + i * 2, c.wall);
      p.pyramid(0.58, 84 + i * 2, 24, c.roof);
      g.fillStyle(0x16a34a, 1);
      g.fillCircle(p.cx - 6, p.cy - 90, 4);
      g.fillCircle(p.cx + 8, p.cy - 88, 4);
    },
  },
  wall: {
    head: 40,
    draw(p, c, i) {
      p.prism(0.82, 0, 16 + i * 2, i === 0 ? 0x8c6239 : c.wall);
      if (i === 2) p.prism(0.3, 18 + i * 2, 4, 0xe0b23c);
    },
  },
};

const FALLBACK: Spec = {
  head: 100,
  draw(p, c) {
    p.ground(0x6e5b43, 0.9);
    p.prism(0.75, 0, 30, c.wall);
    p.pyramid(0.8, 30, 20, c.roof);
  },
};

export function stageOf(content: GameContent, defId: string, level: number): number {
  const stages = content.structures[defId]?.visualStages ?? [1, 2, 3];
  return level >= stages[2] ? 2 : level >= stages[1] ? 1 : 0;
}

/** Ensures the texture for a building at a level exists and returns its key and anchor info. */
export function buildingTexture(
  scene: Phaser.Scene,
  content: GameContent,
  defId: string,
  level: number,
): string {
  const size = content.structures[defId]?.size ?? 2;
  if (level <= 0) return constructionTexture(scene, size);
  const stage = stageOf(content, defId, level);
  const key = `b:${defId}:${stage}`;
  if (scene.textures.exists(key)) return key;
  const spec = SPECS[defId] ?? FALLBACK;
  const w = size * TW + 8;
  const h = size * TH + spec.head;
  const g = scene.make.graphics({}, false);
  spec.draw(new Painter(g, size, w, h), STAGES[stage]!, stage);
  g.generateTexture(key, w, h);
  g.destroy();
  return key;
}

export function constructionTexture(scene: Phaser.Scene, size: number): string {
  const key = `b:construction:${size}`;
  if (scene.textures.exists(key)) return key;
  const w = size * TW + 8;
  const h = size * TH + 60;
  const g = scene.make.graphics({}, false);
  const p = new Painter(g, size, w, h);
  p.ground(0x8a7353, 0.9);
  p.prism(0.6, 0, 10, 0xc9b48a);
  g.lineStyle(2, 0x8b5a2b, 1);
  for (const dx of [-0.3, 0.3]) {
    const x = p.cx + dx * size * TW * 0.5;
    g.lineBetween(x, p.cy, x, p.cy - 40);
  }
  g.lineBetween(p.cx - size * 9, p.cy - 30, p.cx + size * 9, p.cy - 38);
  g.fillStyle(0xf2c94c, 1);
  g.fillRect(p.cx - 12, p.cy - 22, 24, 6);
  g.generateTexture(key, w, h);
  g.destroy();
  return key;
}

export function rubbleTexture(scene: Phaser.Scene, size: number): string {
  const key = `b:rubble:${size}`;
  if (scene.textures.exists(key)) return key;
  const w = size * TW + 8;
  const h = size * TH + 20;
  const g = scene.make.graphics({}, false);
  const p = new Painter(g, size, w, h);
  p.ground(0x5b4a3a, 0.85);
  const rocks = size * 4;
  for (let i = 0; i < rocks; i++) {
    const a = (i * 2.399) % (Math.PI * 2);
    const r = ((i * 37) % 100) / 100;
    const x = p.cx + Math.cos(a) * r * size * TW * 0.3;
    const y = p.cy + Math.sin(a) * r * size * TH * 0.3;
    g.fillStyle(i % 2 ? 0x7a6a5a : 0x948372, 1);
    g.fillEllipse(x, y - 3, 10, 6);
  }
  g.generateTexture(key, w, h);
  g.destroy();
  return key;
}

interface UnitLook {
  body: number;
  size: number;
  flying?: boolean;
  weapon?: 'sword' | 'bow' | 'shield' | 'staff' | 'bone';
}

const UNITS: Record<string, UnitLook> = {
  swordsman: { body: 0x3b82f6, size: 1, weapon: 'sword' },
  archer: { body: 0x16a34a, size: 0.95, weapon: 'bow' },
  bulwark: { body: 0x92400e, size: 1.5, weapon: 'shield' },
  skeleton: { body: 0xe5e7eb, size: 0.85, weapon: 'bone' },
};

export function unitTexture(scene: Phaser.Scene, defId: string, team = 0): string {
  const key = `u:${defId}:${team}`;
  if (scene.textures.exists(key)) return key;
  const look = UNITS[defId] ?? { body: 0xa855f7, size: 1.1, weapon: 'staff' as const };
  const s = look.size;
  const w = 48;
  const h = 56;
  const g = scene.make.graphics({}, false);
  const cx = w / 2;
  const base = h - 8;
  g.fillStyle(0x000000, 0.25);
  g.fillEllipse(cx, base, 18 * s, 8 * s);
  const body = team === 1 ? 0xdc2626 : look.body;
  g.fillStyle(shade(body, 0.75), 1);
  g.fillRoundedRect(cx - 6 * s, base - 18 * s, 12 * s, 16 * s, 4 * s);
  g.fillStyle(body, 1);
  g.fillRoundedRect(cx - 6 * s, base - 18 * s, 7 * s, 16 * s, 3 * s);
  g.fillStyle(0xf1c27d, 1);
  g.fillCircle(cx, base - 22 * s, 5 * s);
  g.lineStyle(1, OUTLINE, 0.6);
  g.strokeCircle(cx, base - 22 * s, 5 * s);
  g.lineStyle(2 * s, 0xdddddd, 1);
  switch (look.weapon) {
    case 'sword':
      g.lineBetween(cx + 6 * s, base - 10 * s, cx + 13 * s, base - 22 * s);
      break;
    case 'bow':
      g.lineStyle(2, 0x8b5a2b, 1);
      g.beginPath();
      g.arc(cx + 7 * s, base - 14 * s, 7 * s, -1.2, 1.2);
      g.strokePath();
      break;
    case 'shield':
      g.fillStyle(0x9ca3af, 1);
      g.fillRoundedRect(cx + 3 * s, base - 18 * s, 8 * s, 12 * s, 3);
      break;
    case 'bone':
      g.lineStyle(2, 0xffffff, 1);
      g.lineBetween(cx + 5 * s, base - 8 * s, cx + 10 * s, base - 18 * s);
      break;
    default:
      g.lineStyle(2, 0x6b4423, 1);
      g.lineBetween(cx + 7 * s, base - 4 * s, cx + 7 * s, base - 26 * s);
      g.fillStyle(0xa5f3fc, 1);
      g.fillCircle(cx + 7 * s, base - 27 * s, 3);
  }
  g.generateTexture(key, w, h);
  g.destroy();
  return key;
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
  g.fillStyle(0x3a2a1a, 1);
  g.fillRect(0, 1, 14, 3);
  g.fillStyle(0x777777, 1);
  g.fillTriangle(14, 0, 18, 2.5, 14, 5);
  g.generateTexture('fx:bolt', 18, 5);
  g.clear();
  g.lineStyle(1.5, 0x5a3b1e, 1);
  g.lineBetween(0, 2, 12, 2);
  g.fillStyle(0xdddddd, 1);
  g.fillTriangle(12, 0, 15, 2, 12, 4);
  g.generateTexture('fx:arrow', 16, 4);
  g.clear();
  g.fillStyle(0xfff59d, 1);
  g.fillTriangle(6, 0, 12, 0, 4, 22);
  g.fillTriangle(4, 18, 14, 18, 2, 44);
  g.generateTexture('fx:lightning', 16, 44);
  g.destroy();
}

/** The grass map with the deploy-only border, rendered once into a texture. */
export function groundTexture(
  scene: Phaser.Scene,
  mapSize: number,
  buildMin: number,
  buildMax: number,
): string {
  const key = `ground:${mapSize}`;
  if (scene.textures.exists(key)) return key;
  const w = mapSize * TW;
  const h = mapSize * TH;
  const g = scene.make.graphics({}, false);
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let y = 0; y < mapSize; y++) {
    for (let x = 0; x < mapSize; x++) {
      const inside = x >= buildMin && y >= buildMin && x < buildMax && y < buildMax;
      const checker = (x + y) % 2 === 0;
      const base = inside ? (checker ? 0x6fae4f : 0x68a649) : checker ? 0x5c9440 : 0x568c3b;
      const c = shade(base, 0.96 + rnd() * 0.08);
      const px = w / 2 + ((x - y) * TW) / 2;
      const py = ((x + y) * TH) / 2;
      g.fillStyle(c, 1);
      g.beginPath();
      g.moveTo(px, py);
      g.lineTo(px + TW / 2, py + TH / 2);
      g.lineTo(px, py + TH);
      g.lineTo(px - TW / 2, py + TH / 2);
      g.closePath();
      g.fillPath();
      if (!inside && rnd() < 0.18) {
        g.fillStyle(0x2f6b2f, 1);
        g.fillTriangle(px - 7, py + TH / 2 + 4, px + 7, py + TH / 2 + 4, px, py - 12);
        g.fillStyle(0x3d8a3d, 1);
        g.fillTriangle(px - 5, py + TH / 2 - 4, px + 5, py + TH / 2 - 4, px, py - 18);
      } else if (inside && rnd() < 0.04) {
        g.fillStyle(0x8fcf6f, 1);
        g.fillEllipse(px + (rnd() - 0.5) * 20, py + TH / 2, 5, 2);
      }
    }
  }
  g.generateTexture(key, w, h);
  g.destroy();
  return key;
}
