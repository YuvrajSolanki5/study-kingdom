import type { GameContent } from '@sk/content';
import { getContent } from '@sk/content';
import { Grid, PATH_JUMP, PATH_NORMAL, PATH_SIEGE } from './grid.ts';
import { buildingInfo, mt, ticks, unitStats, type BuildingInfo, type UnitStats } from './stats.ts';
import {
  MT,
  Pref,
  TargetKind,
  Team,
  TPS,
  type ActiveSpell,
  type ArmySlot,
  type BattleSetup,
  type BuildingState,
  type Command,
  type PendingHit,
  type SimEvent,
  type SimState,
  type UnitState,
} from './types.ts';

/** Extra reach toward building footprints, so melee units can hit from the adjacent tile. */
const BUILDING_REACH = 600;
/** Extra reach toward units. */
const UNIT_REACH = 300;
/** Attackers that prefer any target engage defending units within this distance. */
const DISTRACT_RANGE = 4 * MT;
const DISTRACT_CHECK_TICKS = 5;
const CELL = 4 * MT;
/** Spell zone effects refresh with this lifetime each tick a unit is inside. */
const ZONE_TICKS = 3;
const FURY_SPEED_PCT = 125;
const SPELL_PULSE_TICKS = 5;
const THUNDER_STRIKES = 3;
const SUMMON_OFFSETS = [
  [600, 0],
  [-600, 0],
  [0, 600],
  [0, -600],
  [450, 450],
  [-450, -450],
];

export interface Runtime {
  content: GameContent;
  setup: BattleSetup;
  state: SimState;
  infos: BuildingInfo[];
  stats: Map<string, UnitStats>;
  grid: Grid;
  noDeploy: Uint8Array;
  n: number;
  totalCounted: number;
  durationTicks: number;
  hqIndex: number;
  clanHallIndex: number;
  /** Defences (targets for defence-preferring troops). */
  defenseIdx: number[];
  /** Defences that can fire (not under upgrade). */
  firingIdx: number[];
  trapIdx: number[];
  targetable: number[];
  wallIdx: number[];
  events: SimEvent[];
  // Spatial buckets for attacker units, rebuilt every tick.
  cells: number;
  head: Int32Array;
  next: Int32Array;
  /** Units processed so far: a deterministic cost measure for budgeting. */
  unitWork: number;
  /** Ids of defending units (clan reinforcements), derived from state. */
  defenderIds: number[];
}

const LEVEL_KEY = (id: string, level: number) => `${id}:${level}`;

function dist2(ax: number, ay: number, bx: number, by: number) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

/** Squared distance from a point to a building footprint. */
function rectDist2(b: BuildingInfo, x: number, y: number) {
  const dx = x < b.x0 ? b.x0 - x : x > b.x1 ? x - b.x1 : 0;
  const dy = y < b.y0 ? b.y0 - y : y > b.y1 ? y - b.y1 : 0;
  return dx * dx + dy * dy;
}

function closestPoint(b: BuildingInfo, x: number, y: number): [number, number] {
  return [x < b.x0 ? b.x0 : x > b.x1 ? b.x1 : x, y < b.y0 ? b.y0 : y > b.y1 ? b.y1 : y];
}

export function isqrt(v: number): number {
  return v <= 0 ? 0 : Math.floor(Math.sqrt(v));
}

export function createRuntime(setup: BattleSetup, restored?: SimState): Runtime {
  const content = getContent(setup.contentVersion);
  const n = content.map.size;
  const infos = setup.defender.buildings.map((b, i) => buildingInfo(content, i, b));
  const state: SimState =
    restored ??
    ({
      tick: 0,
      rng: setup.seed >>> 0 || 1,
      ended: false,
      endReason: '',
      buildings: infos.map((b): BuildingState => ({
        hp: b.maxHp,
        dead: false,
        cd: 0,
        tgt: -1,
        ramp: 0,
        revealed: !(b.defense && b.defense.hiddenTrigger > 0),
        frozen: 0,
        trap: 0,
        fireTick: 0,
      })),
      units: [],
      hits: [],
      spells: [],
      remaining: {
        troops: countSlots(setup.attacker.troops),
        spells: countSlots(setup.attacker.spells),
        heroes: Object.fromEntries(setup.attacker.heroes.map((h) => [h.id, 1])),
        siege: countSlots(setup.attacker.siege),
        reinforcements: setup.attacker.reinforcements.some((r) => r.count > 0),
      },
      gridVersion: 0,
      destroyed: 0,
      hqDestroyed: false,
      clanReleased: false,
      starTicks: [-1, -1, -1],
      cmdIndex: 0,
    } satisfies SimState);

  const grid = new Grid(n, infos, (i) => state.buildings[i].dead);
  const margin = content.economy.battle.noDeployMargin;
  const noDeploy = new Uint8Array(n * n);
  for (const b of infos) {
    if (b.isTrap) continue;
    for (let y = b.y - margin; y < b.y + b.size + margin; y++)
      for (let x = b.x - margin; x < b.x + b.size + margin; x++)
        if (x >= 0 && y >= 0 && x < n && y < n) noDeploy[y * n + x] = 1;
  }
  const cells = Math.ceil((n * MT) / CELL);
  const rt: Runtime = {
    content,
    setup,
    state,
    infos,
    stats: new Map(),
    grid,
    noDeploy,
    n,
    totalCounted: infos.filter((b) => b.counts).length,
    durationTicks: content.economy.battle.durationSeconds * TPS,
    hqIndex: infos.findIndex((b) => b.isHq),
    clanHallIndex: infos.findIndex((b) => b.isClanHall),
    defenseIdx: infos.filter((b) => b.isDefense).map((b) => b.index),
    firingIdx: infos.filter((b) => b.defense && !b.off).map((b) => b.index),
    trapIdx: infos.filter((b) => b.trap).map((b) => b.index),
    targetable: infos.filter((b) => b.counts).map((b) => b.index),
    wallIdx: infos.filter((b) => b.isWall).map((b) => b.index),
    events: [],
    cells,
    head: new Int32Array(cells * cells),
    next: new Int32Array(64),
    unitWork: 0,
    defenderIds: state.units.filter((u) => u.team === Team.Defender).map((u) => u.id),
  };
  // Pre-resolve every stats entry the battle can need so lookups never fail mid-battle.
  const a = setup.attacker;
  for (const s of [...a.troops, ...a.siege, ...a.reinforcements, ...setup.defender.reinforcements])
    statsFor(rt, s.id, s.level);
  for (const h of a.heroes) statsFor(rt, h.id, h.level);
  return rt;
}

