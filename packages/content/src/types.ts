import type { BuildingId, HeroId, SiegeId, SpellId, SummonId, TrapId, TroopId, UnitId } from './ids.ts';

// Content uses human units (tiles, seconds). The simulation converts them to
// integer milli-tiles and ticks once, when a battle is created.

export interface Cost {
  gold?: number;
  essence?: number;
}

export type BuildingCategory = 'core' | 'storage' | 'army' | 'utility' | 'defense' | 'wall' | 'trap';
export type TargetDomain = 'ground' | 'air' | 'both';

export interface DefenseLevelStats {
  targets: TargetDomain;
  /** Reach in tiles, measured from the building centre to the unit. */
  range: number;
  minRange?: number;
  attackSeconds: number;
  /** Damage per hit. For ramping defences this is the stage-one damage. */
  damage: number;
  /** Splash radius in tiles around the impact point. */
  splash?: number;
  /** Tiles per second. Omitted means the hit lands on the next tick. */
  projectileSpeed?: number;
  /** Hidden defences reveal themselves when a unit comes within triggerRange. */
  hidden?: { triggerRange: number };
  /** Ramping damage: multiplier applies after the stage's cumulative seconds on one target. */
  ramp?: { stageSeconds: number[]; multipliers: number[] };
}

export interface TrapLevelStats {
  triggers: 'ground' | 'air';
  triggerRange: number;
  delaySeconds: number;
  damage: number;
  /** Splash radius in tiles; 0 means a single target. */
  splash: number;
  /** Spring traps remove up to this much housing space instead of dealing damage. */
  springCapacity?: number;
}

export interface StructureLevel {
  level: number;
  /** Minimum headquarters level to build (level 1) or upgrade to this level. */
  hq: number;
  cost: Cost;
  seconds: number;
  hp: number;
  storage?: { gold: number; essence: number };
  /** Army camp troop housing. */
  housing?: number;
  /** Clan hall reinforcement housing. */
  reinforcement?: number;
  defense?: DefenseLevelStats;
  trap?: TrapLevelStats;
}

export interface StructureDef {
  id: BuildingId;
  name: string;
  description: string;
  category: BuildingCategory;
  /** Square footprint edge in tiles. */
  size: number;
  /** Maximum count at each headquarters level (index 0 = HQ1). */
  maxCount: number[];
  levels: StructureLevel[];
  /** First level of each of the three visual stages. */
  visualStages: [number, number, number];
  /** Counted toward destruction percentage and stars. Walls and traps are not. */
  countsForDestruction: boolean;
  /** Preferred by resource-targeting troops. */
  isResource?: boolean;
}

export type TargetPreference = 'any' | 'defenses' | 'resources' | 'walls' | 'hq' | 'support';

export interface UnitLevel {
  level: number;
  /** Research library level required to research this level. Level 1 needs none. */
  libraryLevel: number;
  researchCost: Cost;
  researchSeconds: number;
  hp: number;
  /** Damage per attack (or healing per pulse for healers). */
  damage: number;
}

export interface SummonSpec {
  unit: SummonId;
  count: number;
  everySeconds: number;
  maxAlive: number;
}

export interface TroopDef {
  id: TroopId | SummonId;
  name: string;
  role: string;
  description: string;
  housing: number;
  flying: boolean;
  preference: TargetPreference;
  /** Damage multiplier against preferred targets (resource raiders, wall breakers). */
  preferredMultiplier?: number;
  speed: number;
  range: number;
  attackSeconds: number;
  splash?: number;
  hitsGround: boolean;
  hitsAir: boolean;
  wallJump?: boolean;
  /** Destroyed on its first hit (wall breakers). */
  suicide?: boolean;
  /** Healers heal friendly ground units in this radius instead of attacking. */
  healRadius?: number;
  summon?: SummonSpec;
  /** Damage dealt around the unit when it dies. */
  deathDamage?: { damage: number; splash: number };
  /** Barracks level required to train. 0 for summons. */
  barracksLevel: number;
  trainSeconds: number;
  levels: UnitLevel[];
}

export type SpellKind = SpellId;

export interface SpellLevel {
  level: number;
  libraryLevel: number;
  researchCost: Cost;
  researchSeconds: number;
  /** Kind-specific strength: damage, healing per pulse, damage boost percent, freeze seconds, damage reduction percent. */
  power: number;
  durationSeconds: number;
}

export interface SpellDef {
  id: SpellId;
  name: string;
  description: string;
  housing: number;
  brewSeconds: number;
  radius: number;
  /** Research library level that unlocks the spell. */
  libraryLevel: number;
  levels: SpellLevel[];
}

export interface HeroLevel {
  level: number;
  hq: number;
  cost: Cost;
  seconds: number;
  hp: number;
  damage: number;
  /** Ability strength; meaning depends on the hero. */
  abilityPower: number;
  /** Ability duration in seconds. */
  abilitySeconds: number;
  /** Aura damage bonus percent (support heroes). */
  auraPercent?: number;
}

