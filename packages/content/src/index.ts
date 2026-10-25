import type {
  CampaignBase,
  GameContent,
  HeroDef,
  HqTierInfo,
  SiegeDef,
  SpellDef,
  StructureDef,
  StructureLevel,
  TroopDef,
} from './types.ts';
import { contentV1 } from './v1/index.ts';

export * from './ids.ts';
export * from './types.ts';
export { validateContent } from './validate.ts';

/**
 * Every released content version stays registered so saved battles and
 * replays can be re-simulated with the numbers they were fought with.
 */
const REGISTRY: Record<string, GameContent> = {
  [contentV1.version]: contentV1,
};

export const CURRENT_CONTENT_VERSION = contentV1.version;

export function getContent(version: string = CURRENT_CONTENT_VERSION): GameContent {
  const content = REGISTRY[version];
  if (!content) throw new Error(`Unknown content version ${version}`);
  return content;
}

export function hasContentVersion(version: string): boolean {
  return version in REGISTRY;
}

export function structureDef(content: GameContent, id: string): StructureDef {
  const def = content.structures[id];
  if (!def) throw new Error(`Unknown structure ${id}`);
  return def;
}

export function structureLevel(content: GameContent, id: string, level: number): StructureLevel {
  const def = structureDef(content, id);
  const lvl = def.levels[level - 1];
  if (!lvl || lvl.level !== level) throw new Error(`Unknown level ${level} for ${id}`);
  return lvl;
}

export function troopDef(content: GameContent, id: string): TroopDef {
  const def = content.troops[id];
  if (!def) throw new Error(`Unknown troop ${id}`);
  return def;
}

export function spellDef(content: GameContent, id: string): SpellDef {
  const def = content.spells[id];
  if (!def) throw new Error(`Unknown spell ${id}`);
  return def;
}

export function heroDef(content: GameContent, id: string): HeroDef {
  const def = content.heroes[id];
  if (!def) throw new Error(`Unknown hero ${id}`);
  return def;
}

export function siegeDef(content: GameContent, id: string): SiegeDef {
  const def = content.siege[id];
  if (!def) throw new Error(`Unknown siege unit ${id}`);
  return def;
}

export function hqTier(content: GameContent, hq: number): HqTierInfo {
  const tier = content.hqTiers[Math.min(Math.max(hq, 1), content.hqTiers.length) - 1];
  if (!tier) throw new Error(`Unknown HQ tier ${hq}`);
  return tier;
}

export function maxCountAt(def: StructureDef, hq: number): number {
  if (hq < 1) return 0;
  return def.maxCount[Math.min(hq, def.maxCount.length) - 1] ?? 0;
}

/** Highest level of a structure allowed at the given HQ level (0 if it cannot be built). */
export function maxStructureLevelAt(def: StructureDef, hq: number): number {
  let max = 0;
  for (const l of def.levels) if (l.hq <= hq) max = l.level;
  return max;
}

export function campaignBase(content: GameContent, id: string): CampaignBase {
  const base = content.campaign.find((b) => b.id === id);
  if (!base) throw new Error(`Unknown campaign base ${id}`);
  return base;
}
