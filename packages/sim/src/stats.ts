import type { GameContent, StructureDef, TargetPreference } from '@sk/content';
import { MT, Pref, TPS } from './types.ts';

/** Integer combat stats derived from content, keyed by `${defId}:${level}`. */
export interface UnitStats {
  key: string;
  defId: string;
  kind: 'troop' | 'summon' | 'hero' | 'siege';
  level: number;
  housing: number;
  flying: boolean;
  pref: Pref;
  prefMult: number;
  /** Milli-tiles per tick. */
  speed: number;
  /** Attack reach in milli-tiles (before target-size slack). */
  range: number;
  cdTicks: number;
  damage: number;
  splash: number;
  hitsGround: boolean;
  hitsAir: boolean;
  wallJump: boolean;
  suicide: boolean;
  healRadius: number;
  hp: number;
  summon: { key: string; count: number; everyTicks: number; maxAlive: number } | null;
  death: { damage: number; splash: number } | null;
  hero: {
    abilityPower: number;
    abilityTicks: number;
    abilityRadius: number;
    auraRadius: number;
    auraPct: number;
  } | null;
}

export interface DefenseStats {
  /** 1 ground, 2 air, 3 both. */
  domain: number;
  range: number;
  minRange: number;
  cdTicks: number;
  damage: number;
  splash: number;
  /** Milli-tiles per tick, 0 for instant. */
  projectileSpeed: number;
  hiddenTrigger: number;
  rampTicks: number[];
  rampMult: number[];
}

export interface TrapStats {
  domain: number;
  trigger: number;
  delayTicks: number;
  damage: number;
  splash: number;
  springCapacity: number;
}

export interface BuildingInfo {
  index: number;
  id: number;
  defId: string;
  level: number;
  x: number;
  y: number;
  size: number;
  /** Footprint bounds in milli-tiles. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  cx: number;
  cy: number;
  maxHp: number;
  counts: boolean;
  isWall: boolean;
  isTrap: boolean;
  isDefense: boolean;
  isResource: boolean;
  isHq: boolean;
  isClanHall: boolean;
  /** Defence is under upgrade and does not fire. */
  off: boolean;
  defense: DefenseStats | null;
  trap: TrapStats | null;
}

export const ticks = (seconds: number) => Math.max(1, Math.round(seconds * TPS));
export const mt = (tiles: number) => Math.round(tiles * MT);
const perTick = (tilesPerSecond: number) => Math.max(1, Math.round((tilesPerSecond * MT) / TPS));

const domainOf = (d: 'ground' | 'air' | 'both') => (d === 'ground' ? 1 : d === 'air' ? 2 : 3);

function prefOf(p: TargetPreference): Pref {
  switch (p) {
    case 'any':
      return Pref.Any;
    case 'defenses':
      return Pref.Defenses;
    case 'resources':
      return Pref.Resources;
    case 'walls':
      return Pref.Walls;
    case 'hq':
      return Pref.Hq;
    case 'support':
      return Pref.Support;
  }
}

export function buildingInfo(
  content: GameContent,
  index: number,
  b: { id: number; defId: string; level: number; x: number; y: number; off?: boolean },
): BuildingInfo {
  const def: StructureDef | undefined = content.structures[b.defId];
  if (!def) throw new Error(`unknown building ${b.defId}`);
  const lvl = def.levels[b.level - 1];
  if (!lvl) throw new Error(`unknown level ${b.level} for ${b.defId}`);
  const x0 = b.x * MT;
  const y0 = b.y * MT;
  const size = def.size;
  let defense: DefenseStats | null = null;
  if (lvl.defense) {
    const d = lvl.defense;
    defense = {
      domain: domainOf(d.targets),
      range: mt(d.range),
      minRange: mt(d.minRange ?? 0),
      cdTicks: ticks(d.attackSeconds),
      damage: d.damage,
      splash: mt(d.splash ?? 0),
      projectileSpeed: d.projectileSpeed ? perTick(d.projectileSpeed) : 0,
      hiddenTrigger: d.hidden ? mt(d.hidden.triggerRange) : 0,
      rampTicks: d.ramp ? d.ramp.stageSeconds.map((s) => Math.round(s * TPS)) : [],
      rampMult: d.ramp ? d.ramp.multipliers.map((m) => Math.round(m * 100)) : [],
    };
  }
  let trap: TrapStats | null = null;
  if (lvl.trap) {
    const t = lvl.trap;
    trap = {
      domain: t.triggers === 'ground' ? 1 : 2,
      trigger: mt(t.triggerRange),
      delayTicks: Math.round(t.delaySeconds * TPS),
      damage: t.damage,
      splash: mt(t.splash),
      springCapacity: t.springCapacity ?? 0,
    };
  }
  return {
    index,
    id: b.id,
    defId: b.defId,
    level: b.level,
    x: b.x,
    y: b.y,
    size,
    x0,
    y0,
    x1: x0 + size * MT,
    y1: y0 + size * MT,
    cx: x0 + (size * MT) / 2,
    cy: y0 + (size * MT) / 2,
    maxHp: lvl.hp,
    counts: def.countsForDestruction,
    isWall: def.category === 'wall',
    isTrap: def.category === 'trap',
    isDefense: def.category === 'defense',
    isResource: !!def.isResource,
    isHq: def.id === 'headquarters',
    isClanHall: def.id === 'clan_hall',
    off: !!b.off,
    defense,
    trap,
  };
}

