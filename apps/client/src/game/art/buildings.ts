import { TH, TW } from '../iso.ts';
import {
  bricks,
  css,
  door,
  type Ctx,
  footprint,
  INK,
  Iso,
  planks,
  rng,
  softShadow,
  timber,
  tone,
  windowArch,
} from './canvas.ts';

// Original building designs. Every family has three visual stages:
// timber and fieldstone → dressed stone and slate → marble and gold.

export interface Palette {
  stone: number;
  wall: number;
  wood: number;
  trim: number;
  roof: number;
  metal: number;
  accent: number;
  rich: boolean;
}

export const PALETTES: Palette[] = [
  {
    stone: 0x9d907c,
    wall: 0xc48b4f,
    wood: 0x8a5a2e,
    trim: 0x6b4423,
    roof: 0xcb5530,
    metal: 0x6f7378,
    accent: 0xc63b2c,
    rich: false,
  },
  {
    stone: 0x8e939b,
    wall: 0xddd5c3,
    wood: 0x7a4f2a,
    trim: 0x56616e,
    roof: 0x3f72bb,
    metal: 0xa1a8b1,
    accent: 0x2f6fd0,
    rich: false,
  },
  {
    stone: 0x6c7180,
    wall: 0xf3ecdb,
    wood: 0x6b3f22,
    trim: 0xdca72e,
    roof: 0x7442ba,
    metal: 0xe8b83e,
    accent: 0xe8b83e,
    rich: true,
  },
];

export interface DrawArgs {
  iso: Iso;
  ctx: Ctx;
  /** Half the footprint, in tiles. */
  H: number;
  pal: Palette;
  stage: number;
  /** Walls: bit 1 joins toward +u, bit 2 toward +v. */
  variant: number;
}

export interface BuildingSpec {
  /** Extra pixels above the footprint for roofs, flags and towers. */
  head: number;
  draw(a: DrawArgs): void;
  /** Ground footprint fraction (0 disables the worn patch). */
  patch?: number;
}

// ---------- Shared building parts ----------

