// Renders the original Study Kingdom app icon (1024×1024 PNG) with no
// dependencies, for `tauri icon` to derive every platform size from.
//   node scripts/gen-icon.mjs apps/desktop/src-tauri/icons/source.png
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const N = 1024;
const SS = 3; // supersampling per axis
const out = process.argv[2] ?? 'icon.png';

const lerp = (a, b, t) => a + (b - a) * t;
const mix = (c1, c2, t) => c1.map((v, i) => lerp(v, c2[i], t));

function roundedRect(x, y, x0, y0, x1, y1, r) {
  const cx = Math.max(x0 + r, Math.min(x, x1 - r));
  const cy = Math.max(y0 + r, Math.min(y, y1 - r));
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r && x >= x0 && x <= x1 && y >= y0 && y <= y1;
}
const inPoly = (x, y, pts) => {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const rect = (x, y, x0, y0, x1, y1) => x >= x0 && x <= x1 && y >= y0 && y <= y1;

/** Returns RGBA for a point in 1024-space (macOS icon grid: 824px body inside 1024). */
function shade(x, y) {
  const M = 100;
  if (!roundedRect(x, y, M, M, N - M, N - M, 185)) return [0, 0, 0, 0];
  const t = (y - M) / (N - 2 * M);
  let c = mix([79, 160, 92], [33, 84, 44], t);
  // Soft hill
  if ((x - 512) ** 2 / 520 ** 2 + (y - 930) ** 2 / 260 ** 2 <= 1) c = mix([111, 182, 92], [70, 140, 70], t);
  const cream = [240, 228, 196];
  const stone = [214, 198, 160];
  const red = [196, 57, 43];
  const dark = [70, 46, 26];
  // Keep body and towers
  if (rect(x, y, 330, 470, 694, 770)) c = cream;
  if (rect(x, y, 270, 400, 380, 770) || rect(x, y, 644, 400, 754, 770)) c = stone;
  // Battlements
  for (let i = 0; i < 4; i++) {
    if (rect(x, y, 270 + i * 30, 370, 290 + i * 30, 400)) c = stone;
    if (rect(x, y, 644 + i * 30, 370, 664 + i * 30, 400)) c = stone;
  }
  // Roofs
  if (
    inPoly(x, y, [
      [310, 470],
      [512, 300],
      [714, 470],
    ])
  )
    c = red;
  if (
    inPoly(x, y, [
      [255, 400],
      [325, 300],
      [395, 400],
    ]) ||
    inPoly(x, y, [
      [629, 400],
      [699, 300],
      [769, 400],
    ])
  )
    c = mix(red, [0, 0, 0], 0.15);
  // Flag
  if (rect(x, y, 506, 170, 518, 305)) c = dark;
  if (
    inPoly(x, y, [
      [518, 172],
      [610, 200],
      [518, 228],
    ])
  )
    c = [242, 201, 76];
  // Gate (arched)
  if ((rect(x, y, 462, 640, 562, 770) || (x - 512) ** 2 + (y - 640) ** 2 <= 50 ** 2) && y >= 590) c = dark;
  // Windows
  for (const wx of [300, 674]) if (rect(x, y, wx + 10, 470, wx + 40, 520)) c = dark;
  // Open book at the base
  const book = [250, 247, 236];
  if (
    inPoly(x, y, [
      [300, 800],
      [512, 830],
      [512, 905],
      [300, 875],
    ]) ||
    inPoly(x, y, [
      [724, 800],
      [512, 830],
      [512, 905],
      [724, 875],
    ])
  )
    c = book;
  if (rect(x, y, 508, 828, 516, 905)) c = [180, 160, 120];
  return [...c, 255];
}

const px = Buffer.alloc(N * N * 4);
for (let y = 0; y < N; y++) {
  for (let x = 0; x < N; x++) {
    const acc = [0, 0, 0, 0];
    for (let sy = 0; sy < SS; sy++)
      for (let sx = 0; sx < SS; sx++) {
        const c = shade(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS);
        acc[0] += c[0] * c[3];
        acc[1] += c[1] * c[3];
        acc[2] += c[2] * c[3];
        acc[3] += c[3];
      }
    const i = (y * N + x) * 4;
    const a = acc[3] / (SS * SS);
    px[i] = acc[3] ? Math.round(acc[0] / acc[3]) : 0;
    px[i + 1] = acc[3] ? Math.round(acc[1] / acc[3]) : 0;
    px[i + 2] = acc[3] ? Math.round(acc[2] / acc[3]) : 0;
    px[i + 3] = Math.round(a);
  }
}

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
const raw = Buffer.alloc(N * (N * 4 + 1));
for (let y = 0; y < N; y++) px.copy(raw, y * (N * 4 + 1) + 1, y * N * 4, (y + 1) * N * 4);
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(N, 0);
ihdr.writeUInt32BE(N, 4);
ihdr[8] = 8;
ihdr[9] = 6;
writeFileSync(
  out,
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]),
);
console.log(`wrote ${out}`);
