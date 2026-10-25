// Turns the fan-kit-derived sprites in assets/sprite-source (made by
// build-sprites.mjs, docs/licensing.md) into Study Kingdom's own look: a
// painterly flattening of the 3D renders, a soft cel-shaded warm grade, our
// own colour schemes for roofs, robes and trims, and the same dark ink outline
// as the procedural art. Buildings are also scaled to sit inside their
// footprint. Writes apps/client/public/sprites and
// apps/client/src/game/sprite-index.json. Needs no NAS: the source is committed.
//
//   npm run assets:stylize
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import sharp from 'sharp';

const ROOT = join(import.meta.dirname, '../..');
const SRC = join(ROOT, 'assets/sprite-source');
const OUT = join(ROOT, 'apps/client/public/sprites');
const INDEX = join(ROOT, 'apps/client/src/game/sprite-index.json');
const source = JSON.parse(readFileSync(join(SRC, 'index.json'), 'utf8'));
/** Matches procedural art's INK (apps/client/src/game/art/canvas.ts). */
const INK = [42, 26, 14];

// Size of each building relative to the source sprite, so the art leaves a
// margin of ground inside its footprint instead of spilling onto neighbours.
const SCALE = {
  headquarters: 0.84,
  treasury: 0.86,
  barracks: 0.84,
  army_camp: 0.9,
  research_library: 0.86,
  clan_hall: 0.86,
  workshop: 0.84,
  builder_lodge: 0.84,
  bolt_thrower: 0.92,
  watchtower: 0.9,
  catapult: 0.9,
  skyspear: 0.86,
  arcane_spire: 0.9,
  storm_totem: 0.88,
  repeater: 0.86,
  ember_tower: 0.82,
};
// Walls and traps keep the procedural art: those sprites cannot join into
// runs, and the bombs and balloons read as props rather than hidden traps.
const PROCEDURAL = new Set(['wall', 'blast_mine', 'spring_snare', 'sky_mine', 'seeker_mine']);

// Recolours: pixels whose hue lies in `band` (degrees, may wrap past 360)
// and that are at least `s` saturated and within the `l` lightness range are
// rotated by `shift` degrees, with saturation scaled by `sat`. Ids are shared
// by sprites and their portraits.
const SCHEMES = {
  // Buildings: slate-blue scholarly roofs, green barracks, teal arcane glow.
  headquarters: [
    { band: [22, 58], s: 0.5, l: [0.38, 1], shift: 172, sat: 0.62 },
    { band: [345, 12], s: 0.45, shift: 215, sat: 0.7 },
  ],
  barracks: [{ band: [340, 18], s: 0.35, shift: 130, sat: 0.6 }],
  workshop: [{ band: [340, 18], s: 0.35, shift: 205, sat: 0.7 }],
  clan_hall: [{ band: [340, 18], s: 0.35, shift: 215 }],
  research_library: [{ band: [270, 320], s: 0.25, shift: -105 }],
  arcane_spire: [{ band: [265, 320], s: 0.2, shift: -100 }],
  repeater: [{ band: [260, 320], s: 0.25, shift: 120 }],
  skyspear: [{ band: [340, 20], s: 0.35, shift: 200 }],
  treasury: [{ band: [195, 235], s: 0.2, shift: -60 }],
  watchtower: [{ band: [90, 150], s: 0.25, shift: -110 }],
  // Troops and heroes: new hair, robes and skins so none matches the kit.
  swordsman: [{ band: [36, 58], s: 0.45, l: [0.42, 1], shift: -28 }],
  archer: [
    { band: [300, 350], s: 0.3, shift: 75 },
    { band: [70, 140], s: 0.25, shift: 115 },
  ],
  bulwark: [{ band: [12, 34], s: 0.6, l: [0, 0.48], shift: -40 }],
  looter: [{ band: [60, 120], s: 0.25, shift: 115 }],
  wyvern: [{ band: [185, 245], s: 0.2, shift: -95 }],
  mage: [{ band: [195, 250], s: 0.2, shift: 145 }],
  skyship: [{ band: [340, 25], s: 0.3, shift: 205 }],
  vaulter: [{ band: [330, 359], s: 0.2, l: [0.55, 1], shift: 40 }],
  drake: [{ band: [235, 300], s: 0.2, shift: 110 }],
  mender: [{ band: [38, 62], s: 0.4, shift: 125 }],
  necromancer: [{ band: [255, 320], s: 0.15, shift: -150 }],
  warlord: [{ band: [345, 15], s: 0.4, shift: 220 }],
  sage: [{ band: [255, 315], s: 0.2, shift: -130 }],
  battering_ram: [{ band: [345, 22], s: 0.3, shift: 195 }],
  sapper: [{ band: [15, 45], s: 0.45, shift: 170 }],
  // Spells: each vial gets a colour that matches its name.
  thunder: [{ band: [170, 250], s: 0.2, shift: -150 }],
  fury: [{ band: [250, 320], s: 0.2, shift: 75 }],
  mending: [{ band: [30, 65], s: 0.25, shift: 80 }],
  leap: [{ band: [60, 140], s: 0.2, shift: -60 }],
  aegis: [{ band: [130, 200], s: 0.15, shift: 110 }],
  clan: [{ band: [0, 45], s: 0.3, shift: 160 }],
};
// Square button crops keep their frame and lettering: no outline or painting.
const NO_OUTLINE = new Set(['social', 'sword']);