export function unitStats(content: GameContent, defId: string, level: number): UnitStats {
  const key = `${defId}:${level}`;
  const troop = content.troops[defId];
  if (troop) {
    const lvl = troop.levels[level - 1];
    if (!lvl) throw new Error(`unknown level ${level} for ${defId}`);
    let summon: UnitStats['summon'] = null;
    if (troop.summon) {
      const s = troop.summon;
      const summonDef = content.troops[s.unit];
      // Summons scale with their summoner's level, capped at the summon's max level.
      const summonLevel = Math.min(level, summonDef?.levels.length ?? 1);
      summon = {
        key: `${s.unit}:${summonLevel}`,
        count: s.count,
        everyTicks: ticks(s.everySeconds),
        maxAlive: s.maxAlive,
      };
    }
    return {
      key,
      defId,
      kind: troop.barracksLevel === 0 ? 'summon' : 'troop',
      level,
      housing: troop.housing,
      flying: troop.flying,
      pref: prefOf(troop.preference),
      prefMult: Math.round((troop.preferredMultiplier ?? 1) * 100),
      speed: perTick(troop.speed),
      range: mt(troop.range),
      cdTicks: ticks(troop.attackSeconds),
      damage: lvl.damage,
      splash: mt(troop.splash ?? 0),
      hitsGround: troop.hitsGround,
      hitsAir: troop.hitsAir,
      wallJump: !!troop.wallJump,
      suicide: !!troop.suicide,
      healRadius: mt(troop.healRadius ?? 0),
      hp: lvl.hp,
      summon,
      death: troop.deathDamage
        ? { damage: troop.deathDamage.damage, splash: mt(troop.deathDamage.splash) }
        : null,
      hero: null,
    };
  }
  const hero = content.heroes[defId];
  if (hero) {
    const lvl = hero.levels[level - 1];
    if (!lvl) throw new Error(`unknown level ${level} for ${defId}`);
    return {
      key,
      defId,
      kind: 'hero',
      level,
      housing: 0,
      flying: false,
      pref: prefOf(hero.preference),
      prefMult: 100,
      speed: perTick(hero.speed),
      range: mt(hero.range),
      cdTicks: ticks(hero.attackSeconds),
      damage: lvl.damage,
      splash: 0,
      hitsGround: hero.hitsGround,
      hitsAir: hero.hitsAir,
      wallJump: false,
      suicide: false,
      healRadius: 0,
      hp: lvl.hp,
      summon: null,
      death: null,
      hero: {
        abilityPower: lvl.abilityPower,
        abilityTicks: ticks(lvl.abilitySeconds),
        abilityRadius: mt(hero.abilityRadius),
        auraRadius: mt(hero.auraRadius ?? 0),
        auraPct: lvl.auraPercent ?? 0,
      },
    };
  }
  const siege = content.siege[defId];
  if (siege) {
    const lvl = siege.levels[level - 1];
    if (!lvl) throw new Error(`unknown level ${level} for ${defId}`);
    return {
      key,
      defId,
      kind: 'siege',
      level,
      housing: 0,
      flying: false,
      pref: Pref.Hq,
      prefMult: 100,
      speed: perTick(siege.speed),
      range: mt(0.5),
      cdTicks: ticks(siege.attackSeconds),
      damage: lvl.damage,
      splash: 0,
      hitsGround: true,
      hitsAir: false,
      wallJump: false,
      suicide: false,
      healRadius: 0,
      hp: lvl.hp,
      summon: null,
      death: null,
      hero: null,
    };
  }
  throw new Error(`unknown unit ${defId}`);
}