function countSlots(slots: ArmySlot[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of slots) out[s.id] = (out[s.id] ?? 0) + s.count;
  return out;
}

function statsFor(rt: Runtime, id: string, level: number): UnitStats {
  const key = LEVEL_KEY(id, level);
  let s = rt.stats.get(key);
  if (!s) {
    s = unitStats(rt.content, id, level);
    rt.stats.set(key, s);
    if (s.summon) {
      const [sid, sl] = s.summon.key.split(':');
      statsFor(rt, sid, Number(sl));
    }
  }
  return s;
}

function rand(rt: Runtime): number {
  const s = rt.state;
  let t = (s.rng = (s.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (t ^ (t >>> 14)) >>> 0;
}

function spawnUnit(rt: Runtime, key: string, team: Team, x: number, y: number, hpPercent = 100): UnitState {
  const s = rt.stats.get(key);
  if (!s) throw new Error(`missing stats ${key}`);
  const maxHp = s.hp;
  const max = rt.n * MT - 1;
  const u: UnitState = {
    id: rt.state.units.length,
    key,
    team,
    x: Math.min(Math.max(x, 0), max),
    y: Math.min(Math.max(y, 0), max),
    hp: Math.max(1, Math.floor((maxHp * hpPercent) / 100)),
    maxHp,
    dead: false,
    sprung: false,
    cd: 0,
    tk: TargetKind.None,
    tg: -1,
    path: [],
    pi: 0,
    ob: -1,
    rage: 0,
    ragePct: 0,
    aegis: 0,
    aegisPct: 0,
    frozen: 0,
    leap: 0,
    inv: 0,
    summonCd: s.summon ? s.summon.everyTicks : 0,
    owner: -1,
    ability: 0,
    abilityTicks: 0,
    carried: null,
    idle: 0,
  };
  rt.state.units.push(u);
  if (team === Team.Defender) rt.defenderIds.push(u.id);
  rt.events.push({ e: 'spawn', u: u.id });
  return u;
}

function applyCommand(rt: Runtime, c: Command) {
  const st = rt.state;
  const rem = st.remaining;
  switch (c.k) {
    case 'troop': {
      if (!(rem.troops[c.id] > 0) || !canDeploy(rt, c.x, c.y)) return;
      const slot = rt.setup.attacker.troops.find((t) => t.id === c.id);
      if (!slot) return;
      rem.troops[c.id]--;
      spawnUnit(rt, LEVEL_KEY(c.id, slot.level), Team.Attacker, c.x, c.y);
      return;
    }
    case 'hero': {
      if (!(rem.heroes[c.id] > 0) || !canDeploy(rt, c.x, c.y)) return;
      const slot = rt.setup.attacker.heroes.find((h) => h.id === c.id);
      if (!slot) return;
      rem.heroes[c.id] = 0;
      spawnUnit(rt, LEVEL_KEY(c.id, slot.level), Team.Attacker, c.x, c.y, slot.hpPercent);
      return;
    }
    case 'ability': {
      const hero = st.units.find((u) => !u.dead && u.key.startsWith(`${c.id}:`) && u.team === Team.Attacker);
      if (!hero || hero.ability !== 0) return;
      activateAbility(rt, hero);
      return;
    }
    case 'siege': {
      if (!(rem.siege[c.id] > 0) || !canDeploy(rt, c.x, c.y)) return;
      const slot = rt.setup.attacker.siege.find((s) => s.id === c.id);
      if (!slot) return;
      rem.siege[c.id]--;
      const u = spawnUnit(rt, LEVEL_KEY(c.id, slot.level), Team.Attacker, c.x, c.y);
      if (rem.reinforcements) {
        u.carried = rt.setup.attacker.reinforcements.map((r) => ({ ...r }));
        rem.reinforcements = false;
      }
      return;
    }
    case 'reinforce': {
      if (!rem.reinforcements || !canDeploy(rt, c.x, c.y)) return;
      rem.reinforcements = false;
      releaseSlots(rt, rt.setup.attacker.reinforcements, Team.Attacker, c.x, c.y);
      return;
    }
    case 'spell': {
      if (!(rem.spells[c.id] > 0)) return;
      const slot = rt.setup.attacker.spells.find((s) => s.id === c.id);
      if (!slot) return;
      rem.spells[c.id]--;
      castSpell(rt, c.id, slot.level, c.x, c.y);
      return;
    }
    case 'end':
      endBattle(rt, 'surrender');
      return;
  }
}

export function canDeploy(rt: Runtime, x: number, y: number): boolean {
  const lim = rt.n * MT;
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= lim || y >= lim) return false;
  return rt.noDeploy[Math.floor(y / MT) * rt.n + Math.floor(x / MT)] === 0;
}

function releaseSlots(rt: Runtime, slots: ArmySlot[], team: Team, x: number, y: number) {
  let k = 0;
  for (const slot of slots) {
    for (let i = 0; i < slot.count; i++) {
      const [ox, oy] = SUMMON_OFFSETS[k++ % SUMMON_OFFSETS.length];
      spawnUnit(rt, LEVEL_KEY(slot.id, slot.level), team, x + ox, y + oy);
    }
  }
  rt.events.push({ e: 'release', x, y });
}

function castSpell(rt: Runtime, id: string, level: number, x: number, y: number) {
  const def = rt.content.spells[id];
  const lvl = def?.levels[level - 1];
  if (!def || !lvl) return;
  const now = rt.state.tick;
  const radius = mt(def.radius);
  const sp: ActiveSpell = {
    id,
    level,
    x,
    y,
    startTick: now,
    endTick: now + ticks(lvl.durationSeconds),
    strikes: [],
  };
  if (id === 'thunder') {
    const gap = Math.max(1, Math.floor(ticks(lvl.durationSeconds) / THUNDER_STRIKES));
    for (let i = 0; i < THUNDER_STRIKES; i++) {
      const r = Math.floor(radius / 3);
      const ox = r ? (rand(rt) % (2 * r + 1)) - r : 0;
      const oy = r ? (rand(rt) % (2 * r + 1)) - r : 0;
      sp.strikes.push({ x: x + ox, y: y + oy, tick: now + i * gap });
    }
  }
  if (id === 'frost') {
    const freeze = ticks(lvl.power);
    const r2 = radius * radius;
    for (const bi of rt.defenseIdx) {
      const bs = rt.state.buildings[bi];
      if (!bs.dead && rectDist2(rt.infos[bi], x, y) <= r2) bs.frozen = Math.max(bs.frozen, freeze);
    }
    for (const u of rt.state.units)
      if (!u.dead && u.team === Team.Defender && dist2(u.x, u.y, x, y) <= r2)
        u.frozen = Math.max(u.frozen, freeze);
  }
  rt.state.spells.push(sp);
  rt.events.push({ e: 'spell', id, x, y });
}

function activateAbility(rt: Runtime, hero: UnitState) {
  const s = rt.stats.get(hero.key)!;
  if (!s.hero) return;
  hero.ability = 1;
  hero.abilityTicks = s.hero.abilityTicks;
  if (s.defId === 'warlord') {
    hero.hp = Math.min(hero.maxHp, hero.hp + s.hero.abilityPower);
    const r2 = s.hero.abilityRadius * s.hero.abilityRadius;
    for (const u of rt.state.units) {
      if (u.dead || u.team !== Team.Attacker) continue;
      if (u === hero || dist2(u.x, u.y, hero.x, hero.y) <= r2) {
        u.rage = Math.max(u.rage, s.hero.abilityTicks);
        u.ragePct = Math.max(u.ragePct, u === hero ? 100 : 40);
      }
    }
  }
  rt.events.push({ e: 'ability', u: hero.id });
}

function endBattle(rt: Runtime, reason: SimState['endReason']) {
  if (rt.state.ended) return;
  rt.state.ended = true;
  rt.state.endReason = reason;
  rt.events.push({ e: 'end' });
}

function rebuildBuckets(rt: Runtime) {
  const units = rt.state.units;
  if (rt.next.length < units.length) rt.next = new Int32Array(units.length * 2);
  rt.head.fill(-1);
  const { cells, head, next } = rt;
  for (let i = units.length - 1; i >= 0; i--) {
    const u = units[i];
    if (u.dead || u.team !== Team.Attacker) continue;
    const c = Math.floor(u.y / CELL) * cells + Math.floor(u.x / CELL);
    next[i] = head[c];
    head[c] = i;
  }
}

/** Calls fn for every live attacker unit whose bucket overlaps the circle. Units are visited in id order per cell. */
function forAttackersNear(rt: Runtime, x: number, y: number, r: number, fn: (u: UnitState) => void) {
  const { cells, head, next } = rt;
  const units = rt.state.units;
  const cx0 = Math.max(0, Math.floor((x - r) / CELL));
  const cy0 = Math.max(0, Math.floor((y - r) / CELL));
  const cx1 = Math.min(cells - 1, Math.floor((x + r) / CELL));
  const cy1 = Math.min(cells - 1, Math.floor((y + r) / CELL));
  for (let cy = cy0; cy <= cy1; cy++)
    for (let cx = cx0; cx <= cx1; cx++) for (let i = head[cy * cells + cx]; i >= 0; i = next[i]) fn(units[i]);
}

function damageUnit(rt: Runtime, u: UnitState, amount: number) {
  if (u.dead || u.inv > 0 || amount <= 0) return;
  let dmg = amount;
  if (u.aegis > 0) dmg = Math.floor((dmg * (100 - u.aegisPct)) / 100);
  u.hp -= dmg;
  if (u.hp <= 0) killUnit(rt, u);
}

function killUnit(rt: Runtime, u: UnitState) {
  if (u.dead) return;
  u.dead = true;
  u.hp = 0;
  rt.events.push({ e: 'udie', u: u.id });
  const s = rt.stats.get(u.key)!;
  if (s.death && !u.sprung) {
    rt.state.hits.push({
      tick: rt.state.tick,
      src: 'u',
      srcId: u.id,
      tk: TargetKind.None,
      tg: -1,
      x: u.x,
      y: u.y,
      damage: s.death.damage,
      splash: s.death.splash,
      domain: 1,
      hitsBuildings: true,
      wallPct: 100,
    });
  }
  if (u.carried) {
    const carried = u.carried;
    u.carried = null;
    releaseSlots(rt, carried, Team.Attacker, u.x, u.y);
  }
}

function damageBuilding(rt: Runtime, bi: number, amount: number) {
  const bs = rt.state.buildings[bi];
  if (bs.dead || amount <= 0) return;
  const info = rt.infos[bi];
  if (info.isTrap) return;
  bs.hp -= amount;
  if (bs.hp > 0) return;
  bs.hp = 0;
  bs.dead = true;
  rt.grid.remove(info);
  rt.state.gridVersion++;
  rt.events.push({ e: 'bdie', b: bi });
  if (info.counts) rt.state.destroyed++;
  if (info.isHq) rt.state.hqDestroyed = true;
  if (info.isClanHall) releaseClan(rt);
}

function releaseClan(rt: Runtime) {
  if (rt.state.clanReleased || rt.clanHallIndex < 0) return;
  rt.state.clanReleased = true;
  const slots = rt.setup.defender.reinforcements;
  if (!slots.some((s) => s.count > 0)) return;
  const ch = rt.infos[rt.clanHallIndex];
  releaseSlots(rt, slots, Team.Defender, ch.cx, ch.cy);
}

function inReachOfBuilding(u: UnitState, s: UnitStats, b: BuildingInfo) {
  const r = s.range + BUILDING_REACH;
  return rectDist2(b, u.x, u.y) <= r * r;
}

function isTargetableBuilding(rt: Runtime, bi: number) {
  const bs = rt.state.buildings[bi];
  return !bs.dead && bs.revealed;
}

function pickBuilding(rt: Runtime, u: UnitState, s: UnitStats): number {
  const infos = rt.infos;
  let best = -1;
  let bestD = Infinity;
  const consider = (bi: number) => {
    if (!isTargetableBuilding(rt, bi)) return;
    const d = rectDist2(infos[bi], u.x, u.y);
    if (d < bestD) {
      bestD = d;
      best = bi;
    }
  };
  switch (s.pref) {
    case Pref.Defenses:
      for (const bi of rt.defenseIdx) consider(bi);
      break;
    case Pref.Resources:
      for (const bi of rt.targetable) if (infos[bi].isResource) consider(bi);
      break;
    case Pref.Walls:
      for (const bi of rt.wallIdx) consider(bi);
      break;
    case Pref.Hq:
      if (rt.hqIndex >= 0) consider(rt.hqIndex);
      break;
  }
  if (best < 0 && s.pref !== Pref.Hq) for (const bi of rt.targetable) consider(bi);
  return best;
}

function nearestEnemyUnit(rt: Runtime, u: UnitState, s: UnitStats, maxD: number): number {
  let best = -1;
  let bestD = maxD * maxD;
  const units = rt.state.units;
  const candidates = u.team === Team.Attacker ? rt.defenderIds : null;
  const len = candidates ? candidates.length : units.length;
  for (let i = 0; i < len; i++) {
    const o = units[candidates ? candidates[i] : i];
    if (o.dead || o.team === u.team) continue;
    const os = rt.stats.get(o.key)!;
    if (os.flying ? !s.hitsAir : !s.hitsGround) continue;
    const d = dist2(o.x, o.y, u.x, u.y);
    if (d < bestD) {
      bestD = d;
      best = o.id;
    }
  }
  return best;
}

function hasDefenderUnits(rt: Runtime) {
  const units = rt.state.units;
  for (const id of rt.defenderIds) if (!units[id].dead) return true;
  return false;
}

function pathMode(u: UnitState, s: UnitStats) {
  if (s.kind === 'siege') return PATH_SIEGE;
  if (s.wallJump || u.leap > 0) return PATH_JUMP;
  return PATH_NORMAL;
}

function retarget(rt: Runtime, u: UnitState, s: UnitStats) {
  u.tk = TargetKind.None;
  u.tg = -1;
  u.path = [];
  u.pi = 0;
  u.ob = -1;
  if (s.pref === Pref.Any && hasDefenderUnits(rt)) {
    const e = nearestEnemyUnit(rt, u, s, DISTRACT_RANGE);
    if (e >= 0) {
      u.tk = TargetKind.Unit;
      u.tg = e;
      return;
    }
  }
  const bi = pickBuilding(rt, u, s);
  if (bi < 0) return;
  u.tk = TargetKind.Building;
  u.tg = bi;
  if (!s.flying) {
    const info = rt.infos[bi];
    const mode = pathMode(u, s);
    const field = rt.grid.field(info, mode, rt.state.gridVersion);
    u.path = rt.grid.path(field, rt.grid.tileOf(u.x, u.y), info, mode);
  }
}

/** Moves toward (tx, ty); returns true on arrival. */
function moveToward(u: UnitState, speed: number, tx: number, ty: number): boolean {
  const dx = tx - u.x;
  const dy = ty - u.y;
  const d = isqrt(dx * dx + dy * dy);
  if (d <= speed) {
    u.x = tx;
    u.y = ty;
    return true;
  }
  u.x += Math.trunc((dx * speed) / d);
  u.y += Math.trunc((dy * speed) / d);
  return false;
}

function unitSpeed(u: UnitState, s: UnitStats) {
  return u.rage > 0 ? Math.floor((s.speed * FURY_SPEED_PCT) / 100) : s.speed;
}

function damageMultiplier(rt: Runtime, u: UnitState, sages: UnitState[]) {
  let pct = 100;
  if (u.rage > 0) pct += u.ragePct;
  let aura = 0;
  for (const sage of sages) {
    const ss = rt.stats.get(sage.key)!;
    if (!ss.hero || sage === u) continue;
    const r = ss.hero.auraRadius;
    if (dist2(sage.x, sage.y, u.x, u.y) <= r * r) aura = Math.max(aura, ss.hero.auraPct);
  }
  return pct + aura;
}

function attackBuilding(rt: Runtime, u: UnitState, s: UnitStats, bi: number, sages: UnitState[]) {
  if (u.cd > 0) return;
  u.cd = s.cdTicks;
  const info = rt.infos[bi];
  let dmg = Math.floor((s.damage * damageMultiplier(rt, u, sages)) / 100);
  const preferred =
    (s.pref === Pref.Resources && info.isResource) ||
    (s.pref === Pref.Walls && info.isWall) ||
    (s.pref === Pref.Defenses && info.isDefense);
  if (preferred && s.prefMult !== 100 && !s.splash) dmg = Math.floor((dmg * s.prefMult) / 100);
  const [px, py] = closestPoint(info, u.x, u.y);
  rt.state.hits.push({
    tick: rt.state.tick,
    src: 'u',
    srcId: u.id,
    tk: TargetKind.Building,
    tg: bi,
    x: px,
    y: py,
    damage: dmg,
    splash: s.splash,
    domain: 3,
    hitsBuildings: true,
    wallPct: s.pref === Pref.Walls ? s.prefMult : 100,
  });
  rt.events.push({ e: 'swing', u: u.id, tk: TargetKind.Building, tg: bi, x: px, y: py });
  if (s.suicide) killUnit(rt, u);
}

function attackUnit(rt: Runtime, u: UnitState, s: UnitStats, target: UnitState, sages: UnitState[]) {
  if (u.cd > 0) return;
  u.cd = s.cdTicks;
  const dmg = Math.floor((s.damage * damageMultiplier(rt, u, sages)) / 100);
  rt.state.hits.push({
    tick: rt.state.tick,
    src: 'u',
    srcId: u.id,
    tk: TargetKind.Unit,
    tg: target.id,
    x: target.x,
    y: target.y,
    damage: dmg,
    splash: s.splash,
    domain: s.hitsAir && s.hitsGround ? 3 : s.hitsAir ? 2 : 1,
    hitsBuildings: false,
    wallPct: 100,
  });
  rt.events.push({ e: 'swing', u: u.id, tk: TargetKind.Unit, tg: target.id, x: target.x, y: target.y });
  if (s.suicide) killUnit(rt, u);
}

function updateTimers(u: UnitState) {
  if (u.rage > 0 && --u.rage === 0) u.ragePct = 0;
  if (u.aegis > 0 && --u.aegis === 0) u.aegisPct = 0;
  if (u.leap > 0) u.leap--;
  if (u.inv > 0) u.inv--;
  if (u.cd > 0) u.cd--;
  if (u.ability === 1 && --u.abilityTicks <= 0) u.ability = 2;
}

function updateSummoner(rt: Runtime, u: UnitState, s: UnitStats) {
  if (!s.summon) return;
  if (--u.summonCd > 0) return;
  u.summonCd = s.summon.everyTicks;
  let alive = 0;
  for (const o of rt.state.units) if (!o.dead && o.owner === u.id) alive++;
  const count = Math.min(s.summon.count, s.summon.maxAlive - alive);
  for (let i = 0; i < count; i++) {
    const [ox, oy] = SUMMON_OFFSETS[i % SUMMON_OFFSETS.length];
    const m = spawnUnit(rt, s.summon.key, u.team, u.x + ox, u.y + oy);
    m.owner = u.id;
  }
}

function updateHealer(rt: Runtime, u: UnitState, s: UnitStats) {
  const r2 = s.healRadius * s.healRadius;
  let follow: UnitState | null = null;
  let followD = Infinity;
  let anyHurt = false;
  for (const o of rt.state.units) {
    if (o.dead || o.team !== u.team || o === u) continue;
    const os = rt.stats.get(o.key)!;
    if (os.flying || os.healRadius > 0) continue;
    const d = dist2(o.x, o.y, u.x, u.y);
    if (d < followD) {
      followD = d;
      follow = o;
    }
    if (d <= r2 && o.hp < o.maxHp) anyHurt = true;
  }
  if (anyHurt && u.cd === 0) {
    u.cd = s.cdTicks;
    for (const o of rt.state.units) {
      if (o.dead || o.team !== u.team || o === u) continue;
      const os = rt.stats.get(o.key)!;
      if (os.flying) continue;
      if (dist2(o.x, o.y, u.x, u.y) <= r2) o.hp = Math.min(o.maxHp, o.hp + s.damage);
    }
    rt.events.push({ e: 'heal', u: u.id });
  }
  if (follow && followD > MT * MT) moveToward(u, unitSpeed(u, s), follow.x, follow.y);
}

function updateAttacker(rt: Runtime, u: UnitState, s: UnitStats, sages: UnitState[]) {
  if (s.kind === 'siege' && rt.state.hqDestroyed) {
    killUnit(rt, u);
    return;
  }
  // Engage defending units that come close while attacking buildings.
  if (
    s.pref === Pref.Any &&
    u.tk === TargetKind.Building &&
    hasDefenderUnits(rt) &&
    (rt.state.tick + u.id) % DISTRACT_CHECK_TICKS === 0
  ) {
    const e = nearestEnemyUnit(rt, u, s, DISTRACT_RANGE);
    if (e >= 0) {
      u.tk = TargetKind.Unit;
      u.tg = e;
      u.ob = -1;
    }
  }
  if (u.tk === TargetKind.Unit) {
    const t = rt.state.units[u.tg];
    if (!t || t.dead) retarget(rt, u, s);
  } else if (u.tk === TargetKind.Building) {
    if (rt.state.buildings[u.tg].dead) retarget(rt, u, s);
  } else if (u.idle > 0) {
    u.idle--;
    return;
  } else {
    retarget(rt, u, s);
  }
  if (u.tk === TargetKind.None) {
    u.idle = TPS;
    return;
  }
  const speed = unitSpeed(u, s);
  if (u.tk === TargetKind.Unit) {
    const t = rt.state.units[u.tg];
    const r = s.range + UNIT_REACH;
    if (dist2(t.x, t.y, u.x, u.y) <= r * r) attackUnit(rt, u, s, t, sages);
    else moveToward(u, speed, t.x, t.y);
    return;
  }
  // Breaking through an obstacle on the path.
  if (u.ob >= 0) {
    if (rt.state.buildings[u.ob].dead) u.ob = -1;
    else {
      const ob = rt.infos[u.ob];
      if (inReachOfBuilding(u, s, ob)) attackBuilding(rt, u, s, u.ob, sages);
      else {
        const [px, py] = closestPoint(ob, u.x, u.y);
        moveToward(u, speed, px, py);
      }
      return;
    }
  }
  const target = rt.infos[u.tg];
  if (inReachOfBuilding(u, s, target)) {
    attackBuilding(rt, u, s, u.tg, sages);
    return;
  }
  if (s.flying || u.pi >= u.path.length) {
    const [px, py] = closestPoint(target, u.x, u.y);
    moveToward(u, speed, px, py);
    return;
  }
  let budget = speed;
  const n = rt.n;
  while (budget > 0 && u.pi < u.path.length) {
    const tile = u.path[u.pi];
    const occ = rt.grid.occ[tile];
    if (occ >= 0 && occ !== u.tg) {
      const jumps = rt.infos[occ].isWall && (s.wallJump || u.leap > 0);
      if (!jumps) {
        u.ob = occ;
        if (inReachOfBuilding(u, s, rt.infos[occ])) attackBuilding(rt, u, s, occ, sages);
        return;
      }
    }
    const tx = (tile % n) * MT + MT / 2;
    const ty = Math.floor(tile / n) * MT + MT / 2;
    const dx = tx - u.x;
    const dy = ty - u.y;
    const d = isqrt(dx * dx + dy * dy);
    if (d <= budget) {
      u.x = tx;
      u.y = ty;
      u.pi++;
      budget -= Math.max(d, 1);
    } else {
      u.x += Math.trunc((dx * budget) / d);
      u.y += Math.trunc((dy * budget) / d);
      budget = 0;
    }
  }
}

function updateDefenderUnit(rt: Runtime, u: UnitState, s: UnitStats) {
  let t = u.tg >= 0 ? rt.state.units[u.tg] : undefined;
  if (!t || t.dead || (rt.state.tick + u.id) % DISTRACT_CHECK_TICKS === 0) {
    const e = nearestEnemyUnit(rt, u, s, 60 * MT);
    u.tg = e;
    t = e >= 0 ? rt.state.units[e] : undefined;
  }
  if (!t) return;
  const r = s.range + UNIT_REACH;
  if (dist2(t.x, t.y, u.x, u.y) <= r * r) attackUnit(rt, u, s, t, []);
  else moveToward(u, unitSpeed(u, s), t.x, t.y);
}

function updateUnits(rt: Runtime) {
  const units = rt.state.units;
  const count = units.length;
  const sages: UnitState[] = [];
  for (let i = 0; i < count; i++) {
    const u = units[i];
    if (!u.dead && u.team === Team.Attacker && rt.stats.get(u.key)!.hero?.auraRadius) sages.push(u);
  }
  for (let i = 0; i < count; i++) {
    const u = units[i];
    if (u.dead) continue;
    rt.unitWork++;
    const s = rt.stats.get(u.key)!;
    updateTimers(u);
    if (u.frozen > 0) {
      u.frozen--;
      continue;
    }
    // Sage's ability shields nearby friends while active.
    if (u.ability === 1 && s.defId === 'sage' && s.hero) {
      const r2 = s.hero.abilityRadius * s.hero.abilityRadius;
      for (const o of units) if (!o.dead && o.team === u.team && dist2(o.x, o.y, u.x, u.y) <= r2) o.inv = 2;
    }
    updateSummoner(rt, u, s);
    if (s.healRadius > 0) updateHealer(rt, u, s);
    else if (u.team === Team.Defender) updateDefenderUnit(rt, u, s);
    else updateAttacker(rt, u, s, sages);
  }
}

function updateDefenses(rt: Runtime) {
  const st = rt.state;
  for (const bi of rt.firingIdx) {
    const bs = st.buildings[bi];
    if (bs.dead) continue;
    const info = rt.infos[bi];
    const d = info.defense!;
    if (bs.frozen > 0) {
      bs.frozen--;
      continue;
    }
    if (!bs.revealed) {
      // Version 2 reveals the last hidden defences so surviving armies do not
      // wait out the clock with no target. Version 1 replays retain old behaviour.
      let seen =
        rt.setup.simVersion >= 2 &&
        !rt.targetable.some((i) => !st.buildings[i].dead && st.buildings[i].revealed);
      forAttackersNear(rt, info.cx, info.cy, d.hiddenTrigger, (u) => {
        if (!seen && dist2(u.x, u.y, info.cx, info.cy) <= d.hiddenTrigger * d.hiddenTrigger) seen = true;
      });
      if (!seen) continue;
      bs.revealed = true;
      rt.events.push({ e: 'reveal', b: bi });
    }
    if (bs.cd > 0) bs.cd--;
    const r2 = d.range * d.range;
    const m2 = d.minRange * d.minRange;
    if (bs.tgt >= 0) {
      const t = st.units[bs.tgt];
      const dd = dist2(t.x, t.y, info.cx, info.cy);
      if (t.dead || dd > r2 || dd < m2) {
        bs.tgt = -1;
        bs.ramp = 0;
      }
    }
    if (bs.tgt < 0) {
      let best = -1;
      let bestD = Infinity;
      forAttackersNear(rt, info.cx, info.cy, d.range, (u) => {
        const us = rt.stats.get(u.key)!;
        if ((d.domain & (us.flying ? 2 : 1)) === 0) return;
        const dd = dist2(u.x, u.y, info.cx, info.cy);
        if (dd > r2 || dd < m2) return;
        if (dd < bestD || (dd === bestD && u.id < best)) {
          bestD = dd;
          best = u.id;
        }
      });
      if (best < 0) continue;
      bs.tgt = best;
      bs.ramp = 0;
    }
    if (bs.cd > 0) continue;
    const t = st.units[bs.tgt];
    bs.cd = d.cdTicks;
    let dmg = d.damage;
    if (d.rampTicks.length) {
      let mult = 100;
      for (let k = 0; k < d.rampTicks.length; k++) if (bs.ramp >= d.rampTicks[k]) mult = d.rampMult[k];
      dmg = Math.floor((dmg * mult) / 100);
      bs.ramp += d.cdTicks;
    }
    let travel = 0;
    if (d.projectileSpeed > 0) {
      const dist = isqrt(dist2(t.x, t.y, info.cx, info.cy));
      travel = Math.floor(dist / d.projectileSpeed);
    }
    st.hits.push({
      tick: st.tick + travel,
      src: 'b',
      srcId: bi,
      tk: TargetKind.Unit,
      tg: t.id,
      x: t.x,
      y: t.y,
      damage: dmg,
      splash: d.splash,
      domain: d.domain,
      hitsBuildings: false,
      wallPct: 100,
    });
    rt.events.push({ e: 'shot', b: bi, u: t.id, travel });
  }
}

function updateTraps(rt: Runtime) {
  const st = rt.state;
  for (const bi of rt.trapIdx) {
    const bs = st.buildings[bi];
    if (bs.trap === 2) continue;
    const info = rt.infos[bi];
    const tr = info.trap!;
    if (bs.trap === 0) {
      let hit = false;
      forAttackersNear(rt, info.cx, info.cy, tr.trigger, (u) => {
        if (hit) return;
        const us = rt.stats.get(u.key)!;
        if ((us.flying ? 2 : 1) !== tr.domain) return;
        if (dist2(u.x, u.y, info.cx, info.cy) <= tr.trigger * tr.trigger) hit = true;
      });
      if (!hit) continue;
      bs.trap = 1;
      bs.fireTick = st.tick + tr.delayTicks;
      rt.events.push({ e: 'trap', b: bi });
    }
    if (bs.trap !== 1 || st.tick < bs.fireTick) continue;
    bs.trap = 2;
    bs.dead = true;
    if (tr.springCapacity > 0) {
      let left = tr.springCapacity;
      const r2 = Math.max(tr.splash, MT) ** 2;
      for (const u of st.units) {
        if (u.dead || u.team !== Team.Attacker) continue;
        const us = rt.stats.get(u.key)!;
        if (us.flying || us.kind === 'hero' || us.kind === 'siege') continue;
        if (us.housing > left || dist2(u.x, u.y, info.cx, info.cy) > r2) continue;
        left -= us.housing;
        u.sprung = true;
        killUnit(rt, u);
      }
      continue;
    }
    if (tr.splash > 0) {
      st.hits.push({
        tick: st.tick,
        src: 't',
        srcId: bi,
        tk: TargetKind.None,
        tg: -1,
        x: info.cx,
        y: info.cy,
        damage: tr.damage,
        splash: tr.splash,
        domain: tr.domain,
        hitsBuildings: false,
        wallPct: 100,
      });
    } else {
      let best = -1;
      let bestD = Infinity;
      forAttackersNear(rt, info.cx, info.cy, tr.trigger, (u) => {
        const us = rt.stats.get(u.key)!;
        if ((us.flying ? 2 : 1) !== tr.domain) return;
        const dd = dist2(u.x, u.y, info.cx, info.cy);
        if (dd <= tr.trigger * tr.trigger && (dd < bestD || (dd === bestD && u.id < best))) {
          bestD = dd;
          best = u.id;
        }
      });
      if (best >= 0) damageUnit(rt, st.units[best], tr.damage);
    }
  }
}

function updateSpells(rt: Runtime) {
  const st = rt.state;
  const now = st.tick;
  for (const sp of st.spells) {
    if (now >= sp.endTick) continue;
    const def = rt.content.spells[sp.id]!;
    const lvl = def.levels[sp.level - 1]!;
    const radius = mt(def.radius);
    const r2 = radius * radius;
    switch (sp.id) {
      case 'thunder':
        for (const strike of sp.strikes) {
          if (strike.tick !== now) continue;
          rt.events.push({ e: 'strike', x: strike.x, y: strike.y });
          st.hits.push({
            tick: now,
            src: 's',
            srcId: -1,
            tk: TargetKind.None,
            tg: -1,
            x: strike.x,
            y: strike.y,
            damage: Math.floor(lvl.power / THUNDER_STRIKES),
            splash: radius,
            domain: 3,
            hitsBuildings: true,
            wallPct: 100,
          });
        }
        break;
      case 'mending':
        if ((now - sp.startTick) % SPELL_PULSE_TICKS === 0)
          for (const u of st.units)
            if (!u.dead && u.team === Team.Attacker && dist2(u.x, u.y, sp.x, sp.y) <= r2)
              u.hp = Math.min(u.maxHp, u.hp + lvl.power);
        break;
      case 'fury':
        for (const u of st.units)
          if (!u.dead && u.team === Team.Attacker && dist2(u.x, u.y, sp.x, sp.y) <= r2) {
            u.rage = Math.max(u.rage, ZONE_TICKS);
            u.ragePct = Math.max(u.ragePct, lvl.power);
          }
        break;
      case 'leap':
        for (const u of st.units)
          if (!u.dead && u.team === Team.Attacker && dist2(u.x, u.y, sp.x, sp.y) <= r2)
            u.leap = Math.max(u.leap, ZONE_TICKS);
        break;
      case 'aegis':
        for (const u of st.units)
          if (!u.dead && u.team === Team.Attacker && dist2(u.x, u.y, sp.x, sp.y) <= r2) {
            u.aegis = Math.max(u.aegis, ZONE_TICKS);
            u.aegisPct = Math.max(u.aegisPct, lvl.power);
          }
        break;
    }
  }
  if (st.spells.some((sp) => now + 1 >= sp.endTick))
    st.spells = st.spells.filter((sp) => now + 1 < sp.endTick);
}

function updateClanHall(rt: Runtime) {
  if (rt.state.clanReleased || rt.clanHallIndex < 0) return;
  const ch = rt.infos[rt.clanHallIndex];
  const r = mt(rt.content.economy.battle.clanHallTriggerRange);
  let near = false;
  forAttackersNear(rt, ch.cx, ch.cy, r, (u) => {
    if (!near && dist2(u.x, u.y, ch.cx, ch.cy) <= r * r) near = true;
  });
  if (near) releaseClan(rt);
}

function resolveHits(rt: Runtime) {
  const st = rt.state;
  const now = st.tick;
  if (!st.hits.length) return;
  const due: PendingHit[] = [];
  const pull = () => {
    const keep: PendingHit[] = [];
    for (const h of st.hits) (h.tick <= now ? due : keep).push(h);
    st.hits = keep;
  };
  pull();
  // Hits queued while resolving (death explosions) land in the same tick.
  for (let i = 0; i < due.length; i++) {
    resolveHit(rt, due[i]);
    if (st.hits.length) pull();
  }
}

function resolveHit(rt: Runtime, h: PendingHit) {
  const st = rt.state;
  const attackerTeam = h.src === 'u' ? st.units[h.srcId].team : h.src === 's' ? Team.Attacker : Team.Defender;
  let x = h.x;
  let y = h.y;
  if (h.tk === TargetKind.Unit) {
    const t = st.units[h.tg];
    if (!t.dead) {
      x = t.x;
      y = t.y;
    }
    if (h.splash === 0) {
      damageUnit(rt, t, h.damage);
      return;
    }
  } else if (h.tk === TargetKind.Building && h.splash === 0) {
    const info = rt.infos[h.tg];
    damageBuilding(rt, h.tg, info.isWall ? Math.floor((h.damage * h.wallPct) / 100) : h.damage);
    return;
  }
  rt.events.push({ e: 'impact', x, y, splash: h.splash, src: h.src });
  const r2 = h.splash * h.splash;
  if (h.hitsBuildings) {
    for (const info of rt.infos) {
      if (info.isTrap || st.buildings[info.index].dead) continue;
      if (rectDist2(info, x, y) > r2) continue;
      damageBuilding(rt, info.index, info.isWall ? Math.floor((h.damage * h.wallPct) / 100) : h.damage);
    }
  }
  const victims = attackerTeam === Team.Attacker ? Team.Defender : Team.Attacker;
  if (victims === Team.Defender && !rt.defenderIds.length) return;
  for (const u of st.units) {
    if (u.dead || u.team !== victims) continue;
    const us = rt.stats.get(u.key)!;
    if ((h.domain & (us.flying ? 2 : 1)) === 0) continue;
    if (dist2(u.x, u.y, x, y) <= r2) damageUnit(rt, u, h.damage);
  }
}

function attackerHasAnything(rt: Runtime): boolean {
  const st = rt.state;
  for (const u of st.units) if (!u.dead && u.team === Team.Attacker) return true;
  const r = st.remaining;
  if (r.reinforcements) return true;
  for (const k in r.troops) if (r.troops[k] > 0) return true;
  for (const k in r.heroes) if (r.heroes[k] > 0) return true;
  for (const k in r.siege) if (r.siege[k] > 0) return true;
  return st.spells.length > 0;
}

export function starsOf(rt: Runtime): number {
  const pct = destructionPercent(rt);
  return (rt.state.hqDestroyed ? 1 : 0) + (pct >= 50 ? 1 : 0) + (pct >= 100 ? 1 : 0);
}

export function destructionPercent(rt: Runtime): number {
  return rt.totalCounted === 0 ? 100 : Math.floor((rt.state.destroyed * 100) / rt.totalCounted);
}

/** Advances one tick, applying `commands` whose tick equals the current tick. */
export function stepTick(rt: Runtime, commands: readonly Command[]) {
  const st = rt.state;
  if (st.ended) return;
  rt.events = [];
  while (st.cmdIndex < commands.length && commands[st.cmdIndex].t <= st.tick) {
    const c = commands[st.cmdIndex++];
    if (c.t === st.tick) applyCommand(rt, c);
    if (st.ended) return;
  }
  rebuildBuckets(rt);
  updateSpells(rt);
  updateTraps(rt);
  updateClanHall(rt);
  updateDefenses(rt);
  updateUnits(rt);
  rebuildBuckets(rt);
  resolveHits(rt);
  const stars = starsOf(rt);
  for (let k = 0; k < stars; k++) if (st.starTicks[k] < 0) st.starTicks[k] = st.tick;
  if (st.destroyed >= rt.totalCounted) endBattle(rt, 'destroyed');
  else if (st.tick + 1 >= rt.durationTicks) endBattle(rt, 'time');
  else if (st.tick > 0 && !attackerHasAnything(rt)) endBattle(rt, 'army');
  st.tick++;
}
