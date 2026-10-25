import type { BuildingInfo } from './stats.ts';
import { MT } from './types.ts';

export const PATH_NORMAL = 0;
export const PATH_JUMP = 1;
export const PATH_SIEGE = 2;

const STEP = 10;
const DIAG = 14;
/** Extra cost of entering an intact wall tile, by path mode. */
const WALL_COST = [60, 2, 4];
/** Extra cost of entering a building that is not the target (it must be broken through). */
const BUILDING_COST = 250;
const INF = 0x3fffffff;

// Neighbour order is fixed so ties always resolve the same way.
const DX = [0, 1, 0, -1, 1, 1, -1, -1];
const DY = [-1, 0, 1, 0, -1, 1, 1, -1];

/**
 * Tile occupancy plus memoised distance fields. Fields are a pure function of
 * (target, mode, occupancy), so they can be dropped at any time — e.g. when a
 * battle resumes from a checkpoint — without changing the outcome.
 */
export class Grid {
  readonly n: number;
  /** Building index occupying each tile (intact, non-trap), or -1. */
  readonly occ: Int32Array;
  readonly isWall: Uint8Array;
  private fields = new Map<number, Int32Array>();
  private fieldVersion = -1;
  private heap: Float64Array;
  private settled: Uint8Array;
  /** Number of tiles settled across all field computations (cost accounting). */
  work = 0;

  constructor(n: number, infos: BuildingInfo[], dead: (i: number) => boolean) {
    this.n = n;
    this.occ = new Int32Array(n * n).fill(-1);
    this.isWall = new Uint8Array(infos.length);
    this.heap = new Float64Array(n * n * 8 + 16);
    this.settled = new Uint8Array(n * n);
    for (const b of infos) {
      this.isWall[b.index] = b.isWall ? 1 : 0;
      if (b.isTrap || dead(b.index)) continue;
      for (let dy = 0; dy < b.size; dy++)
        for (let dx = 0; dx < b.size; dx++) this.occ[(b.y + dy) * n + b.x + dx] = b.index;
    }
  }

  remove(b: BuildingInfo) {
    const n = this.n;
    for (let dy = 0; dy < b.size; dy++)
      for (let dx = 0; dx < b.size; dx++) {
        const t = (b.y + dy) * n + b.x + dx;
        if (this.occ[t] === b.index) this.occ[t] = -1;
      }
  }

  tileOf(x: number, y: number): number {
    const n = this.n;
    let tx = Math.floor(x / MT);
    let ty = Math.floor(y / MT);
    if (tx < 0) tx = 0;
    else if (tx >= n) tx = n - 1;
    if (ty < 0) ty = 0;
    else if (ty >= n) ty = n - 1;
    return ty * n + tx;
  }

  private enterCost(tile: number, target: number, mode: number): number {
    const o = this.occ[tile];
    if (o < 0 || o === target) return 0;
    return this.isWall[o] ? WALL_COST[mode] : BUILDING_COST;
  }

  /** Whether a step from tile a to neighbour b cuts a blocked corner. */
  private cutsCorner(ax: number, ay: number, dir: number, target: number): boolean {
    if (dir < 4) return false;
    const n = this.n;
    const o1 = this.occ[ay * n + ax + DX[dir]];
    const o2 = this.occ[(ay + DY[dir]) * n + ax];
    return (o1 >= 0 && o1 !== target) || (o2 >= 0 && o2 !== target);
  }

  field(target: BuildingInfo, mode: number, version: number): Int32Array {
    if (version !== this.fieldVersion) {
      this.fields.clear();
      this.fieldVersion = version;
    }
    const key = target.index * 4 + mode;
    const cached = this.fields.get(key);
    if (cached) return cached;
    const f = this.compute(target, mode);
    this.fields.set(key, f);
    return f;
  }

  private compute(target: BuildingInfo, mode: number): Int32Array {
    const n = this.n;
    const dist = new Int32Array(n * n).fill(INF);
    const settled = this.settled;
    settled.fill(0);
    const heap = this.heap;
    let size = 0;
    const push = (key: number) => {
      let i = size++;
      heap[i] = key;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heap[p] <= key) break;
        heap[i] = heap[p];
        heap[p] = key;
        i = p;
      }
    };
    const pop = (): number => {
      const top = heap[0];
      const last = heap[--size];
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= size) break;
        const r = l + 1;
        const c = r < size && heap[r] < heap[l] ? r : l;
        if (heap[c] >= last) break;
        heap[i] = heap[c];
        i = c;
      }
      heap[i] = last;
      return top;
    };
    const SHIFT = 4096;
    for (let dy = 0; dy < target.size; dy++)
      for (let dx = 0; dx < target.size; dx++) {
        const t = (target.y + dy) * n + target.x + dx;
        dist[t] = 0;
        push(t);
      }
    const tIdx = target.index;
    while (size > 0) {
      const key = pop();
      const b = key % SHIFT;
      if (settled[b]) continue;
      settled[b] = 1;
      this.work++;
      const db = dist[b];
      const bx = b % n;
      const by = (b - bx) / n;
      const enter = this.enterCost(b, tIdx, mode);
      for (let dir = 0; dir < 8; dir++) {
        const ax = bx - DX[dir];
        const ay = by - DY[dir];
        if (ax < 0 || ay < 0 || ax >= n || ay >= n) continue;
        const a = ay * n + ax;
        if (settled[a]) continue;
        if (this.cutsCorner(ax, ay, dir, tIdx)) continue;
        const nd = db + (dir < 4 ? STEP : DIAG) + enter;
        if (nd < dist[a]) {
          dist[a] = nd;
          push(nd * SHIFT + a);
        }
      }
    }
    return dist;
  }

  /**
   * Shortest path from `from` toward the target's footprint, as tile indices,
   * excluding the start tile and the target's own tiles.
   */
  path(field: Int32Array, from: number, target: BuildingInfo, mode: number): number[] {
    const n = this.n;
    const out: number[] = [];
    let cur = from;
    for (let guard = 0; guard < n * n; guard++) {
      if (field[cur] === 0) break;
      const cx = cur % n;
      const cy = (cur - cx) / n;
      let best = -1;
      let bestCost = INF;
      for (let dir = 0; dir < 8; dir++) {
        const x = cx + DX[dir];
        const y = cy + DY[dir];
        if (x < 0 || y < 0 || x >= n || y >= n) continue;
        if (this.cutsCorner(cx, cy, dir, target.index)) continue;
        const nb = y * n + x;
        const c = field[nb] + (dir < 4 ? STEP : DIAG) + this.enterCost(nb, target.index, mode);
        if (c < bestCost) {
          bestCost = c;
          best = nb;
        }
      }
      if (best < 0 || field[best] === 0) break;
      out.push(best);
      cur = best;
    }
    return out;
  }
}
