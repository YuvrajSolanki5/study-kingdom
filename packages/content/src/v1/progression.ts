import type { EconomyConfig, HqTierInfo } from '../types.ts';

export const hqTiers: HqTierInfo[] = [
  tier(1, 0, 0, 40, ['Swordsmen and Archers', 'Bolt Throwers and a Watchtower', 'Two builders']),
  tier(2, 1, 0, 55, ['Walls: break through or go around?', 'Bulwark tanks', 'Research Library and Thunder']),
  tier(3, 1, 0, 75, ['Catapult splash vs swarms', 'Sappers to breach walls', 'Blast Mines', 'Clan Hall']),
  tier(4, 2, 0, 100, ['First flyers: Wyverns vs the new Skyspear', 'Looters', 'Spring Snares', 'Mending']),
  tier(5, 2, 0, 130, ['Arcane Spire', 'Mages', 'Fury spell', 'Sky Mines', 'Hero: the Warlord']),
  tier(6, 3, 0, 170, ['Skyships bomb defences', 'Frost spell', 'Second Skyspear']),
  tier(7, 3, 1, 220, [
    'Hidden Storm Totems',
    'Vaulters jump walls',
    'Leap spell',
    'Workshop: Battering Ram',
    'Hero: the Sage',
  ]),
  tier(8, 4, 1, 280, ['Repeaters', 'Drakes', 'Aegis spell', 'Seeker Mines']),
  tier(9, 5, 1, 350, ['Ember Towers melt tanks', 'Menders heal ground armies']),
  tier(10, 6, 1, 430, ['Necromancers raise skeletons', 'Max levels for heroes and defences']),
];

function tier(level: number, spells: number, siege: number, gold: number, highlights: string[]): HqTierInfo {
  return {
    level,
    spellCapacity: spells,
    siegeCapacity: siege,
    studyGoldPerMinute: gold,
    studyEssencePerMinute: gold / 2,
    highlights,
  };
}

export const economy: EconomyConfig = {
  starterWallet: { gold: 750, essence: 250 },
  builderCount: 2,
  upgradeCancelRefundPercent: 50,
  savedLayoutSlots: 3,
  study: {
    heartbeatSeconds: 30,
    maxHeartbeatGapSeconds: 90,
    distractionGraceSeconds: 60,
    staleSessionMinutes: 30,
    minRewardSeconds: 60,
    maxSessionMinutes: 240,
    fullRateDailyMinutes: 180,
    reducedRatePercent: 25,
    competitiveDailyCapMinutes: 120,
    completionBonusPercent: 10,
    completionBonusMinMinutes: 25,
    recallBonusPercent: 10,
    reviewWindowHours: 48,
    maxReviewMinutesPerSession: 60,
    maxReviewMinutesPerDay: 90,
    webCheckInMinutes: 25,
  },
  ranked: {
    baseTrophies: 30,
    maxTrophyDelta: 40,
    minTrophyDelta: 5,
    trophyFloor: 0,
    dailyRewardedWins: 3,
    rewardStudyMinutes: 5,
    sameTargetCooldownHours: 24,
    shieldHours: 12,
    shieldDestructionPercent: 40,
    matchTrophyWindow: 300,
    matchHqWindow: 1,
  },
  battle: {
    durationSeconds: 180,
    submitGraceSeconds: 120,
    noDeployMargin: 1,
    clanHallTriggerRange: 6,
  },
  social: {
    maxFriends: 100,
    leagueMaxMembers: 30,
    leagueBattleStarPoints: 10,
    leagueStudyPointsPerMinute: 1,
    leagueDailyStarCap: 9,
    roomMaxMembers: 12,
  },
  clan: {
    maxMembers: 20,
    reinforcementRequestCooldownMinutes: 20,
    maxDonationHousingPerRequest: 30,
    weeklyObjectiveMinutesPerMember: 300,
    weeklyContributionCapMinutes: 600,
    warRosterSize: 5,
    warAttacksPerMember: 2,
    warPreparationHours: 12,
    warBattleHours: 24,
  },
};
