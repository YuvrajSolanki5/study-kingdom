import type { GameContent } from '@sk/content';
import { fail } from './errors.ts';
import type { VillageBuilding } from './state.ts';

export function footprint(content: GameContent, defId: string): number {
  const def = content.structures[defId];
  if (!def) fail('invalid', `Unknown building ${defId}`);
  return def.size;
}

export function inBuildArea(content: GameContent, defId: string, x: number, y: number): boolean {
  const size = footprint(content, defId);
  const { buildMin, buildMax } = content.map;
  return (
    Number.isInteger(x) &&
    Number.isInteger(y) &&
    x >= buildMin &&
    y >= buildMin &&
    x + size <= buildMax &&
    y + size <= buildMax
  );
}

/** Occupancy grid of building ids (or -1) for all buildings except `skip`. */
export function occupancy(
  content: GameContent,
  buildings: VillageBuilding[],
  skip?: Set<number>,
): Int32Array {
  const n = content.map.size;
  const occ = new Int32Array(n * n).fill(-1);
  for (const b of buildings) {
    if (skip?.has(b.id)) continue;
    const size = footprint(content, b.defId);
    for (let dy = 0; dy < size; dy++)
      for (let dx = 0; dx < size; dx++) {
        const x = b.x + dx;
        const y = b.y + dy;
        if (x >= 0 && y >= 0 && x < n && y < n) occ[y * n + x] = b.id;
      }
  }
  return occ;
}

export function areaFree(
  content: GameContent,
  occ: Int32Array,
  defId: string,
  x: number,
  y: number,
): boolean {
  if (!inBuildArea(content, defId, x, y)) return false;
  const n = content.map.size;
  const size = footprint(content, defId);
  for (let dy = 0; dy < size; dy++)
    for (let dx = 0; dx < size; dx++) if (occ[(y + dy) * n + x + dx] !== -1) return false;
  return true;
}

export function markArea(
  content: GameContent,
  occ: Int32Array,
  id: number,
  defId: string,
  x: number,
  y: number,
) {
  const n = content.map.size;
  const size = footprint(content, defId);
  for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) occ[(y + dy) * n + x + dx] = id;
}

/** Throws unless every building is inside the build area and none overlap. */
export function assertValidLayout(content: GameContent, buildings: VillageBuilding[]) {
  const n = content.map.size;
  const occ = new Int32Array(n * n).fill(-1);
  for (const b of buildings) {
    if (!areaFree(content, occ, b.defId, b.x, b.y))
      fail('blocked', `Building ${b.id} overlaps or is out of bounds`);
    markArea(content, occ, b.id, b.defId, b.x, b.y);
  }
}
