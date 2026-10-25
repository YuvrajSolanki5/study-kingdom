import {
  hqTier,
  maxCountAt,
  structureDef,
  type BuildingId,
  type GameContent,
  type HeroId,
  type SiegeId,
  type SpellId,
  type TroopId,
} from '@sk/content';

export interface VillageBuilding {
  /** Stable per-player id. Never reused. */
  id: number;
  defId: BuildingId;
  /** Current level; 0 while the first construction is in progress. */
  level: number;
  x: number;
  y: number;
}

export interface BuilderJob {
  target: 'building' | 'hero';
  /** Building id, or hero id for hero upgrades. */
  ref: number | HeroId;
  toLevel: number;
  startedAt: number;
  endsAt: number;
  /** Amount spent, for cancellation refunds. */
  paid: { gold: number; essence: number };
}

export interface ResearchJob {
  kind: 'troop' | 'spell' | 'siege';
  id: string;
  toLevel: number;
  startedAt: number;
  endsAt: number;
  paid: { gold: number; essence: number };
}

export interface QueueItem {
  id: string;
  endsAt: number;
  /** Seconds this item takes once it reaches the front of the queue. */
  seconds: number;
}

export interface SavedLayout {
  name: string;
  positions: { id: number; x: number; y: number }[];
}

export interface HeroState {
  level: number;
  /** Health percent recorded at `at`; regenerates over time. */
  hpPercent: number;
  at: number;
}

export interface ArmyCounts {
  troops: Partial<Record<TroopId, number>>;
  spells: Partial<Record<SpellId, number>>;
  siege: Partial<Record<SiegeId, number>>;
}

export interface PlayerState {
  /** State schema version for migrations. */
  v: 1;
  nextId: number;
  buildings: VillageBuilding[];
  builders: (BuilderJob | null)[];
  research: ResearchJob | null;
  /** Researched levels; troops/spells/siege start at level 1 once unlocked. */
  levels: {
    troops: Partial<Record<TroopId, number>>;
    spells: Partial<Record<SpellId, number>>;
    siege: Partial<Record<SiegeId, number>>;
  };
  heroes: Partial<Record<HeroId, HeroState>>;
  army: ArmyCounts;
  training: { troops: QueueItem[]; spells: QueueItem[]; siege: QueueItem[] };
  layouts: (SavedLayout | null)[];
  /** Saved layout slot defended in clan wars, or null for the home layout. */
  warLayout: number | null;
  /** Best stars per campaign base. */
  campaign: Record<string, number>;
  /** Donated troops waiting in the clan hall. */
  reinforcements: { id: string; level: number; count: number }[];
  /** Battle currently in progress, which locks the army. */
  activeBattle: { id: string; expiresAt: number } | null;
  tutorialStep: number;
  cosmetics: string[];
}

/** Everything a rule needs about one player: state plus wallet. */
export interface PlayerAggregate {
  state: PlayerState;
  gold: number;
  essence: number;
}

export function hqLevel(state: PlayerState): number {
  const hq = state.buildings.find((b) => b.defId === 'headquarters');
  return Math.max(1, hq?.level ?? 1);
}

export function buildingLevelMax(state: PlayerState, defId: BuildingId): number {
  let max = 0;
  for (const b of state.buildings) if (b.defId === defId && b.level > max) max = b.level;
  return max;
}

export function countBuildings(state: PlayerState, defId: BuildingId): number {
  let n = 0;
  for (const b of state.buildings) if (b.defId === defId) n++;
  return n;
}

export function canBuildMore(content: GameContent, state: PlayerState, defId: BuildingId): boolean {
  return countBuildings(state, defId) < maxCountAt(structureDef(content, defId), hqLevel(state));
}

export function storageCapacity(content: GameContent, state: PlayerState): { gold: number; essence: number } {
  let gold = 0;
  let essence = 0;
  for (const b of state.buildings) {
    if (b.level < 1) continue;
    const lvl = content.structures[b.defId]?.levels[b.level - 1];
    if (lvl?.storage) {
      gold += lvl.storage.gold;
      essence += lvl.storage.essence;
    }
  }
  return { gold, essence };
}

