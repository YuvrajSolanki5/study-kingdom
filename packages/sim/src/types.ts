/** Bump whenever a code change could alter the outcome of an existing battle. */
export const SIM_VERSION = 2;
/** Old battles remain playable with their original rules. */
export const SUPPORTED_SIM_VERSIONS: readonly number[] = [1, 2];
/** Simulation ticks per second. */
export const TPS = 10;
/** Milli-tiles per tile: every position and distance is an integer in this unit. */
export const MT = 1000;

export interface SnapshotBuilding {
  /** Stable id within the snapshot (the defender's building id). */
  id: number;
  defId: string;
  level: number;
  x: number;
  y: number;
  /** Defences under upgrade stand but do not fire. */
  off?: boolean;
}

export interface ArmySlot {
  id: string;
  level: number;
  count: number;
}

export interface HeroSlot {
  id: string;
  level: number;
  /** Health available at battle start, 1-100. */
  hpPercent: number;
}

export interface DefenderSnapshot {
  hqLevel: number;
  buildings: SnapshotBuilding[];
  /** Clan reinforcements that defend from the clan hall. */
  reinforcements: ArmySlot[];
}

export interface AttackerArmy {
  troops: ArmySlot[];
  spells: ArmySlot[];
  heroes: HeroSlot[];
  siege: ArmySlot[];
  /** Clan reinforcements available to the attacker (carried by a siege unit if one is deployed). */
  reinforcements: ArmySlot[];
}

export interface BattleSetup {
  simVersion: number;
  contentVersion: string;
  /** uint32 seed for the battle's random number generator. */
  seed: number;
  defender: DefenderSnapshot;
  attacker: AttackerArmy;
}

/** Positions are integer milli-tiles. `t` is the tick at which the command applies. */
export type Command =
  | { t: number; k: 'troop'; id: string; x: number; y: number }
  | { t: number; k: 'spell'; id: string; x: number; y: number }
  | { t: number; k: 'hero'; id: string; x: number; y: number }
  | { t: number; k: 'ability'; id: string }
  | { t: number; k: 'siege'; id: string; x: number; y: number }
  | { t: number; k: 'reinforce'; x: number; y: number }
  | { t: number; k: 'end' };

export type CommandKind = Command['k'];

export const Team = { Attacker: 0, Defender: 1 } as const;
export type Team = (typeof Team)[keyof typeof Team];

export const Pref = { Any: 0, Defenses: 1, Resources: 2, Walls: 3, Hq: 4, Support: 5 } as const;
export type Pref = (typeof Pref)[keyof typeof Pref];

export const TargetKind = { None: 0, Building: 1, Unit: 2 } as const;
export type TargetKind = (typeof TargetKind)[keyof typeof TargetKind];

/** Mutable per-building state. Static data lives in the runtime's BuildingInfo. */
export interface BuildingState {
  hp: number;
  dead: boolean;
  /** Ticks until the next attack. */
  cd: number;
  /** Target unit id, or -1. */
  tgt: number;
  /** Ticks spent on the current target (ramping defences). */
  ramp: number;
  revealed: boolean;
  frozen: number;
  /** Traps: 0 idle, 1 triggered, 2 spent. */
  trap: number;
  fireTick: number;
}

export interface UnitState {
  id: number;
  /** Key into the runtime's unit stats table. */
  key: string;
  team: Team;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  dead: boolean;
  /** True for units removed by spring traps (not counted as killed by damage). */
  sprung: boolean;
  cd: number;
  tk: TargetKind;
  tg: number;
  /** Ground path as tile indices; pi is the index of the next tile. */
  path: number[];
  pi: number;
  /** Building blocking the path that the unit is breaking through, or -1. */
  ob: number;
  rage: number;
  ragePct: number;
  aegis: number;
  aegisPct: number;
  frozen: number;
  leap: number;
  /** Invulnerability ticks. */
  inv: number;
  summonCd: number;
  /** Summoner unit id for summoned units, -1 otherwise. */
  owner: number;
  /** Hero ability: 0 unused, 1 active, 2 used. */
  ability: number;
  abilityTicks: number;
  /** Reinforcements carried by a siege unit. */
  carried: ArmySlot[] | null;
  /** Ticks to wait before scanning for a new target. */
  idle: number;
}

export interface ActiveSpell {
  id: string;
  level: number;
  x: number;
  y: number;
  startTick: number;
  endTick: number;
  /** Thunder strike centres, chosen at cast time. */
  strikes: { x: number; y: number; tick: number }[];
}

export interface PendingHit {
  tick: number;
  /** Damage source: 'b' building, 'u' unit, 's' spell, 't' trap. */
  src: 'b' | 'u' | 's' | 't';
  srcId: number;
  /** Target: building index or unit id; -1 for point-only splash. */
  tk: TargetKind;
  tg: number;
  x: number;
  y: number;
  damage: number;
  splash: number;
  /** For splash against units: 1 ground, 2 air, 3 both. */
  domain: number;
  /** Splash also damages buildings (attacker splash). */
  hitsBuildings: boolean;
  /** Multiplier (percent) applied to walls in the splash area. */
  wallPct: number;
}

export interface Remaining {
  troops: Record<string, number>;
  spells: Record<string, number>;
  heroes: Record<string, number>;
  siege: Record<string, number>;
  reinforcements: boolean;
}

export interface SimState {
  tick: number;
  rng: number;
  ended: boolean;
  endReason: '' | 'destroyed' | 'time' | 'army' | 'surrender';
  buildings: BuildingState[];
  units: UnitState[];
  hits: PendingHit[];
  spells: ActiveSpell[];
  remaining: Remaining;
  /** Incremented whenever an obstacle disappears; invalidates cached path fields. */
  gridVersion: number;
  destroyed: number;
  hqDestroyed: boolean;
  /** Whether the defending clan hall troops have been released. */
  clanReleased: boolean;
  /** Ticks at which 1, 2 and 3 stars were reached (-1 if not reached). */
  starTicks: [number, number, number];
  cmdIndex: number;
}

export interface BattleResult {
  stars: number;
  destructionPercent: number;
  hqDestroyed: boolean;
  ticks: number;
  endReason: SimState['endReason'];
  destroyedBuildings: number;
  totalBuildings: number;
  deployed: Record<string, number>;
  lost: Record<string, number>;
  spellsUsed: Record<string, number>;
  /** Army consumed, computed from what is left undeployed. */
  troopsUsed: Record<string, number>;
  siegeUsed: Record<string, number>;
  heroesUsed: string[];
  reinforcementsUsed: boolean;
  /** Remaining hero health percent by hero id. */
  heroHealth: Record<string, number>;
  /** Hash of the final state; equal hashes mean identical outcomes. */
  hash: string;
}

export type SimEvent =
  | { e: 'spawn'; u: number }
  | { e: 'shot'; b: number; u: number; travel: number }
  | { e: 'swing'; u: number; tk: TargetKind; tg: number; x: number; y: number }
  | { e: 'impact'; x: number; y: number; splash: number; src: PendingHit['src'] }
  | { e: 'bdie'; b: number }
  | { e: 'udie'; u: number }
  | { e: 'spell'; id: string; x: number; y: number }
  | { e: 'strike'; x: number; y: number }
  | { e: 'trap'; b: number }
  | { e: 'reveal'; b: number }
  | { e: 'ability'; u: number }
  | { e: 'heal'; u: number }
  | { e: 'release'; x: number; y: number }
  | { e: 'end' };