// --- colour helpers --------------------------------------------------------

function rgbToHsl(r, g, b) {
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToRgb(h, s, l) {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    t = ((t % 1) + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const k = h / 360;
  return [f(k + 1 / 3), f(k), f(k - 1 / 3)];
}

const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** 1 inside the hue band, fading to 0 over 10 degrees outside it. */
function inBand(h, [a, b]) {
  const width = (b - a + 360) % 360;
  const off = (h - a + 360) % 360;
  if (off <= width) return 1;
  const past = Math.min(off - width, 360 - off);
  return 1 - smooth(0, 10, past);
}

// --- filters ---------------------------------------------------------------

/**
 * Alpha-weighted Kuwahara filter: each pixel takes the mean colour of the
 * least varied of its four neighbouring quadrants. It keeps edges and turns
 * render noise and fine texture into flat painted strokes.
 */
function kuwahara({ data, w, h }, r) {
  const W = w + 1;
  const sat = Array.from({ length: 6 }, () => new Float64Array(W * (h + 1)));
  const [sR, sG, sB, sL, sLL, sA] = sat;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const a = data[i + 3] / 255;
      const R = data[i] * a,
        G = data[i + 1] * a,
        B = data[i + 2] * a;
      const L = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
      const vals = [R, G, B, L * a, L * L * a, a];
      const o = (y + 1) * W + x + 1;
      for (let c = 0; c < 6; c++) sat[c][o] = vals[c] + sat[c][o - 1] + sat[c][o - W] - sat[c][o - W - 1];
    }
  }
  const box = (s, x0, y0, x1, y1) => s[y1 * W + x1] - s[y0 * W + x1] - s[y1 * W + x0] + s[y0 * W + x0];
  const out = Buffer.from(data);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (data[i + 3] < 8) continue;
      let best = Infinity,
        bw = 0,
        bq = null;
      for (const [qx, qy] of [
        [x - r, y - r],
        [x, y - r],
        [x - r, y],
        [x, y],
      ]) {
        const x0 = Math.max(0, qx),
          y0 = Math.max(0, qy);
        const x1 = Math.min(w, qx + r + 1),
          y1 = Math.min(h, qy + r + 1);
        const wsum = box(sA, x0, y0, x1, y1);
        if (wsum < 1) continue;
        const m = box(sL, x0, y0, x1, y1) / wsum;
        const v = box(sLL, x0, y0, x1, y1) / wsum - m * m;
        if (v < best) {
          best = v;
          bw = wsum;
          bq = [x0, y0, x1, y1];
        }
      }
      if (!bq) continue;
      out[i] = box(sR, ...bq) / bw;
      out[i + 1] = box(sG, ...bq) / bw;
      out[i + 2] = box(sB, ...bq) / bw;
    }
  }
  return { data: out, w, h };
}

/** Recolour, soft cel bands, a little more saturation and a warm grade. */
function grade({ data, w, h }, scheme = []) {
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    let [hh, s, l] = rgbToHsl(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255);
    for (const rule of scheme) {
      const [l0, l1] = rule.l ?? [0, 1];
      const k =
        inBand(hh, rule.band) *
        smooth(rule.s - 0.08, rule.s + 0.04, s) *
        smooth(l0 - 0.06, l0 + 0.02, l) *
        (1 - smooth(l1 - 0.02, l1 + 0.06, l));
      if (k <= 0) continue;
      // Blend toward the fully rotated colour rather than rotating part way,
      // which would paint band edges in the hues in between.
      const from = hslToRgb(hh, s, l);
      const to = hslToRgb((hh + rule.shift + 360) % 360, s * (rule.sat ?? 1), l);
      [hh, s, l] = rgbToHsl(...from.map((c, j) => c + (to[j] - c) * k));
      break;
    }
    // Partly posterise to five light bands: flatter, cartoon shading.
    const bands = 5;
    const lq = (Math.floor(l * bands) + 0.5) / bands;
    l = l + (lq - l) * 0.35;
    s = Math.min(1, s * 1.12 + 0.03);
    let [r, g, b] = hslToRgb(hh, s, l);
    // Shadows lean warm brown, highlights lean parchment cream.
    const sh = (1 - l) * 0.14,
      hi = smooth(0.6, 1, l) * 0.1;
    r = r * (1 - sh) + 0.36 * sh;
    g = g * (1 - sh) + 0.22 * sh;
    b = b * (1 - sh) + 0.16 * sh;
    r = r * (1 - hi) + 1 * hi;
    g = g * (1 - hi) + 0.96 * hi;
    b = b * (1 - hi) + 0.84 * hi;
    data[i] = Math.round(r * 255);
    data[i + 1] = Math.round(g * 255);
    data[i + 2] = Math.round(b * 255);
  }
  return { data, w, h };
}

