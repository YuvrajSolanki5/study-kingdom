import type Phaser from 'phaser';
import { TH, TW } from '../iso.ts';

// Canvas 2D toolkit for the procedural art. Everything is original and drawn
// once per texture key. Faces are painted in their own skewed coordinate space
// so bricks, planks and tiles follow the isometric projection.

export type Ctx = CanvasRenderingContext2D;
export type Pt = { x: number; y: number };

export const INK = '#2a1a0e';

export function mix(a: number, b: number, t: number): number {
  const ch = (s: number) => Math.round(((a >> s) & 0xff) * (1 - t) + ((b >> s) & 0xff) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}
export function tone(c: number, f: number): number {
  return f >= 1 ? mix(c, 0xffffff, Math.min(1, f - 1)) : mix(c, 0x1a0f08, 1 - f);
}
export function css(c: number, alpha = 1): string {
  const r = (c >> 16) & 0xff,
    g = (c >> 8) & 0xff,
    b = c & 0xff;
  return alpha === 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${alpha})`;
}

/** Deterministic noise so textures are identical on every run. */
export function rng(seed: number) {
  let s = seed % 2147483647 || 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

export function path(ctx: Ctx, pts: Pt[]) {
  ctx.beginPath();
  ctx.moveTo(pts[0]!.x, pts[0]!.y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]!.x, pts[i]!.y);
  ctx.closePath();
}
export function fillPoly(ctx: Ctx, pts: Pt[], fill: string | CanvasGradient, stroke = true, lw = 1.2) {
  path(ctx, pts);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.lineWidth = lw;
    ctx.strokeStyle = INK;
    ctx.stroke();
  }
}

/** Face light: the left face catches the sun, the right face is in shade. */
export const LIGHT = { top: 1.12, left: 0.94, right: 0.7 } as const;

export interface Face {
  /** Width of the face in screen-x pixels and height in pixels. */
  w: number;
  h: number;
  light: number;
}

/**
 * Isometric painter anchored at the centre of a building footprint. Local
 * coordinates: u runs down-right, v runs down-left (tile units), z is pixels up.
 */
export class Iso {
  constructor(
    readonly ctx: Ctx,
    readonly cx: number,
    readonly cy: number,
  ) {}

  p(u: number, v: number, z = 0): Pt {
    return { x: this.cx + ((u - v) * TW) / 2, y: this.cy + ((u + v) * TH) / 2 - z };
  }

  diamond(u: number, v: number, a: number, b: number, z: number): Pt[] {
    return [
      this.p(u - a, v - b, z),
      this.p(u + a, v - b, z),
      this.p(u + a, v + b, z),
      this.p(u - a, v + b, z),
    ];
  }

  /** Paints inside a face's skewed space: x across (0..w), y up is negative (0..-h). */
  onFace(side: 'left' | 'right', u: number, v: number, a: number, b: number, z: number, paint: () => void) {
    const ctx = this.ctx;
    const o = side === 'left' ? this.p(u - a, v + b, z) : this.p(u + a, v + b, z);
    ctx.save();
    ctx.transform(1, side === 'left' ? 0.5 : -0.5, 0, 1, o.x, o.y);
    paint();
    ctx.restore();
  }

  /**
   * A box with optional face painters. Painters receive a clipped face space
   * already filled with the base colour.
   */
  box(
    u: number,
    v: number,
    a: number,
    b: number,
    z: number,
    h: number,
    color: number,
    opts: {
      left?: (f: Face) => void;
      right?: (f: Face) => void;
      top?: (() => void) | false;
      topColor?: number;
    } = {},
  ) {
    const ctx = this.ctx;
    const faces: ['left' | 'right', number, number][] = [
      ['left', a * TW, LIGHT.left],
      ['right', b * TW, LIGHT.right],
    ];
    for (const [side, w, light] of faces) {
      this.onFace(side, u, v, a, b, z, () => {
        ctx.beginPath();
        ctx.rect(0, -h, w, h);
        const g = ctx.createLinearGradient(0, -h, 0, 0);
        g.addColorStop(0, css(tone(color, light * 1.06)));
        g.addColorStop(1, css(tone(color, light * 0.86)));
        ctx.fillStyle = g;
        ctx.fill();
        const paint = side === 'left' ? opts.left : opts.right;
        if (paint) {
          ctx.save();
          ctx.clip();
          paint({ w, h, light });
          ctx.restore();
        }
        // Contact shadow where the wall meets the ground.
        const ao = ctx.createLinearGradient(0, -Math.min(10, h), 0, 0);
        ao.addColorStop(0, 'rgba(0,0,0,0)');
        ao.addColorStop(1, 'rgba(20,10,0,0.28)');
        ctx.fillStyle = ao;
        ctx.fillRect(0, -Math.min(10, h), w, Math.min(10, h));
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = INK;
        ctx.strokeRect(0, -h, w, h);
      });
    }
    if (opts.top !== false) {
      const top = this.diamond(u, v, a, b, z + h);
      fillPoly(ctx, top, css(tone(opts.topColor ?? color, LIGHT.top)));
      if (opts.top) {
        ctx.save();
        path(ctx, top);
        ctx.clip();
        opts.top();
        ctx.restore();
        path(ctx, top);
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = INK;
        ctx.stroke();
      }
    }
  }

  /** Hipped roof with shingle rows; becomes a pyramid when a == b. */
  roof(u: number, v: number, a: number, b: number, z: number, h: number, color: number, ridgeColor?: number) {
    const ctx = this.ctx;
    const r = Math.min(a, b),
      ra = a - r,
      rb = b - r;
    const ridge0 = this.p(u - ra, v - rb, z + h),
      ridge1 = this.p(u + ra, v + rb, z + h);
    const R = this.p(u + a, v - b, z),
      B = this.p(u + a, v + b, z),
      L = this.p(u - a, v + b, z);
    const pyramid = !ra && !rb;
    // Only the two front slopes are visible. `up` is the screen step from the
    // eave to the ridge line, so shingle rows follow the slope.
    const slopes: { poly: Pt[]; light: number; e0: Pt; e1: Pt; up: Pt }[] = [
      {
        poly: pyramid ? [L, B, ridge1] : ra ? [L, B, ridge1, ridge0] : [L, B, ridge1],
        light: LIGHT.left * 1.04,
        e0: L,
        e1: B,
        up: { x: (b * TW) / 2, y: (-b * TH) / 2 - h },
      },
      {
        poly: pyramid ? [B, R, ridge0] : ra ? [B, R, ridge1] : [B, R, ridge0, ridge1],
        light: LIGHT.right * 0.98,
        e0: B,
        e1: R,
        up: { x: (-a * TW) / 2, y: (-a * TH) / 2 - h },
      },
    ];
    for (const { poly, light, e0, e1, up } of slopes) {
      const base = tone(color, light);
      fillPoly(ctx, poly, css(base), false);
      ctx.save();
      path(ctx, poly);
      ctx.clip();
      const shade = ctx.createLinearGradient(e0.x, e0.y, e0.x + up.x, e0.y + up.y);
      shade.addColorStop(0, 'rgba(30,10,0,0.18)');
      shade.addColorStop(1, 'rgba(255,240,210,0.12)');
      ctx.fillStyle = shade;
      ctx.fill();
      const rows = Math.max(3, Math.round(Math.hypot(up.x, up.y) / 6));
      const dx = e1.x - e0.x,
        dy = e1.y - e0.y,
        tabs = Math.max(2, Math.round(Math.hypot(dx, dy) / 7));
      for (let i = 0; i < rows; i++) {
        const t0 = i / rows,
          t1 = (i + 1) / rows;
        const o = { x: e0.x + up.x * t1, y: e0.y + up.y * t1 };
        const ext = 2; // overshoot so rows reach the hips; the clip trims them
        ctx.strokeStyle = css(tone(base, 0.68));
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(o.x - dx * ext, o.y - dy * ext);
        ctx.lineTo(o.x + dx * ext, o.y + dy * ext);
        ctx.stroke();
        ctx.strokeStyle = css(tone(base, 1.25), 0.45);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(o.x - dx * ext, o.y - dy * ext - 1.4);
        ctx.lineTo(o.x + dx * ext, o.y + dy * ext - 1.4);
        ctx.stroke();
        ctx.strokeStyle = css(tone(base, 0.72), 0.75);
        for (let k = -tabs; k <= tabs * 2; k++) {
          const f = (k + (i % 2) * 0.5) / tabs;
          const x = e0.x + dx * f + up.x * t0,
            y = e0.y + dy * f + up.y * t0;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + up.x * (t1 - t0), y + up.y * (t1 - t0));
          ctx.stroke();
        }
      }
      ctx.restore();
      path(ctx, poly);
      ctx.lineWidth = 1.3;
      ctx.strokeStyle = INK;
      ctx.stroke();
    }
    ctx.lineCap = 'round';
    ctx.strokeStyle = css(tone(color, 0.5));
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(L.x, L.y);
    ctx.lineTo(B.x, B.y);
    ctx.lineTo(R.x, R.y);
    ctx.stroke();
    // Ridge and the front hip, capped.
    ctx.strokeStyle = css(ridgeColor ?? tone(color, 0.78));
    ctx.lineWidth = 3.4;
    ctx.beginPath();
    ctx.moveTo(B.x, B.y);
    ctx.lineTo(ridge1.x, ridge1.y);
    if (!pyramid) {
      ctx.moveTo(ridge0.x, ridge0.y);
      ctx.lineTo(ridge1.x, ridge1.y);
    }
    ctx.stroke();
    ctx.lineCap = 'butt';
  }

  /** Upright cylinder; `paint` draws over the body in screen space (clipped). */
  cylinder(
    u: number,
    v: number,
    r: number,
    z: number,
    h: number,
    color: number,
    paint?: (x0: number, x1: number, top: number, bottom: number) => void,
  ) {
    const ctx = this.ctx;
    const c = this.p(u, v, z);
    const rx = r * TW * 0.7071,
      ry = rx / 2;
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, rx, ry, 0, 0, Math.PI);
    ctx.lineTo(c.x - rx, c.y - h);
    ctx.ellipse(c.x, c.y - h, rx, ry, 0, Math.PI, 0, true);
    ctx.closePath();
    const g = ctx.createLinearGradient(c.x - rx, 0, c.x + rx, 0);
    g.addColorStop(0, css(tone(color, 0.86)));
    g.addColorStop(0.3, css(tone(color, 1.06)));
    g.addColorStop(1, css(tone(color, 0.6)));
    ctx.fillStyle = g;
    ctx.fill();
    if (paint) {
      ctx.save();
      ctx.clip();
      paint(c.x - rx, c.x + rx, c.y - h, c.y + ry);
      ctx.restore();
    }
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(c.x, c.y - h, rx, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = css(tone(color, LIGHT.top));
    ctx.fill();
    ctx.stroke();
  }

  cone(u: number, v: number, r: number, z: number, h: number, color: number, tip?: number) {
    const ctx = this.ctx;
    const c = this.p(u, v, z);
    const rx = r * TW * 0.7071,
      ry = rx / 2;
    const apex = { x: c.x, y: c.y - h };
    ctx.beginPath();
    ctx.moveTo(c.x - rx, c.y);
    ctx.ellipse(c.x, c.y, rx, ry, 0, Math.PI, 0, true);
    ctx.lineTo(apex.x, apex.y);
    ctx.closePath();
    const g = ctx.createLinearGradient(c.x - rx, 0, c.x + rx, 0);
    g.addColorStop(0, css(tone(color, 0.95)));
    g.addColorStop(0.35, css(tone(color, 1.12)));
    g.addColorStop(1, css(tone(color, 0.6)));
    ctx.fillStyle = g;
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = css(tone(color, 0.62), 0.9);
    ctx.lineWidth = 1.2;
    for (let i = 1; i < 5; i++) {
      const t = i / 5;
      ctx.beginPath();
      ctx.ellipse(c.x, c.y - h * t, rx * (1 - t), ry * (1 - t), 0, 0, Math.PI);
      ctx.stroke();
    }
    ctx.restore();
    ctx.beginPath();
    ctx.moveTo(c.x - rx, c.y);
    ctx.ellipse(c.x, c.y, rx, ry, 0, Math.PI, 0, true);
    ctx.lineTo(apex.x, apex.y);
    ctx.closePath();
    ctx.lineWidth = 1.3;
    ctx.strokeStyle = INK;
    ctx.stroke();
    if (tip !== undefined) {
      ctx.fillStyle = css(tip);
      ctx.beginPath();
      ctx.arc(apex.x, apex.y - 2, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  /** Waving pennant on a pole. */
  flag(u: number, v: number, z: number, color: number, pole = 26) {
    const ctx = this.ctx;
    const b = this.p(u, v, z);
    ctx.lineCap = 'round';
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3.4;
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x, b.y - pole);
    ctx.stroke();
    ctx.strokeStyle = '#8a6a3a';
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.lineCap = 'butt';
    const t = b.y - pole + 1;
    ctx.beginPath();
    ctx.moveTo(b.x + 1, t);
    ctx.bezierCurveTo(b.x + 8, t - 4, b.x + 12, t + 4, b.x + 19, t + 1);
    ctx.lineTo(b.x + 15, t + 6);
    ctx.lineTo(b.x + 19, t + 11);
    ctx.bezierCurveTo(b.x + 12, t + 14, b.x + 8, t + 6, b.x + 1, t + 10);
    ctx.closePath();
    const g = ctx.createLinearGradient(b.x, t, b.x + 19, t + 10);
    g.addColorStop(0, css(tone(color, 1.15)));
    g.addColorStop(1, css(tone(color, 0.8)));
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.fillStyle = '#e8c34a';
    ctx.beginPath();
    ctx.arc(b.x, b.y - pole - 1, 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

// ---------- Face materials (drawn in face space: x 0..w, y -h..0) ----------

export function bricks(
  ctx: Ctx,
  f: Face,
  color: number,
  opts: { bw?: number; bh?: number; seed?: number; from?: number; to?: number } = {},
) {
  const bw = opts.bw ?? 11,
    bh = opts.bh ?? 6;
  const r = rng(opts.seed ?? 3);
  const y0 = -(opts.to ?? f.h),
    y1 = -(opts.from ?? 0);
  ctx.lineWidth = 1;
  for (let y = y1, row = 0; y > y0 - 0.1; y -= bh, row++) {
    for (let x = row % 2 ? -bw / 2 : 0; x < f.w; x += bw) {
      const c = tone(color, f.light * (0.9 + r() * 0.2));
      ctx.fillStyle = css(c);
      ctx.beginPath();
      ctx.roundRect(x + 0.6, y - bh + 0.6, bw - 1.2, bh - 1.2, 1.6);
      ctx.fill();
      ctx.fillStyle = css(tone(c, 1.2), 0.6);
      ctx.fillRect(x + 1.5, y - bh + 1, bw - 3, 1);
    }
  }
  ctx.strokeStyle = css(tone(color, f.light * 0.55), 0.7);
  for (let y = y1; y > y0; y -= bh) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(f.w, y);
    ctx.stroke();
  }
}

export function planks(
  ctx: Ctx,
  f: Face,
  color: number,
  opts: { pw?: number; seed?: number; vertical?: boolean } = {},
) {
  const r = rng(opts.seed ?? 5);
  const pw = opts.pw ?? 6;
  if (opts.vertical ?? true) {
    for (let x = 0; x < f.w; x += pw) {
      ctx.fillStyle = css(tone(color, f.light * (0.88 + r() * 0.22)));
      ctx.fillRect(x, -f.h, pw, f.h);
      ctx.strokeStyle = css(tone(color, f.light * 0.55), 0.8);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, -f.h);
      ctx.lineTo(x, 0);
      ctx.stroke();
      // Wood grain knots.
      if (r() < 0.35) {
        ctx.fillStyle = css(tone(color, f.light * 0.6), 0.7);
        ctx.beginPath();
        ctx.ellipse(x + pw / 2, -f.h * r(), 1, 1.8, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else {
    for (let y = 0; y > -f.h; y -= pw) {
      ctx.fillStyle = css(tone(color, f.light * (0.88 + r() * 0.22)));
      ctx.fillRect(0, y - pw, f.w, pw);
      ctx.strokeStyle = css(tone(color, f.light * 0.55), 0.8);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(f.w, y);
      ctx.stroke();
    }
  }
}

/** Timber frame: posts and a beam over plaster/planks. */
export function timber(ctx: Ctx, f: Face, color: number, every = 18) {
  ctx.fillStyle = css(tone(color, f.light));
  for (let x = 0; x <= f.w + 0.1; x += Math.max(10, f.w / Math.max(1, Math.round(f.w / every)))) {
    ctx.fillRect(Math.min(x, f.w - 3) - 1.5, -f.h, 3.5, f.h);
  }
  ctx.fillRect(0, -f.h, f.w, 3.5);
  ctx.fillRect(0, -3.5, f.w, 3.5);
  ctx.strokeStyle = css(tone(color, f.light * 0.55));
  ctx.lineWidth = 0.8;
  ctx.strokeRect(0, -f.h + 0.5, f.w, 3);
}

export function windowArch(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  glow = false,
  frame = 0x5a3b1e,
) {
  ctx.beginPath();
  ctx.moveTo(x - w / 2, y);
  ctx.lineTo(x - w / 2, y - h + w / 2);
  ctx.arc(x, y - h + w / 2, w / 2, Math.PI, 0);
  ctx.lineTo(x + w / 2, y);
  ctx.closePath();
  ctx.fillStyle = glow ? '#ffd76a' : '#2b1b10';
  ctx.fill();
  if (glow) {
    ctx.fillStyle = 'rgba(255,240,180,0.8)';
    ctx.fillRect(x - w / 2 + 1, y - h * 0.55, w - 2, 1.2);
  }
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = css(frame);
  ctx.stroke();
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y - h + 1);
  ctx.stroke();
}

export function door(ctx: Ctx, x: number, w: number, h: number, color = 0x7a4a22, band = 0x3a3a3a) {
  ctx.beginPath();
  ctx.moveTo(x - w / 2, 0);
  ctx.lineTo(x - w / 2, -h + w / 2);
  ctx.arc(x, -h + w / 2, w / 2, Math.PI, 0);
  ctx.lineTo(x + w / 2, 0);
  ctx.closePath();
  ctx.fillStyle = css(color);
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = css(tone(color, 0.6));
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(x - w / 2 + (w / 4) * i, 0);
    ctx.lineTo(x - w / 2 + (w / 4) * i, -h);
    ctx.stroke();
  }
  ctx.fillStyle = css(band);
  ctx.fillRect(x - w / 2, -h * 0.35, w, 1.8);
  ctx.fillRect(x - w / 2, -h * 0.75, w, 1.8);
  ctx.restore();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = INK;
  ctx.stroke();
}

// ---------- Texture assembly ----------

/**
 * Draws a sprite on its own canvas, then wraps it in a dark cartoon outline,
 * a soft ground shadow and an optional trampled-earth footprint underneath.
 */
export function makeTexture(
  scene: Phaser.Scene,
  key: string,
  w: number,
  h: number,
  draw: (ctx: Ctx) => void,
  under?: (ctx: Ctx) => void,
  outline = 1.6,
): string {
  scene.textures.addCanvas(key, paint(w, h, draw, under, outline));
  return key;
}

/** Draws art with its ink outline and optional underlay (shadows) onto a new canvas. */
export function paint(
  w: number,
  h: number,
  draw: (ctx: Ctx) => void,
  under?: (ctx: Ctx) => void,
  outline = 1.6,
): HTMLCanvasElement {
  const art = document.createElement('canvas');
  art.width = w;
  art.height = h;
  const actx = art.getContext('2d')!;
  actx.lineJoin = 'round';
  draw(actx);
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d')!;
  if (outline > 0) {
    const sil = document.createElement('canvas');
    sil.width = w;
    sil.height = h;
    const sctx = sil.getContext('2d')!;
    sctx.drawImage(art, 0, 0);
    sctx.globalCompositeOperation = 'source-in';
    sctx.fillStyle = INK;
    sctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      ctx.drawImage(sil, Math.cos(a) * outline, Math.sin(a) * outline);
    }
  }
  ctx.drawImage(art, 0, 0);
  if (under) {
    ctx.globalCompositeOperation = 'destination-over';
    under(ctx);
    ctx.globalCompositeOperation = 'source-over';
  }
  return out;
}

/** Soft elliptical shadow (no ctx.filter, which WebKit lacks). */
export function softShadow(ctx: Ctx, x: number, y: number, rx: number, ry: number, alpha = 0.32) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, ry / rx);
  const g = ctx.createRadialGradient(0, 0, rx * 0.2, 0, 0, rx);
  g.addColorStop(0, `rgba(15,25,5,${alpha})`);
  g.addColorStop(0.6, `rgba(15,25,5,${alpha * 0.6})`);
  g.addColorStop(1, 'rgba(15,25,5,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, rx, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Worn earth/grass patch under a footprint, faded at the edges. */
export function footprint(ctx: Ctx, iso: Iso, k: number, color = 0x7d8f45) {
  const d = iso.diamond(0, 0, k, k, 0),
    c = iso.p(0, 0),
    rx = (d[1]!.x - d[3]!.x) / 2;
  ctx.save();
  path(ctx, d);
  ctx.clip();
  ctx.translate(c.x, c.y);
  ctx.scale(1, 0.5);
  const g = ctx.createRadialGradient(0, 0, rx * 0.3, 0, 0, rx * 1.05);
  g.addColorStop(0, css(color, 0.75));
  g.addColorStop(0.75, css(color, 0.45));
  g.addColorStop(1, css(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(-rx * 1.2, -rx * 1.2, rx * 2.4, rx * 2.4);
  ctx.restore();
}
