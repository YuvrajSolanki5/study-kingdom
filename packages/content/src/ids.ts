// Stable identifiers. These strings are persisted in saved villages, battle
// snapshots and replays: never rename or reuse one. Display names live in the
// content definitions and may change freely.

export const STRUCTURE_IDS = [
  'headquarters',
  'treasury',
  'barracks',
  'army_camp',
  'research_library',
  'clan_hall',
  'workshop',
  'builder_lodge',
] as const;

export const DEFENSE_IDS = [
  'bolt_thrower',
  'watchtower',
  'catapult',
  'skyspear',
  'arcane_spire',
  'storm_totem',
  'repeater',
  'ember_tower',
] as const;

export const TRAP_IDS = ['blast_mine', 'spring_snare', 'sky_mine', 'seeker_mine'] as const;

export const WALL_ID = 'wall' as const;

export const TROOP_IDS = [
  'swordsman',
  'archer',
  'bulwark',
  'sapper',
  'looter',
  'wyvern',
  'mage',
  'skyship',
  'vaulter',
  'drake',
  'mender',
  'necromancer',
] as const;

/** Units that exist only in combat (summoned) and cannot be trained. */
export const SUMMON_IDS = ['skeleton'] as const;

export const SPELL_IDS = ['thunder', 'mending', 'fury', 'frost', 'leap', 'aegis'] as const;

export const HERO_IDS = ['warlord', 'sage'] as const;

export const SIEGE_IDS = ['battering_ram'] as const;

export type StructureId = (typeof STRUCTURE_IDS)[number];
export type DefenseId = (typeof DEFENSE_IDS)[number];
export type TrapId = (typeof TRAP_IDS)[number];
export type WallId = typeof WALL_ID;
export type BuildingId = StructureId | DefenseId | TrapId | WallId;
export type TroopId = (typeof TROOP_IDS)[number];
export type SummonId = (typeof SUMMON_IDS)[number];
export type SpellId = (typeof SPELL_IDS)[number];
export type HeroId = (typeof HERO_IDS)[number];
export type SiegeId = (typeof SIEGE_IDS)[number];
export type UnitId = TroopId | SummonId | HeroId | SiegeId;
export type ResearchId = TroopId | SpellId | SiegeId;

export const ALL_BUILDING_IDS: readonly BuildingId[] = [
  ...STRUCTURE_IDS,
  ...DEFENSE_IDS,
  ...TRAP_IDS,
  WALL_ID,
];

export function isDefenseId(id: string): id is DefenseId {
  return (DEFENSE_IDS as readonly string[]).includes(id);
}
export function isTrapId(id: string): id is TrapId {
  return (TRAP_IDS as readonly string[]).includes(id);
}
export function isTroopId(id: string): id is TroopId {
  return (TROOP_IDS as readonly string[]).includes(id);
}
export function isSpellId(id: string): id is SpellId {
  return (SPELL_IDS as readonly string[]).includes(id);
}
export function isHeroId(id: string): id is HeroId {
  return (HERO_IDS as readonly string[]).includes(id);
}
export function isSiegeId(id: string): id is SiegeId {
  return (SIEGE_IDS as readonly string[]).includes(id);
}
export function isBuildingId(id: string): id is BuildingId {
  return (ALL_BUILDING_IDS as readonly string[]).includes(id);
}
