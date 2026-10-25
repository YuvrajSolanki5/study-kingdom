/** 2:1 isometric projection. Tile (x, y) maps to screen space with (0, 0) at the map's top corner. */
export const TW = 64;
export const TH = 32;

export function isoX(x: number, y: number): number {
  return ((x - y) * TW) / 2;
}

export function isoY(x: number, y: number): number {
  return ((x + y) * TH) / 2;
}

/** Inverse projection: screen point to fractional tile coordinates. */
export function toTile(px: number, py: number): { x: number; y: number } {
  const a = px / (TW / 2);
  const b = py / (TH / 2);
  return { x: (a + b) / 2, y: (b - a) / 2 };
}

/** Depth key so nearer things draw on top. */
export function depthOf(x: number, y: number, size = 1): number {
  return (x + y + size) * 10;
}