/** Anti-aliased ink outline `px` wide around the solid silhouette, drawn underneath. */
function outline({ data, w, h }, px) {
  const solid = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) solid[i] = data[i * 4 + 3] >= 128 ? 1 : 0;
  const R = Math.ceil(px) + 1;
  const out = Buffer.from(data);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (solid[p]) continue;
      let d2 = Infinity;
      for (let dy = -R; dy <= R; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -R; dx <= R; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w || !solid[yy * w + xx]) continue;
          d2 = Math.min(d2, dx * dx + dy * dy);
        }
      }
      if (d2 === Infinity) continue;
      const cover = Math.min(1, Math.max(0, px + 0.5 - Math.sqrt(d2)));
      if (cover <= 0) continue;
      const i = p * 4;
      const a = data[i + 3] / 255;
      // Source pixel (soft shadow or edge) over the ink.
      const ia = cover * (1 - a);
      const oa = a + ia;
      for (let c = 0; c < 3; c++) out[i + c] = Math.round((data[i + c] * a + INK[c] * ia) / oa);
      out[i + 3] = Math.round(oa * 255);
    }
  }
  return { data: out, w, h };
}

// --- pipeline --------------------------------------------------------------

async function load(file, { scale = 1, pad = 0 } = {}) {
  let img = sharp(join(SRC, 'sprites', file));
  if (scale !== 1) {
    const { width } = await img.metadata();
    img = sharp(await img.resize({ width: Math.round(width * scale), kernel: 'lanczos3' }).toBuffer());
  }
  if (pad)
    img = img.extend({
      top: pad,
      bottom: pad,
      left: pad,
      right: pad,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    });
  const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

async function stylize(file, opts) {
  const { radius, ink, scheme, scale } = opts;
  const pad = ink ? Math.ceil(ink) + 1 : 0;
  let img = await load(file, { scale, pad });
  if (radius) img = kuwahara(img, radius);
  img = grade(img, scheme);
  if (ink) img = outline(img, ink);
  const { data, info } = await sharp(img.data, { raw: { width: img.w, height: img.h, channels: 4 } })
    .webp({ quality: 88, alphaQuality: 95, effort: 5 })
    .toBuffer({ resolveWithObject: true });
  mkdirSync(dirname(join(OUT, file)), { recursive: true });
  writeFileSync(join(OUT, file), data);
  return { w: info.width, h: info.height, pad };
}

async function main() {
  rmSync(OUT, { recursive: true, force: true });
  const index = { res: source.res, buildings: {}, units: {}, scenery: {}, ui: {} };
  for (const [id, levels] of Object.entries(source.buildings)) {
    if (PROCEDURAL.has(id)) continue;
    index.buildings[id] = [];
    for (const e of levels) {
      if (!e) {
        index.buildings[id].push(null);
        continue;
      }
      const s = await stylize(e.file, { radius: 3, ink: 3, scheme: SCHEMES[id], scale: SCALE[id] ?? 0.86 });
      // Padding below the art moves the anchor down; keep the art's base where it was.
      index.buildings[id].push({ file: e.file, w: s.w, h: s.h, dy: e.dy + s.pad / s.h });
    }
  }
  for (const [id, e] of Object.entries(source.units)) {
    // Small art: a light touch keeps faces readable.
    const s = await stylize(e.file, { radius: 1, ink: 3, scheme: SCHEMES[id] });
    index.units[id] = { file: e.file, w: s.w, h: s.h, left: e.left, flying: e.flying, pad: s.pad };
  }
  for (const [id, e] of Object.entries(source.scenery)) {
    // Scenery is drawn into the ground at 1×, so a thinner outline.
    const s = await stylize(e.file, { radius: 2, ink: 1.5 });
    index.scenery[id] = { file: e.file, w: s.w, h: s.h };
  }
  for (const [id, file] of Object.entries(source.ui)) {
    const flat = NO_OUTLINE.has(id);
    await stylize(file, { radius: flat ? 0 : 1, ink: flat ? 0 : 3, scheme: SCHEMES[id] });
    index.ui[id] = file;
  }
  writeFileSync(INDEX, JSON.stringify(index, null, 1) + '\n');
  const n = Object.values(index.buildings).flat().filter(Boolean).length;
  console.log(
    `stylized ${n} buildings, ${Object.keys(index.units).length} units, ${Object.keys(index.ui).length} icons`,
  );
}

await main();