function foundation(a: DrawArgs, k: number, h: number) {
  const { iso, ctx, H, pal } = a;
  iso.box(0, 0, k * H, k * H, 0, h, pal.stone, {
    left: (f) => bricks(ctx, f, pal.stone, { bw: 13, bh: 7, seed: 11 }),
    right: (f) => bricks(ctx, f, pal.stone, { bw: 13, bh: 7, seed: 12 }),
    top: () => {
      // Flagstone floor.
      const r = rng(9);
      const c = iso.p(0, 0, h);
      for (let i = 0; i < 18; i++) {
        ctx.fillStyle = css(tone(pal.stone, 1.05 + r() * 0.18), 0.6);
        ctx.beginPath();
        ctx.ellipse(c.x + (r() - 0.5) * k * H * TW, c.y + (r() - 0.5) * k * H * TH, 6, 3, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    },
  });
}

/** Wall material for the current stage. */
function walls(a: DrawArgs, seed: number) {
  const { ctx, pal, stage } = a;
  return (f: { w: number; h: number; light: number }) => {
    if (stage === 0) {
      planks(ctx, f, pal.wall, { seed });
      timber(ctx, f, pal.trim);
    } else {
      bricks(ctx, f, pal.wall, { bw: 12, bh: 6, seed });
      if (pal.rich) {
        ctx.fillStyle = css(pal.trim);
        ctx.fillRect(0, -f.h, f.w, 3);
        ctx.fillRect(0, -f.h * 0.5 - 1, f.w, 2);
      }
    }
  };
}

function hall(
  a: DrawArgs,
  o: {
    u?: number;
    v?: number;
    ka: number;
    kb: number;
    z: number;
    h: number;
    doorSide?: 'left' | 'right' | null;
    windows?: number;
  },
) {
  const { iso, ctx, H, stage } = a;
  const u = o.u ?? 0,
    v = o.v ?? 0;
  const wall = walls(a, 21 + o.z);
  iso.box(u, v, o.ka * H, o.kb * H, o.z, o.h, a.pal.wall, {
    left: (f) => {
      wall(f);
      const n = o.windows ?? 2;
      for (let i = 0; i < n; i++) {
        const x = (f.w / (n + 1)) * (i + 1);
        if (o.doorSide === 'left' && Math.abs(x - f.w / 2) < 8) continue;
        windowArch(ctx, x, -f.h * 0.38, 6, Math.min(12, f.h * 0.42), stage > 0, a.pal.trim);
      }
      if (o.doorSide === 'left') door(ctx, f.w / 2, 12, Math.min(18, f.h * 0.75));
    },
    right: (f) => {
      wall(f);
      const n = Math.max(1, (o.windows ?? 2) - (o.doorSide === 'right' ? 1 : 0));
      for (let i = 0; i < n; i++)
        windowArch(
          ctx,
          (f.w / (n + 1)) * (i + 1),
          -f.h * 0.38,
          6,
          Math.min(12, f.h * 0.42),
          stage > 0,
          a.pal.trim,
        );
      if (o.doorSide === 'right') door(ctx, f.w / 2, 12, Math.min(18, f.h * 0.75));
    },
    top: false,
  });
}

function crossedSwords(ctx: Ctx, x: number, y: number, size: number, blade = '#e4e8ec') {
  for (const dir of [-1, 1]) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(dir * 0.7);
    ctx.fillStyle = blade;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-1.5, -size);
    ctx.lineTo(0, -size - 3);
    ctx.lineTo(1.5, -size);
    ctx.lineTo(1.5, size * 0.4);
    ctx.lineTo(-1.5, size * 0.4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#c99a2e';
    ctx.fillRect(-4, size * 0.4, 8, 2.2);
    ctx.strokeRect(-4, size * 0.4, 8, 2.2);
    ctx.fillStyle = '#5a3b1e';
    ctx.fillRect(-1.2, size * 0.4 + 2.2, 2.4, 5);
    ctx.restore();
  }
}

function shieldEmblem(ctx: Ctx, x: number, y: number, s: number, field: number, charge: number) {
  ctx.beginPath();
  ctx.moveTo(x - s, y - s);
  ctx.lineTo(x + s, y - s);
  ctx.lineTo(x + s, y);
  ctx.quadraticCurveTo(x + s, y + s * 0.9, x, y + s * 1.4);
  ctx.quadraticCurveTo(x - s, y + s * 0.9, x - s, y);
  ctx.closePath();
  ctx.fillStyle = css(field);
  ctx.fill();
  ctx.lineWidth = 1.3;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.fillStyle = css(charge);
  ctx.fillRect(x - 1.2, y - s + 2, 2.4, s * 2);
  ctx.fillRect(x - s + 2, y - 1.2, s * 2 - 4, 2.4);
}

function fire(ctx: Ctx, x: number, y: number, s: number) {
  const g = ctx.createRadialGradient(x, y - s * 0.4, 1, x, y - s * 0.4, s * 2.4);
  g.addColorStop(0, 'rgba(255,200,80,0.55)');
  g.addColorStop(1, 'rgba(255,140,30,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y - s * 0.4, s * 2.4, 0, Math.PI * 2);
  ctx.fill();
  for (const [c, k] of [
    ['#e8461d', 1],
    ['#ff9a1f', 0.72],
    ['#ffe27a', 0.42],
  ] as [string, number][]) {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.moveTo(x - s * k, y);
    ctx.quadraticCurveTo(x - s * k, y - s * 1.2 * k, x - s * 0.15, y - s * 2 * k);
    ctx.quadraticCurveTo(x + s * 0.2 * k, y - s * 1.1 * k, x + s * 0.5 * k, y - s * 1.5 * k);
    ctx.quadraticCurveTo(x + s * k, y - s * 0.8 * k, x + s * k, y);
    ctx.closePath();
    ctx.fill();
  }
}

function coinPile(ctx: Ctx, x: number, y: number, r: number, seed: number) {
  const rr = rng(seed);
  ctx.fillStyle = '#c9901c';
  ctx.beginPath();
  ctx.ellipse(x, y, r, r * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x - r, y);
  ctx.quadraticCurveTo(x, y - r * 1.2, x + r, y);
  ctx.fillStyle = '#f2c23a';
  ctx.fill();
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = INK;
  ctx.stroke();
  for (let i = 0; i < r * 1.6; i++) {
    const cx = x + (rr() - 0.5) * r * 1.4,
      cy = y - rr() * r * 0.6;
    ctx.fillStyle = rr() < 0.5 ? '#ffe17a' : '#e9a91f';
    ctx.beginPath();
    ctx.ellipse(cx, cy, 3, 1.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(120,70,0,0.7)';
    ctx.lineWidth = 0.7;
    ctx.stroke();
  }
}

function crystal(ctx: Ctx, x: number, y: number, h: number, color = 0x9b5cf6) {
  const g = ctx.createRadialGradient(x, y - h / 2, 1, x, y - h / 2, h * 1.4);
  g.addColorStop(0, css(tone(color, 1.4), 0.55));
  g.addColorStop(1, css(color, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y - h / 2, h * 1.4, 0, Math.PI * 2);
  ctx.fill();
  const w = h * 0.36;
  ctx.beginPath();
  ctx.moveTo(x, y - h);
  ctx.lineTo(x + w, y - h * 0.55);
  ctx.lineTo(x, y);
  ctx.lineTo(x - w, y - h * 0.55);
  ctx.closePath();
  ctx.fillStyle = css(color);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x, y - h);
  ctx.lineTo(x - w, y - h * 0.55);
  ctx.lineTo(x, y);
  ctx.closePath();
  ctx.fillStyle = css(tone(color, 1.35));
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x, y - h);
  ctx.lineTo(x + w, y - h * 0.55);
  ctx.lineTo(x, y);
  ctx.lineTo(x - w, y - h * 0.55);
  ctx.closePath();
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = INK;
  ctx.stroke();
}

function log(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, r: number, color = 0x7a4b25) {
  ctx.lineCap = 'round';
  ctx.strokeStyle = INK;
  ctx.lineWidth = r * 2 + 2;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.strokeStyle = css(color);
  ctx.lineWidth = r * 2;
  ctx.stroke();
  ctx.strokeStyle = css(tone(color, 1.25), 0.7);
  ctx.lineWidth = r * 0.6;
  ctx.beginPath();
  ctx.moveTo(x0, y0 - r * 0.4);
  ctx.lineTo(x1, y1 - r * 0.4);
  ctx.stroke();
  ctx.lineCap = 'butt';
  ctx.fillStyle = css(tone(color, 1.35));
  ctx.beginPath();
  ctx.ellipse(x1, y1, r * 0.75, r, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = INK;
  ctx.stroke();
}

function rock(ctx: Ctx, x: number, y: number, r: number, color = 0x9a958c) {
  ctx.beginPath();
  ctx.moveTo(x - r, y);
  ctx.quadraticCurveTo(x - r, y - r * 0.9, x - r * 0.2, y - r);
  ctx.quadraticCurveTo(x + r * 0.9, y - r, x + r, y - r * 0.2);
  ctx.quadraticCurveTo(x + r, y + r * 0.35, x, y + r * 0.35);
  ctx.quadraticCurveTo(x - r, y + r * 0.35, x - r, y);
  ctx.fillStyle = css(color);
  ctx.fill();
  ctx.lineWidth = 1.1;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.fillStyle = css(tone(color, 1.3), 0.8);
  ctx.beginPath();
  ctx.ellipse(x - r * 0.3, y - r * 0.55, r * 0.35, r * 0.18, -0.3, 0, Math.PI * 2);
  ctx.fill();
}

function tent(a: DrawArgs, u: number, v: number, r: number, canvas: number, stripe: number) {
  const { iso, ctx } = a;
  const c = iso.p(u, v);
  const rx = r * TW * 0.7,
    h = rx * 1.25;
  ctx.beginPath();
  ctx.moveTo(c.x - rx, c.y);
  ctx.quadraticCurveTo(c.x, c.y + rx * 0.55, c.x + rx, c.y);
  ctx.lineTo(c.x, c.y - h);
  ctx.closePath();
  const g = ctx.createLinearGradient(c.x - rx, 0, c.x + rx, 0);
  g.addColorStop(0, css(tone(canvas, 1.05)));
  g.addColorStop(0.45, css(tone(canvas, 1.12)));
  g.addColorStop(0.5, css(tone(canvas, 0.78)));
  g.addColorStop(1, css(tone(canvas, 0.66)));
  ctx.fillStyle = g;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = css(stripe, 0.85);
  for (const t of [0.32, 0.62]) {
    ctx.beginPath();
    ctx.moveTo(c.x, c.y - h);
    ctx.lineTo(c.x - rx + rx * 2 * t - 3, c.y + 6);
    ctx.lineTo(c.x - rx + rx * 2 * t + 3, c.y + 6);
    ctx.closePath();
    ctx.fill();
  }
  // Door flap.
  ctx.fillStyle = 'rgba(40,20,5,0.75)';
  ctx.beginPath();
  ctx.moveTo(c.x - rx * 0.28, c.y + rx * 0.1);
  ctx.lineTo(c.x - rx * 0.05, c.y - h * 0.45);
  ctx.lineTo(c.x + rx * 0.12, c.y + rx * 0.2);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  ctx.beginPath();
  ctx.moveTo(c.x - rx, c.y);
  ctx.quadraticCurveTo(c.x, c.y + rx * 0.55, c.x + rx, c.y);
  ctx.lineTo(c.x, c.y - h);
  ctx.closePath();
  ctx.lineWidth = 1.3;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.strokeStyle = '#5a3b1e';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(c.x, c.y - h);
  ctx.lineTo(c.x, c.y - h - 5);
  ctx.stroke();
}

/** A small lookout of four posts with a plank deck. */
function stilts(a: DrawArgs, k: number, z: number, color: number) {
  const { iso, ctx, H } = a;
  const legs: [number, number][] = [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ];
  for (const [su, sv] of legs) {
    const b = iso.p(su * k * H, sv * k * H, 0),
      t = iso.p(su * k * H * 0.82, sv * k * H * 0.82, z);
    log(ctx, b.x, b.y, t.x, t.y, 2.6, color);
  }
  const l = iso.p(-k * H, k * H, z * 0.45),
    r = iso.p(k * H, -k * H, z * 0.45),
    bt = iso.p(k * H, k * H, z * 0.45);
  ctx.strokeStyle = css(tone(color, 0.8));
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(l.x, l.y);
  ctx.lineTo(bt.x, bt.y - z * 0.25);
  ctx.moveTo(bt.x, bt.y);
  ctx.lineTo(r.x, r.y - z * 0.25);
  ctx.stroke();
}

// ---------- Families ----------

export const SPECS: Record<string, BuildingSpec> = {
  headquarters: {
    head: 156,
    patch: 0.98,
    draw(a) {
      const { iso, ctx, H, pal, stage } = a;
      foundation(a, 0.9, 14);
      if (stage >= 1)
        for (const [u, v] of [
          [-0.78, 0.78],
          [0.78, -0.78],
          [0.78, 0.78],
        ] as [number, number][]) {
          iso.cylinder(u * H, v * H, 0.24, 14, 46 + stage * 6, pal.stone, (x0, x1, t, b) =>
            stoneRings(ctx, x0, x1, t, b, pal.stone),
          );
          iso.cone(u * H, v * H, 0.3, 60 + stage * 6, 24, pal.roof, pal.rich ? pal.trim : undefined);
        }
      hall(a, { ka: 0.68, kb: 0.68, z: 14, h: 30 + stage * 4, doorSide: 'left', windows: 3 });
      const top = 44 + stage * 4;
      // Second storey and keep roof.
      hall(a, { ka: 0.42, kb: 0.42, z: top, h: 20, windows: 1 });
      iso.roof(0, 0, 0.74 * H, 0.74 * H, top, 12, pal.roof, pal.rich ? pal.trim : undefined);
      iso.roof(0, 0, 0.5 * H, 0.5 * H, top + 20, 34, pal.roof, pal.rich ? pal.trim : undefined);
      // Front banner hanging over the door.
      iso.onFace('left', 0, 0, 0.68 * H, 0.68 * H, 14, () => {
        const w = 0.68 * H * TW;
        ctx.fillStyle = css(pal.accent);
        ctx.beginPath();
        ctx.moveTo(w / 2 - 7, -30 - stage * 4);
        ctx.lineTo(w / 2 + 7, -30 - stage * 4);
        ctx.lineTo(w / 2 + 7, -19);
        ctx.lineTo(w / 2, -22);
        ctx.lineTo(w / 2 - 7, -19);
        ctx.closePath();
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = INK;
        ctx.stroke();
        ctx.fillStyle = pal.rich ? '#fff3c4' : '#f2c23a';
        ctx.beginPath();
        ctx.arc(w / 2, -26 - stage * 2, 2.4, 0, Math.PI * 2);
        ctx.fill();
      });
      iso.flag(0, 0, top + 54, pal.rich ? 0xe8b83e : 0xc63b2c, 24);
    },
  },
  treasury: {
    head: 96,
    patch: 0.95,
    draw(a) {
      const { iso, ctx, H, pal, stage } = a;
      foundation(a, 0.86, 10);
      // Iron-bound vault walls.
      const band = stage === 2 ? pal.trim : pal.metal;
      iso.box(0, 0, 0.72 * H, 0.72 * H, 10, 26, stage === 0 ? pal.wood : pal.wall, {
        left: (f) => {
          if (stage === 0) planks(ctx, f, pal.wood, { seed: 31 });
          else bricks(ctx, f, pal.wall, { seed: 31 });
          vaultBands(ctx, f, band);
          // Keyhole lock plate.
          ctx.fillStyle = css(band);
          ctx.fillRect(f.w / 2 - 5, -f.h * 0.7, 10, 12);
          ctx.strokeStyle = INK;
          ctx.strokeRect(f.w / 2 - 5, -f.h * 0.7, 10, 12);
          ctx.fillStyle = '#20140a';
          ctx.beginPath();
          ctx.arc(f.w / 2, -f.h * 0.7 + 5, 1.8, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillRect(f.w / 2 - 0.8, -f.h * 0.7 + 5, 1.6, 4);
        },
        right: (f) => {
          if (stage === 0) planks(ctx, f, pal.wood, { seed: 32 });
          else bricks(ctx, f, pal.wall, { seed: 32 });
          vaultBands(ctx, f, band);
        },
        topColor: 0x5a3b1e,
      });
      const c = iso.p(0, 0, 36);
      coinPile(ctx, c.x - 8, c.y + 4, 16 + stage * 3, 41);
      crystal(ctx, c.x + 18, c.y + 2, 18 + stage * 3, 0x9b5cf6);
      crystal(ctx, c.x + 9, c.y + 7, 11 + stage * 2, 0xb57cff);
      if (stage >= 1) coinPile(ctx, c.x - 22, c.y + 10, 9, 43);
    },
  },
  barracks: {
    head: 104,
    patch: 0.95,
    draw(a) {
      const { iso, ctx, H, pal, stage } = a;
      foundation(a, 0.86, 10);
      hall(a, { ka: 0.74, kb: 0.56, z: 10, h: 26 + stage * 2, doorSide: 'left', windows: 2 });
      const z = 36 + stage * 2;
      iso.roof(0, 0, 0.82 * H, 0.64 * H, z, 30, pal.roof, pal.rich ? pal.trim : undefined);
      // Crossed swords plaque on the roof's gable end.
      const p = iso.p(0.66 * H, 0.2 * H, z + 14);
      shieldEmblem(ctx, p.x, p.y - 4, 7, pal.accent, 0xf3ecdb);
      crossedSwords(ctx, p.x, p.y - 2, 10);
      // Training dummy and brazier on the forecourt.
      const d = iso.p(-0.3 * H, 0.86 * H, 10);
      fire(ctx, d.x - 18, d.y + 2, 5);
      iso.flag(-0.7 * H, -0.5 * H, z + 4, pal.accent, 30);
    },
  },
  army_camp: {
    head: 70,
    patch: 0,
    draw(a) {
      const { iso, ctx, H, pal, stage } = a;
      // Trampled earth ring bounded by stones.
      ctx.save();
      ctx.beginPath();
      const c = iso.p(0, 0);
      ctx.ellipse(c.x, c.y, 0.92 * H * TW * 0.98, 0.92 * H * TH * 0.98, 0, 0, Math.PI * 2);
      const g = ctx.createRadialGradient(c.x, c.y, 4, c.x, c.y, 0.92 * H * TW);
      g.addColorStop(0, '#b9975f');
      g.addColorStop(0.85, '#a6844f');
      g.addColorStop(1, '#8c7a45');
      ctx.fillStyle = g;
      ctx.fill();
      ctx.restore();
      const r = rng(17);
      const n = 22;
      for (let i = 0; i < n; i++) {
        const t = (i / n) * Math.PI * 2;
        rock(
          ctx,
          c.x + Math.cos(t) * 0.92 * H * TW * 0.95,
          c.y + Math.sin(t) * 0.92 * H * TH * 0.95,
          3.5 + r() * 2,
          stage === 2 ? 0xb9b4aa : 0x9a958c,
        );
      }
      // Fire pit with logs.
      rockRing(ctx, c.x, c.y + 2, 12);
      log(ctx, c.x - 9, c.y + 4, c.x + 7, c.y - 1, 2.2);
      log(ctx, c.x + 8, c.y + 5, c.x - 6, c.y - 2, 2.2);
      fire(ctx, c.x, c.y + 1, 7);
      const tents: [number, number][] = [
        [-0.55, -0.15],
        [0.1, -0.6],
        ...(stage >= 1 ? ([[0.55, 0.2]] as [number, number][]) : []),
        ...(stage >= 2 ? ([[-0.15, 0.55]] as [number, number][]) : []),
      ];
      for (const [u, v] of tents.sort((p, q) => p[0] + p[1] - (q[0] + q[1])))
        tent(a, u * H, v * H, 0.42, stage === 2 ? 0xf2ead6 : 0xd9c39a, pal.accent);
      iso.flag(0.7 * H, -0.6 * H, 0, pal.accent, 34);
    },
  },
  research_library: {
    head: 136,
    patch: 0.95,
    draw(a) {
      const { iso, ctx, H, pal, stage } = a;
      foundation(a, 0.86, 10);
      hall(a, { ka: 0.7, kb: 0.7, z: 10, h: 22, doorSide: 'left', windows: 2 });
      iso.roof(0, 0, 0.78 * H, 0.78 * H, 32, 10, pal.roof);
      const th = 30 + stage * 8;
      iso.cylinder(0, 0, 0.36, 36, th, pal.wall, (x0, x1, t, b) => {
        stoneRings(ctx, x0, x1, t, b, pal.wall);
        const cx = (x0 + x1) / 2;
        windowArch(ctx, cx - 4, t + 22, 6, 12, true, pal.trim);
      });
      iso.cone(0, 0, 0.46, 36 + th, 36, stage === 1 ? 0x2f5fa8 : pal.roof, 0xe8b83e);
      // Floating rune orb above the spire.
      const p = iso.p(0, 0, 36 + th + 44);
      const g = ctx.createRadialGradient(p.x, p.y, 1, p.x, p.y, 12);
      g.addColorStop(0, 'rgba(190,240,255,0.95)');
      g.addColorStop(0.4, 'rgba(110,200,255,0.6)');
      g.addColorStop(1, 'rgba(110,200,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 12, 0, Math.PI * 2);
      ctx.fill();
      // A stack of books by the door.
      const b = iso.p(-0.2 * H, 0.82 * H, 10);
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = ['#a8322a', '#2f6fd0', '#2f8f4e'][i]!;
        ctx.fillRect(b.x - 12 - i, b.y - 4 - i * 3, 11, 3);
        ctx.strokeStyle = INK;
        ctx.lineWidth = 0.8;
        ctx.strokeRect(b.x - 12 - i, b.y - 4 - i * 3, 11, 3);
      }
    },
  },
  clan_hall: {
    head: 116,
    patch: 0.95,
    draw(a) {
      const { iso, ctx, H, pal, stage } = a;
      foundation(a, 0.88, 12);
      // Crenellated keep.
      iso.box(0, 0, 0.66 * H, 0.66 * H, 12, 30, pal.stone, {
        left: (f) => {
          bricks(ctx, f, tone(pal.stone, 1.12), { seed: 51 });
          door(ctx, f.w / 2, 13, 20, 0x6b3f22);
        },
        right: (f) => bricks(ctx, f, tone(pal.stone, 1.12), { seed: 52 }),
        top: false,
      });
      merlons(a, 0.66, 42, tone(pal.stone, 1.12));
      iso.roof(0, 0, 0.46 * H, 0.46 * H, 42, 30, pal.roof, pal.rich ? pal.trim : undefined);
      const p = iso.p(0.66 * H, 0.1 * H, 28);
      shieldEmblem(ctx, p.x + 2, p.y - 2, 8, stage === 2 ? 0xdca72e : 0x2f8f4e, 0xf3ecdb);
      iso.flag(-0.55 * H, -0.55 * H, 46, 0x2f8f4e, 30);
      iso.flag(0.55 * H, -0.55 * H, 46, 0xe8b83e, 30);
    },
  },
  workshop: {
    head: 100,
    patch: 0.95,
    draw(a) {
      const { iso, ctx, H, pal, stage } = a;
      foundation(a, 0.86, 8);
      hall(a, { ka: 0.7, kb: 0.62, z: 8, h: 26, doorSide: 'right', windows: 2 });
      iso.roof(0, 0, 0.78 * H, 0.7 * H, 34, 22, pal.roof);
      // Chimney with smoke.
      iso.box(0.3 * H, -0.35 * H, 0.1 * H, 0.1 * H, 40, 28, pal.stone, {
        left: (f) => bricks(ctx, f, pal.stone, { bw: 6, bh: 4 }),
        right: (f) => bricks(ctx, f, pal.stone, { bw: 6, bh: 4 }),
      });
      const s = iso.p(0.3 * H, -0.35 * H, 72);
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = `rgba(230,230,225,${0.7 - i * 0.18})`;
        ctx.beginPath();
        ctx.arc(s.x + i * 4, s.y - i * 9, 4 + i * 2, 0, Math.PI * 2);
        ctx.fill();
      }
      // Big gear on the gable.
      const g = iso.p(-0.1 * H, 0.66 * H, 22);
      gear(ctx, g.x, g.y, 9 + stage, stage === 2 ? 0xe8b83e : pal.metal);
      const w = iso.p(0.5 * H, 0.85 * H, 8);
      log(ctx, w.x - 14, w.y, w.x + 2, w.y - 4, 2.5);
      log(ctx, w.x - 12, w.y - 5, w.x + 4, w.y - 9, 2.5);
    },
  },
  builder_lodge: {
    head: 70,
    patch: 0.92,
    draw(a) {
      const { iso, ctx, H } = a;
      const wood = 0xb07a43;
      iso.box(0, 0, 0.66 * H, 0.66 * H, 0, 20, wood, {
        left: (f) => {
          planks(ctx, f, wood, { seed: 61, vertical: false, pw: 4 });
          door(ctx, f.w * 0.55, 10, 15);
        },
        right: (f) => {
          planks(ctx, f, wood, { seed: 62, vertical: false, pw: 4 });
          windowArch(ctx, f.w / 2, -7, 6, 8, true);
        },
        top: false,
      });
      thatch(a, 0.8, 20, 24);
      // Hammer sign.
      const p = iso.p(0.7 * H, 0.75 * H, 6);
      ctx.save();
      ctx.translate(p.x + 6, p.y - 12);
      ctx.rotate(-0.5);
      ctx.fillStyle = '#7a4b25';
      ctx.fillRect(-1.5, -2, 3, 16);
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1;
      ctx.strokeRect(-1.5, -2, 3, 16);
      ctx.fillStyle = '#8f969e';
      ctx.fillRect(-6, -6, 12, 5);
      ctx.strokeRect(-6, -6, 12, 5);
      ctx.restore();
    },
  },

  // ---------- Defences ----------
  bolt_thrower: {
    head: 70,
    patch: 0.9,
    draw(a) {
      const { iso, ctx, pal, stage } = a;
      platform(a, 0.78, 14);
      const c = iso.p(0, 0, 14);
      // Turntable and heavy ballista aimed toward the viewer's left.
      iso.cylinder(0, 0, 0.32, 14, 6, pal.wood);
      ctx.save();
      ctx.translate(c.x, c.y - 14);
      const metal = stage === 2 ? '#e8b83e' : css(pal.metal);
      // Stock.
      ctx.fillStyle = '#7a4b25';
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(-26, 8);
      ctx.lineTo(10, -8);
      ctx.lineTo(14, -2);
      ctx.lineTo(-22, 13);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // Bow arms.
      ctx.strokeStyle = INK;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(-26, -6);
      ctx.quadraticCurveTo(-14, 4, -12, 22);
      ctx.stroke();
      ctx.strokeStyle = metal;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.strokeStyle = '#e6dcc8';
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(-26, -6);
      ctx.lineTo(6, -4);
      ctx.lineTo(-12, 22);
      ctx.stroke();
      // Loaded bolt.
      ctx.fillStyle = '#d9d3c4';
      ctx.beginPath();
      ctx.moveTo(-34, 12);
      ctx.lineTo(-27, 7);
      ctx.lineTo(-26, 11);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    },
  },
  watchtower: {
    head: 150,
    patch: 0.9,
    draw(a) {
      const { iso, ctx, H, pal, stage } = a;
      const z = 66 + stage * 8;
      if (stage === 0) stilts(a, 0.62, z, 0x8a5a2e);
      else
        iso.box(0, 0, 0.5 * H, 0.5 * H, 0, z, pal.stone, {
          left: (f) => {
            bricks(ctx, f, pal.stone, { seed: 71 });
            windowArch(ctx, f.w / 2, -f.h * 0.55, 5, 10, false);
          },
          right: (f) => bricks(ctx, f, pal.stone, { seed: 72 }),
          top: false,
        });
      // Lookout with railing and archers.
      iso.box(0, 0, 0.66 * H, 0.66 * H, z, 6, pal.wood, {
        left: (f) => planks(ctx, f, pal.wood, { vertical: false, pw: 3 }),
        right: (f) => planks(ctx, f, pal.wood, { vertical: false, pw: 3 }),
      });
      for (const [u, v] of [
        [-0.2, -0.25],
        [0.25, 0.1],
      ] as [number, number][]) {
        const p = iso.p(u * H, v * H, z + 6);
        archer(ctx, p.x, p.y, stage === 2 ? 0xdca72e : 0x2f8f4e);
      }
      for (const side of ['left', 'right'] as const)
        iso.onFace(side, 0, 0, 0.66 * H, 0.66 * H, z + 6, () => railing(ctx, 0.66 * H * TW, 12, pal.wood));
      iso.roof(0, 0, 0.72 * H, 0.72 * H, z + 30, 26, pal.roof, pal.rich ? pal.trim : undefined);
      for (const [u, v] of [
        [-0.6, 0.6],
        [0.6, 0.6],
        [0.6, -0.6],
      ] as [number, number][]) {
        const b = iso.p(u * H, v * H, z + 6),
          t = iso.p(u * H, v * H, z + 30);
        log(ctx, b.x, b.y, t.x, t.y, 1.6, 0x6b4423);
      }
    },
  },
  catapult: {
    head: 80,
    patch: 0.9,
    draw(a) {
      const { iso, ctx, H, pal, stage } = a;
      // Sunken stone pit.
      iso.cylinder(0, 0, 0.62 * H, 0, 16, pal.stone, (x0, x1, t, b) =>
        stoneRings(ctx, x0, x1, t, b, pal.stone),
      );
      const c = iso.p(0, 0, 16);
      ctx.fillStyle = 'rgba(40,25,10,0.55)';
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, 0.5 * H * TW * 0.7, 0.25 * H * TW * 0.7, 0, 0, Math.PI * 2);
      ctx.fill();
      // Frame, throwing arm and a boulder in the cup.
      const wood = '#7a4b25';
      log(ctx, c.x - 20, c.y + 6, c.x - 8, c.y - 18, 2.4);
      log(ctx, c.x + 18, c.y + 4, c.x + 6, c.y - 18, 2.4);
      log(ctx, c.x - 10, c.y - 16, c.x + 8, c.y - 16, 2.2);
      ctx.save();
      ctx.translate(c.x, c.y - 4);
      ctx.rotate(-0.55);
      ctx.fillStyle = wood;
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.2;
      ctx.fillRect(-3, -34, 6, 40);
      ctx.strokeRect(-3, -34, 6, 40);
      ctx.beginPath();
      ctx.arc(0, -36, 7, 0, Math.PI);
      ctx.fillStyle = '#5a3b1e';
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      const bx = c.x + Math.sin(0.55) * 36,
        by = c.y - 4 - Math.cos(0.55) * 36;
      rock(ctx, bx, by - 2, 6 + stage, 0x8d8a84);
      if (pal.rich) {
        ctx.fillStyle = css(pal.trim);
        ctx.fillRect(c.x - 11, c.y - 18, 22, 3);
      }
    },
  },
  skyspear: {
    head: 110,
    patch: 0.9,
    draw(a) {
      const { iso, ctx, H, pal, stage } = a;
      platform(a, 0.72, 12);
      iso.box(0, 0, 0.42 * H, 0.42 * H, 12, 34 + stage * 6, pal.stone, {
        left: (f) => bricks(ctx, f, tone(pal.stone, 1.1), { seed: 81 }),
        right: (f) => bricks(ctx, f, tone(pal.stone, 1.1), { seed: 82 }),
        topColor: pal.wood,
      });
      const p = iso.p(0, 0, 46 + stage * 6);
      // Rack of spears pointed at the sky.
      const tip = stage === 2 ? '#f2c94c' : '#d6dbe0';
      for (const [dx, lean] of [
        [-8, -0.35],
        [0, -0.12],
        [8, 0.15],
      ] as [number, number][]) {
        ctx.save();
        ctx.translate(p.x + dx, p.y + 2);
        ctx.rotate(lean);
        ctx.fillStyle = '#7a4b25';
        ctx.strokeStyle = INK;
        ctx.lineWidth = 1.1;
        ctx.fillRect(-1.6, -40, 3.2, 40);
        ctx.strokeRect(-1.6, -40, 3.2, 40);
        ctx.fillStyle = tip;
        ctx.beginPath();
        ctx.moveTo(-3.5, -40);
        ctx.lineTo(0, -52);
        ctx.lineTo(3.5, -40);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = css(pal.accent);
        ctx.fillRect(-2.5, -38, 5, 3);
        ctx.restore();
      }
      ctx.fillStyle = css(pal.metal);
      ctx.strokeStyle = INK;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y + 1, 14, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    },
  },
  arcane_spire: {
    head: 128,
    patch: 0.9,
    draw(a) {
      const { iso, ctx, pal, stage } = a;
      platform(a, 0.74, 10);
      const h = 50 + stage * 8;
      iso.cylinder(0, 0, 0.42, 10, h, tone(pal.stone, 1.1), (x0, x1, t, b) => {
        stoneRings(ctx, x0, x1, t, b, tone(pal.stone, 1.1));
        const cx = (x0 + x1) / 2;
        windowArch(ctx, cx - 6, t + 26, 6, 12, true, pal.trim);
        windowArch(ctx, cx + 10, t + 40, 5, 10, true, pal.trim);
      });
      // Crown of stone teeth around the crystal.
      const c = iso.p(0, 0, 10 + h);
      for (let i = 0; i < 7; i++) {
        const t = Math.PI * (0.05 + (i / 6) * 0.9);
        const x = c.x - Math.cos(t) * 20,
          y = c.y + Math.sin(t) * 9;
        ctx.fillStyle = css(tone(pal.stone, 1.2 - (i / 6) * 0.4));
        ctx.strokeStyle = INK;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x - 3, y);
        ctx.lineTo(x, y - 9);
        ctx.lineTo(x + 3, y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      crystal(ctx, c.x, c.y - 10, 26 + stage * 4, stage === 2 ? 0xe8b83e : 0xa45cff);
    },
  },
  storm_totem: {
    head: 96,
    patch: 0.85,
    draw(a) {
      const { iso, ctx, H, stage } = a;
      iso.cylinder(0, 0, 0.55 * H, 0, 8, 0x8e939b);
      // Carved totem pole.
      const wood = stage === 2 ? 0x6b4a8a : 0x8a5a2e;
      iso.box(0, 0, 0.26 * H, 0.26 * H, 8, 52, wood, {
        left: (f) => {
          planks(ctx, f, wood, { seed: 91 });
          for (let i = 0; i < 3; i++) totemFace(ctx, f.w / 2, -10 - i * 16, f.light);
        },
        right: (f) => planks(ctx, f, wood, { seed: 92 }),
      });
      const p = iso.p(0, 0, 60);
      // Lightning rod and a crackling coil.
      ctx.strokeStyle = '#c9d2db';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x, p.y - 18);
      ctx.stroke();
      ctx.fillStyle = '#8fd8ff';
      ctx.beginPath();
      ctx.arc(p.x, p.y - 20, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(160,230,255,0.9)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(p.x - 12, p.y - 26);
      ctx.lineTo(p.x - 5, p.y - 20);
      ctx.lineTo(p.x - 9, p.y - 16);
      ctx.moveTo(p.x + 12, p.y - 28);
      ctx.lineTo(p.x + 5, p.y - 22);
      ctx.lineTo(p.x + 9, p.y - 17);
      ctx.stroke();
    },
  },
  repeater: {
    head: 84,
    patch: 0.9,
    draw(a) {
      const { iso, ctx, H, pal, stage } = a;
      platform(a, 0.8, 16);
      iso.box(0, 0, 0.42 * H, 0.42 * H, 16, 10, pal.wood, {
        left: (f) => planks(ctx, f, pal.wood, { vertical: false, pw: 3 }),
        right: (f) => planks(ctx, f, pal.wood, { vertical: false, pw: 3 }),
        topColor: pal.metal,
      });
      const c = iso.p(0, 0, 26);
      const metal = stage === 2 ? '#e8b83e' : css(pal.metal);
      ctx.save();
      ctx.translate(c.x, c.y - 4);
      // Long crossbow with a magazine box.
      ctx.fillStyle = '#6b4423';
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(-34, 14);
      ctx.lineTo(18, -12);
      ctx.lineTo(22, -6);
      ctx.lineTo(-30, 19);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = metal;
      ctx.fillRect(-2, -14, 12, 12);
      ctx.strokeRect(-2, -14, 12, 12);
      for (const side of [-1, 1]) {
        ctx.strokeStyle = INK;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(-24, 9);
        ctx.quadraticCurveTo(-24 + side * 10, 9 - 6, -24 + side * 16, 9 + side * 16);
        ctx.stroke();
        ctx.strokeStyle = metal;
        ctx.lineWidth = 3;
        ctx.stroke();
      }
      ctx.restore();
    },
  },
  ember_tower: {
    head: 122,
    patch: 0.85,
    draw(a) {
      const { iso, ctx, H, stage } = a;
      const dark = stage === 2 ? 0x55506a : 0x5c5550;
      iso.box(0, 0, 0.56 * H, 0.56 * H, 0, 12, dark, {
        left: (f) => bricks(ctx, f, dark, { seed: 101, bw: 9, bh: 5 }),
        right: (f) => bricks(ctx, f, dark, { seed: 102, bw: 9, bh: 5 }),
      });
      iso.box(0, 0, 0.36 * H, 0.36 * H, 12, 54 + stage * 6, dark, {
        left: (f) => {
          bricks(ctx, f, dark, { seed: 103, bw: 8, bh: 5 });
          // Glowing lava seams.
          ctx.strokeStyle = 'rgba(255,120,30,0.85)';
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.moveTo(f.w * 0.3, 0);
          ctx.lineTo(f.w * 0.4, -f.h * 0.4);
          ctx.lineTo(f.w * 0.3, -f.h * 0.7);
          ctx.stroke();
        },
        right: (f) => bricks(ctx, f, dark, { seed: 104, bw: 8, bh: 5 }),
        topColor: 0x2a1a10,
      });
      const p = iso.p(0, 0, 66 + stage * 6);
      // Brazier bowl and roaring fire.
      ctx.fillStyle = stage === 2 ? '#e8b83e' : '#3a3633';
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(p.x - 16, p.y - 6);
      ctx.quadraticCurveTo(p.x, p.y + 10, p.x + 16, p.y - 6);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      fire(ctx, p.x, p.y - 4, 11 + stage * 2);
    },
  },
  wall: {
    head: 40,
    patch: 0,
    draw(a) {
      const { iso, ctx, pal, stage, variant } = a;
      const color = stage === 0 ? 0x9a6a3c : stage === 1 ? 0xb3b0a8 : 0x5d6070;
      const h = 18 + stage * 3;
      const k = 0.24;
      // Connectors toward +u (down-right) and +v (down-left) neighbours.
      if (variant & 2) wallSegment(a, 'v', color, h - 3);
      if (variant & 1) wallSegment(a, 'u', color, h - 3);
      if (stage === 0) {
        palisade(a, color, h + 4);
        return;
      }
      iso.box(0, 0, k, k, 0, h, color, {
        left: (f) => bricks(ctx, f, color, { bw: 8, bh: 5, seed: 111 }),
        right: (f) => bricks(ctx, f, color, { bw: 8, bh: 5, seed: 112 }),
      });
      if (stage === 2) {
        iso.box(0, 0, k * 1.1, k * 1.1, h, 3, pal.trim);
        const p = iso.p(0, 0, h + 3);
        ctx.fillStyle = '#fff1b0';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    },
  },

  // ---------- Traps (owners see them; attackers do not) ----------
  blast_mine: {
    head: 24,
    patch: 0,
    draw(a) {
      const { iso, ctx, stage } = a;
      const c = iso.p(0, 0, 0);
      dirtMound(ctx, c.x, c.y, 16);
      ctx.fillStyle = stage === 2 ? '#3a3040' : '#2b2b2e';
      ctx.beginPath();
      ctx.arc(c.x, c.y - 5, 8, Math.PI, 0);
      ctx.fill();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = INK;
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.beginPath();
      ctx.arc(c.x - 3, c.y - 9, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#c9a26b';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(c.x + 3, c.y - 12);
      ctx.quadraticCurveTo(c.x + 8, c.y - 18, c.x + 6, c.y - 21);
      ctx.stroke();
      fire(ctx, c.x + 6, c.y - 20, 2.2);
    },
  },
  spring_snare: {
    head: 18,
    patch: 0,
    draw(a) {
      const { iso, ctx, pal } = a;
      iso.box(0, 0, 0.34, 0.34, 0, 3, 0x6b4423, {
        left: (f) => planks(ctx, f, 0x6b4423, { vertical: false, pw: 2 }),
        right: (f) => planks(ctx, f, 0x6b4423, { vertical: false, pw: 2 }),
      });
      const c = iso.p(0, 0, 3);
      ctx.strokeStyle = css(pal.metal);
      ctx.lineWidth = 2;
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.ellipse(c.x, c.y - 2 - i * 3, 7, 3, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    },
  },
  sky_mine: {
    head: 40,
    patch: 0,
    draw(a) {
      const { iso, ctx, stage } = a;
      const c = iso.p(0, 0, 0);
      dirtMound(ctx, c.x, c.y, 12);
      ctx.strokeStyle = '#5a3b1e';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(c.x, c.y - 2);
      ctx.lineTo(c.x, c.y - 16);
      ctx.stroke();
      ctx.fillStyle = stage === 2 ? '#e8b83e' : '#9b5cf6';
      ctx.beginPath();
      ctx.arc(c.x, c.y - 22, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = INK;
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.beginPath();
      ctx.arc(c.x - 2.5, c.y - 25, 2, 0, Math.PI * 2);
      ctx.fill();
    },
  },
  seeker_mine: {
    head: 40,
    patch: 0,
    draw(a) {
      const { iso, ctx } = a;
      const c = iso.p(0, 0, 0);
      dirtMound(ctx, c.x, c.y, 12);
      ctx.strokeStyle = '#5a3b1e';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(c.x, c.y - 2);
      ctx.lineTo(c.x, c.y - 14);
      ctx.stroke();
      ctx.fillStyle = '#c63b2c';
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.1;
      for (let i = 0; i < 8; i++) {
        const t = (i / 8) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(c.x + Math.cos(t) * 6, c.y - 21 + Math.sin(t) * 6);
        ctx.lineTo(c.x + Math.cos(t) * 10, c.y - 21 + Math.sin(t) * 10);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(c.x, c.y - 21, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#ffd34d';
      ctx.beginPath();
      ctx.arc(c.x, c.y - 21, 2.4, 0, Math.PI * 2);
      ctx.fill();
    },
  },
};

export const FALLBACK: BuildingSpec = {
  head: 90,
  patch: 0.9,
  draw(a) {
    foundation(a, 0.86, 10);
    hall(a, { ka: 0.7, kb: 0.7, z: 10, h: 26, doorSide: 'left' });
    a.iso.roof(0, 0, 0.78 * a.H, 0.78 * a.H, 36, 26, a.pal.roof);
  },
};

// ---------- Helpers used above ----------

function stoneRings(ctx: Ctx, x0: number, x1: number, top: number, bottom: number, color: number) {
  const r = rng(7);
  const rx = (x1 - x0) / 2,
    cx = (x0 + x1) / 2;
  for (let y = bottom, row = 0; y > top - 6; y -= 7, row++) {
    ctx.strokeStyle = css(tone(color, 0.6), 0.75);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(cx, y - rx / 2, rx, rx / 2, 0, 0.05, Math.PI - 0.05);
    ctx.stroke();
    for (let i = 0; i < 5; i++) {
      const t = (i + (row % 2) * 0.5) / 5;
      const ang = Math.PI * (0.08 + t * 0.84);
      const x = cx + Math.cos(ang) * rx;
      const yy = y - rx / 2 + Math.sin(ang) * (rx / 2);
      ctx.beginPath();
      ctx.moveTo(x, yy);
      ctx.lineTo(x, yy - 7);
      ctx.stroke();
      if (r() < 0.3) {
        ctx.fillStyle = css(tone(color, 1.18), 0.35);
        ctx.fillRect(x + 1, yy - 6, 4, 2);
      }
    }
  }
}

function vaultBands(ctx: Ctx, f: { w: number; h: number }, band: number) {
  ctx.fillStyle = css(band);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 0.8;
  for (const y of [-4, -f.h + 2]) {
    ctx.fillRect(0, y - 2, f.w, 4);
    ctx.strokeRect(0, y - 2, f.w, 4);
  }
  for (const x of [3, f.w - 3]) {
    ctx.fillRect(x - 2, -f.h, 4, f.h);
    ctx.strokeRect(x - 2, -f.h, 4, f.h);
  }
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  for (let x = 8; x < f.w - 4; x += 9) {
    ctx.beginPath();
    ctx.arc(x, -4, 0.9, 0, Math.PI * 2);
    ctx.arc(x, -f.h + 2, 0.9, 0, Math.PI * 2);
    ctx.fill();
  }
}

function rockRing(ctx: Ctx, x: number, y: number, r: number) {
  for (let i = 0; i < 9; i++) {
    const t = (i / 9) * Math.PI * 2;
    rock(ctx, x + Math.cos(t) * r, y + Math.sin(t) * r * 0.5, 3.2, 0x8d8a84);
  }
}

function platform(a: DrawArgs, k: number, h: number) {
  const { iso, ctx, H, pal } = a;
  iso.box(0, 0, k * H, k * H, 0, h, pal.stone, {
    left: (f) => bricks(ctx, f, pal.stone, { seed: 121 }),
    right: (f) => bricks(ctx, f, pal.stone, { seed: 122 }),
    top: () => {
      const c = iso.p(0, 0, h);
      ctx.strokeStyle = css(tone(pal.stone, 0.75), 0.6);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, k * H * TW * 0.55, k * H * TH * 0.55, 0, 0, Math.PI * 2);
      ctx.stroke();
    },
  });
}

/** Battlements along the two front edges of a k·H square at height z. */
function merlons(a: DrawArgs, k: number, z: number, color: number) {
  const { iso, H } = a;
  const n = 4,
    half = (k * H) / n / 2,
    depth = 0.09;
  // Back to front so nearer blocks overlap farther ones.
  for (let i = 0; i < n; i++)
    iso.box(k * H - depth, (-k + ((i * 2 + 1) / n) * k) * H, depth, half * 0.6, z, 6, color);
  for (let i = 0; i < n; i++)
    iso.box((-k + ((i * 2 + 1) / n) * k) * H, k * H - depth, half * 0.6, depth, z, 6, color);
}

function thatch(a: DrawArgs, k: number, z: number, h: number) {
  const { iso, ctx, H } = a;
  iso.roof(0, 0, k * H, k * H, z, h, 0xd9b45a, 0xa8822e);
  // Straw fringe hanging over the eaves.
  const L = iso.p(-k * H, k * H, z),
    B = iso.p(k * H, k * H, z),
    R = iso.p(k * H, -k * H, z);
  ctx.strokeStyle = '#a8822e';
  ctx.lineWidth = 1;
  for (const [p, q] of [
    [L, B],
    [B, R],
  ] as const)
    for (let t = 0; t <= 1; t += 0.06) {
      const x = p.x + (q.x - p.x) * t,
        y = p.y + (q.y - p.y) * t;
      ctx.beginPath();
      ctx.moveTo(x, y - 2);
      ctx.lineTo(x + 0.5, y + 3);
      ctx.stroke();
    }
}

function gear(ctx: Ctx, x: number, y: number, r: number, color: number) {
  ctx.beginPath();
  for (let i = 0; i < 16; i++) {
    const t = (i / 16) * Math.PI * 2;
    const rr = i % 2 ? r : r * 1.3;
    ctx.lineTo(x + Math.cos(t) * rr, y + Math.sin(t) * rr * 0.9);
  }
  ctx.closePath();
  ctx.fillStyle = css(color);
  ctx.fill();
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, r * 0.38, 0, Math.PI * 2);
  ctx.fillStyle = '#3a2a1a';
  ctx.fill();
  ctx.stroke();
}

function archer(ctx: Ctx, x: number, y: number, hood: number) {
  ctx.fillStyle = css(hood);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(x, y - 6, 4, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#f1c27d';
  ctx.beginPath();
  ctx.arc(x, y - 13, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = '#7a4b25';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(x - 5, y - 9, 5, -1.2, 1.2);
  ctx.stroke();
}

/** Open railing: posts and a top rail, so whatever stands behind shows through. */
function railing(ctx: Ctx, w: number, h: number, color: number) {
  ctx.fillStyle = css(color);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 0.9;
  for (let x = 1; x < w; x += 7) {
    ctx.fillRect(x, -h, 2.4, h);
    ctx.strokeRect(x, -h, 2.4, h);
  }
  ctx.fillRect(0, -h - 1, w, 3);
  ctx.strokeRect(0, -h - 1, w, 3);
}

function totemFace(ctx: Ctx, x: number, y: number, light: number) {
  ctx.fillStyle = css(tone(0xc63b2c, light));
  ctx.fillRect(x - 6, y - 2, 12, 3);
  ctx.fillStyle = '#f3ecdb';
  ctx.beginPath();
  ctx.arc(x - 3, y - 6, 1.8, 0, Math.PI * 2);
  ctx.arc(x + 3, y - 6, 1.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#20140a';
  ctx.fillRect(x - 3, y + 2, 6, 2);
}

function dirtMound(ctx: Ctx, x: number, y: number, r: number) {
  ctx.fillStyle = '#7a5a36';
  ctx.beginPath();
  ctx.ellipse(x, y, r, r * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#94704a';
  ctx.beginPath();
  ctx.ellipse(x - 2, y - 1, r * 0.7, r * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();
}

function wallSegment(a: DrawArgs, dir: 'u' | 'v', color: number, h: number) {
  const { iso, ctx, stage } = a;
  const w = 0.17;
  const u = dir === 'u' ? 0.5 : 0,
    v = dir === 'v' ? 0.5 : 0;
  const au = dir === 'u' ? 0.5 : w,
    av = dir === 'v' ? 0.5 : w;
  if (stage === 0) {
    iso.box(u, v, au, av, h * 0.35, 4, 0x7a4b25);
    iso.box(u, v, au, av, h * 0.75, 4, 0x7a4b25);
    return;
  }
  iso.box(u, v, au, av, 0, h, color, {
    left: (f) => bricks(ctx, f, color, { bw: 8, bh: 5, seed: 113 }),
    right: (f) => bricks(ctx, f, color, { bw: 8, bh: 5, seed: 114 }),
  });
}

function palisade(a: DrawArgs, color: number, h: number) {
  const { iso, ctx } = a;
  for (const [u, v] of [
    [-0.12, -0.12],
    [0.12, -0.12],
    [-0.12, 0.12],
    [0.12, 0.12],
  ] as [number, number][]) {
    const b = iso.p(u, v, 0);
    const g = ctx.createLinearGradient(b.x - 4, 0, b.x + 4, 0);
    g.addColorStop(0, css(tone(color, 1.1)));
    g.addColorStop(1, css(tone(color, 0.7)));
    ctx.fillStyle = g;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(b.x - 4, b.y);
    ctx.lineTo(b.x - 4, b.y - h);
    ctx.lineTo(b.x, b.y - h - 5);
    ctx.lineTo(b.x + 4, b.y - h);
    ctx.lineTo(b.x + 4, b.y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}

export function drawBuilding(
  ctx: Ctx,
  spec: BuildingSpec,
  s: number,
  w: number,
  h: number,
  stage: number,
  variant: number,
) {
  const iso = new Iso(ctx, w / 2, h - 2 - (s * TH) / 2);
  spec.draw({ iso, ctx, H: s / 2, pal: PALETTES[stage]!, stage, variant });
  return iso;
}

export function drawUnder(ctx: Ctx, spec: BuildingSpec, s: number, w: number, h: number) {
  const iso = new Iso(ctx, w / 2, h - 2 - (s * TH) / 2);
  const c = iso.p(0, 0);
  if (s > 1) softShadow(ctx, c.x + s * 6, c.y + 2, s * TW * 0.42, s * TH * 0.5, 0.34);
  else softShadow(ctx, c.x + 3, c.y + 1, 18, 8, 0.25);
  if (spec.patch) footprint(ctx, iso, (spec.patch * s) / 2);
}