export function campCapacity(content: GameContent, state: PlayerState): number {
  let total = 0;
  for (const b of state.buildings) {
    if (b.defId !== 'army_camp' || b.level < 1) continue;
    total += content.structures['army_camp']?.levels[b.level - 1]?.housing ?? 0;
  }
  return total;
}

export function spellCapacity(content: GameContent, state: PlayerState): number {
  return buildingLevelMax(state, 'research_library') > 0 ? hqTier(content, hqLevel(state)).spellCapacity : 0;
}

export function siegeCapacity(content: GameContent, state: PlayerState): number {
  return buildingLevelMax(state, 'workshop') > 0 ? hqTier(content, hqLevel(state)).siegeCapacity : 0;
}

export function reinforcementCapacity(content: GameContent, state: PlayerState): number {
  const lvl = buildingLevelMax(state, 'clan_hall');
  return lvl > 0 ? (content.structures['clan_hall']?.levels[lvl - 1]?.reinforcement ?? 0) : 0;
}

export function housingOf(content: GameContent, counts: Partial<Record<string, number>>): number {
  let total = 0;
  for (const [id, n] of Object.entries(counts)) total += (content.troops[id]?.housing ?? 0) * (n ?? 0);
  return total;
}

export function spellHousing(content: GameContent, counts: Partial<Record<string, number>>): number {
  let total = 0;
  for (const [id, n] of Object.entries(counts)) total += (content.spells[id]?.housing ?? 0) * (n ?? 0);
  return total;
}

export function sumCounts(counts: Partial<Record<string, number>>): number {
  let total = 0;
  for (const n of Object.values(counts)) total += n ?? 0;
  return total;
}

/** Troops currently unlocked by the barracks, with their researched levels. */
export function unlockedTroops(content: GameContent, state: PlayerState): TroopId[] {
  const barracks = buildingLevelMax(state, 'barracks');
  return Object.values(content.troops)
    .filter((t) => t.barracksLevel > 0 && t.barracksLevel <= barracks)
    .map((t) => t.id as TroopId);
}

export function unlockedSpells(content: GameContent, state: PlayerState): SpellId[] {
  const library = buildingLevelMax(state, 'research_library');
  return Object.values(content.spells)
    .filter((s) => s.libraryLevel <= library && library > 0)
    .map((s) => s.id);
}

export function unlockedSiege(content: GameContent, state: PlayerState): SiegeId[] {
  const workshop = buildingLevelMax(state, 'workshop');
  return Object.values(content.siege)
    .filter((s) => (s.levels[0]?.workshopLevel ?? 1) <= workshop && workshop > 0)
    .map((s) => s.id);
}

export function troopLevel(state: PlayerState, id: string): number {
  return (state.levels.troops as Record<string, number>)[id] ?? 1;
}
export function spellLevel(state: PlayerState, id: string): number {
  return (state.levels.spells as Record<string, number>)[id] ?? 1;
}
export function siegeLevel(state: PlayerState, id: string): number {
  return (state.levels.siege as Record<string, number>)[id] ?? 1;
}

/** Hero health right now, including regeneration since it was last recorded. */
export function heroHealth(content: GameContent, state: PlayerState, heroId: HeroId, now: number): number {
  const h = state.heroes[heroId];
  if (!h) return 0;
  const def = content.heroes[heroId];
  if (!def) return 0;
  const regen = ((now - h.at) / 1000 / def.regenSeconds) * 100;
  return Math.min(100, Math.floor(h.hpPercent + Math.max(0, regen)));
}

export function heroUpgrading(state: PlayerState, heroId: HeroId): boolean {
  return state.builders.some((j) => j?.target === 'hero' && j.ref === heroId);
}

export function buildingUpgrading(state: PlayerState, buildingId: number): BuilderJob | null {
  return state.builders.find((j) => j?.target === 'building' && j.ref === buildingId) ?? null;
}

export function freeBuilder(state: PlayerState): number {
  return state.builders.findIndex((j) => j === null);
}

/** Builders available: one per completed builder lodge, capped by the configured builder count. */
export function builderCount(content: GameContent, state: PlayerState): number {
  const lodges = state.buildings.filter((b) => b.defId === 'builder_lodge' && b.level > 0).length;
  return Math.min(lodges, content.economy.builderCount);
}