export interface HeroDef {
  id: HeroId;
  name: string;
  role: string;
  description: string;
  abilityName: string;
  abilityDescription: string;
  speed: number;
  range: number;
  attackSeconds: number;
  preference: TargetPreference;
  hitsGround: boolean;
  hitsAir: boolean;
  /** Radius of the ability (and aura for support heroes). */
  abilityRadius: number;
  auraRadius?: number;
  /** Seconds to recover from zero health. */
  regenSeconds: number;
  levels: HeroLevel[];
}

export interface SiegeLevel {
  level: number;
  workshopLevel: number;
  researchCost: Cost;
  researchSeconds: number;
  hp: number;
  /** Damage per attack against walls and the headquarters. */
  damage: number;
}

export interface SiegeDef {
  id: SiegeId;
  name: string;
  description: string;
  speed: number;
  attackSeconds: number;
  buildSeconds: number;
  levels: SiegeLevel[];
}

export interface HqTierInfo {
  level: number;
  spellCapacity: number;
  siegeCapacity: number;
  /** Gold and Essence earned per eligible study minute at this tier. */
  studyGoldPerMinute: number;
  studyEssencePerMinute: number;
  /** Player-facing summary of the tactical decision this tier introduces. */
  highlights: string[];
}

export interface PlacedBuilding {
  defId: BuildingId;
  level: number;
  x: number;
  y: number;
}

export interface UnitStack {
  unitId: UnitId;
  level: number;
  count: number;
}

export interface CampaignBase {
  id: string;
  order: number;
  name: string;
  description: string;
  hqLevel: number;
  buildings: PlacedBuilding[];
  reinforcements: UnitStack[];
  /** One-time reward for reaching each star (index 0 = first star). */
  starRewards: [Cost, Cost, Cost];
}

export interface StudyConfig {
  heartbeatSeconds: number;
  /** A heartbeat later than this after the previous one starts a disconnected gap. */
  maxHeartbeatGapSeconds: number;
  /** Time away from allowlisted apps before computer-mode earnings pause. */
  distractionGraceSeconds: number;
  /** Sessions without heartbeats for this long are closed automatically. */
  staleSessionMinutes: number;
  minRewardSeconds: number;
  maxSessionMinutes: number;
  /** Daily study minutes earning at full rate; later minutes earn reducedRatePercent. */
  fullRateDailyMinutes: number;
  reducedRatePercent: number;
  competitiveDailyCapMinutes: number;
  completionBonusPercent: number;
  completionBonusMinMinutes: number;
  recallBonusPercent: number;
  reviewWindowHours: number;
  maxReviewMinutesPerSession: number;
  maxReviewMinutesPerDay: number;
  /** Web focus check-in interval for computer mode. */
  webCheckInMinutes: number;
}

export interface RankedConfig {
  baseTrophies: number;
  maxTrophyDelta: number;
  minTrophyDelta: number;
  trophyFloor: number;
  /** Ranked wins per day that also grant a small resource bonus. */
  dailyRewardedWins: number;
  /** Bonus as minutes of study-equivalent income at the attacker's tier. */
  rewardStudyMinutes: number;
  sameTargetCooldownHours: number;
  shieldHours: number;
  shieldDestructionPercent: number;
  matchTrophyWindow: number;
  matchHqWindow: number;
}

export interface BattleConfig {
  durationSeconds: number;
  /** Extra seconds allowed between server start and command submission. */
  submitGraceSeconds: number;
  /** Tiles around each building where troops cannot be deployed. */
  noDeployMargin: number;
  clanHallTriggerRange: number;
}

export interface SocialConfig {
  maxFriends: number;
  leagueMaxMembers: number;
  leagueBattleStarPoints: number;
  leagueStudyPointsPerMinute: number;
  leagueDailyStarCap: number;
  roomMaxMembers: number;
}

export interface ClanConfig {
  maxMembers: number;
  reinforcementRequestCooldownMinutes: number;
  maxDonationHousingPerRequest: number;
  weeklyObjectiveMinutesPerMember: number;
  weeklyContributionCapMinutes: number;
  warRosterSize: number;
  warAttacksPerMember: number;
  warPreparationHours: number;
  warBattleHours: number;
}

export interface EconomyConfig {
  starterWallet: { gold: number; essence: number };
  builderCount: number;
  upgradeCancelRefundPercent: number;
  savedLayoutSlots: number;
  study: StudyConfig;
  ranked: RankedConfig;
  battle: BattleConfig;
  social: SocialConfig;
  clan: ClanConfig;
}

export interface MapConfig {
  /** Total tiles per side, including the deploy-only border. */
  size: number;
  /** Buildings must fit within [buildMin, buildMax). */
  buildMin: number;
  buildMax: number;
}

export interface GameContent {
  version: string;
  maxHq: number;
  map: MapConfig;
  structures: Record<string, StructureDef>;
  troops: Record<string, TroopDef>;
  spells: Record<string, SpellDef>;
  heroes: Record<string, HeroDef>;
  siege: Record<string, SiegeDef>;
  hqTiers: HqTierInfo[];
  economy: EconomyConfig;
  campaign: CampaignBase[];
}

export type { TrapId };
