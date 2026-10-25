import {
  hqTier,
  isHeroId,
  type CampaignBase,
  type Cost,
  type GameContent,
  type RankedConfig,
} from '@sk/content';
import type { AttackerArmy, BattleResult, DefenderSnapshot } from '@sk/sim';
import {
  buildingUpgrading,
  heroHealth,
  heroUpgrading,
  hqLevel,
  siegeLevel,
  spellLevel,
  troopLevel,
  type PlayerState,
} from './state.ts';

/**
 * Freezes the defending village for an attack. Buildings still under first
 * construction are absent; defences under upgrade stand but do not fire.
 */
export function defenderSnapshot(
  content: GameContent,
  state: PlayerState,
  opts: { useWarLayout?: boolean } = {},
): DefenderSnapshot {
  const layout = opts.useWarLayout && state.warLayout !== null ? state.layouts[state.warLayout] : null;
  const pos = new Map(layout?.positions.map((p) => [p.id, p]) ?? []);
  const buildings = state.buildings
    .filter((b) => b.level >= 1 && content.structures[b.defId])
    .map((b) => {
      const p = pos.get(b.id);
      const def = content.structures[b.defId]!;
      const off = def.category === 'defense' && !!buildingUpgrading(state, b.id);
      return {
        id: b.id,
        defId: b.defId,
        level: b.level,
        x: p?.x ?? b.x,
        y: p?.y ?? b.y,
        ...(off ? { off } : {}),
      };
    });
  return { hqLevel: hqLevel(state), buildings, reinforcements: state.reinforcements.map((r) => ({ ...r })) };
}

/** Freezes the attacker's ready army (troops, spells, available heroes, siege and clan reinforcements). */
export function attackerArmy(content: GameContent, state: PlayerState, now: number): AttackerArmy {
  const slots = (counts: Record<string, number | undefined>, levelOf: (id: string) => number) =>
    Object.entries(counts)
      .filter(([, n]) => (n ?? 0) > 0)
      .map(([id, n]) => ({ id, level: levelOf(id), count: n ?? 0 }));
  const heroes = Object.entries(state.heroes)
    .filter(([id, h]) => isHeroId(id) && h && h.level > 0 && content.heroes[id] && !heroUpgrading(state, id))
    .map(([id, h]) => ({ id, level: h!.level, hpPercent: heroHealth(content, state, id as never, now) }))
    .filter((h) => h.hpPercent > 0);
  return {
    troops: slots(state.army.troops, (id) => troopLevel(state, id)),
    spells: slots(state.army.spells, (id) => spellLevel(state, id)),
    heroes,
    siege: slots(state.army.siege, (id) => siegeLevel(state, id)),
    reinforcements: state.reinforcements.map((r) => ({ ...r })),
  };
}

/** Removes the army consumed by a battle and records hero health. */
export function consumeArmy(state: PlayerState, result: BattleResult, now: number) {
  const take = (counts: Record<string, number | undefined>, used: Record<string, number>) => {
    for (const [id, n] of Object.entries(used)) {
      const left = Math.max(0, (counts[id] ?? 0) - n);
      if (left) counts[id] = left;
      else delete counts[id];
    }
  };
  take(state.army.troops as Record<string, number>, result.troopsUsed);
  take(state.army.spells as Record<string, number>, result.spellsUsed);
  take(state.army.siege as Record<string, number>, result.siegeUsed);
  if (result.reinforcementsUsed) state.reinforcements = [];
  for (const id of result.heroesUsed) {
    if (!isHeroId(id)) continue;
    const h = state.heroes[id];
    if (h) state.heroes[id] = { level: h.level, hpPercent: result.heroHealth[id] ?? h.hpPercent, at: now };
  }
}

/** Trophy changes for a ranked raid (attacker gains what the defender loses, and vice versa). */
export function rankedTrophies(
  cfg: RankedConfig,
  attacker: number,
  defender: number,
  stars: number,
): { attacker: number; defender: number } {
  const clamp = (v: number) => Math.max(cfg.minTrophyDelta, Math.min(cfg.maxTrophyDelta, Math.round(v)));
  if (stars > 0) {
    const swing = clamp(cfg.baseTrophies + (defender - attacker) / 12);
    const gain = Math.max(1, Math.round((swing * stars) / 3));
    const loss = Math.min(gain, Math.max(0, defender - cfg.trophyFloor));
    return { attacker: gain, defender: -loss };
  }
  const swing = clamp(cfg.baseTrophies + (attacker - defender) / 12);
  const loss = Math.min(Math.round(swing / 2), Math.max(0, attacker - cfg.trophyFloor));
  return { attacker: -loss, defender: loss };
}

/** One-time rewards for stars newly earned on a campaign base. */
export function campaignStarRewards(base: CampaignBase, previousStars: number, stars: number): Cost {
  let gold = 0;
  let essence = 0;
  for (let s = previousStars; s < Math.min(3, stars); s++) {
    gold += base.starRewards[s]?.gold ?? 0;
    essence += base.starRewards[s]?.essence ?? 0;
  }
  return { gold, essence };
}

/** Small capped ranked-win bonus, worth a few minutes of study at the attacker's tier. */
export function rankedBonus(content: GameContent, hq: number): Cost {
  const tier = hqTier(content, hq);
  const minutes = content.economy.ranked.rewardStudyMinutes;
  return { gold: tier.studyGoldPerMinute * minutes, essence: tier.studyEssencePerMinute * minutes };
}

/** Rough offensive strength used for matchmaking. */
export function armyStrength(content: GameContent, army: AttackerArmy): number {
  let score = 0;
  for (const t of army.troops) {
    const def = content.troops[t.id];
    const lvl = def?.levels[t.level - 1];
    if (def && lvl) score += Math.sqrt(lvl.hp * (lvl.damage / def.attackSeconds)) * t.count;
  }
  for (const h of army.heroes) {
    const lvl = content.heroes[h.id]?.levels[h.level - 1];
    if (lvl) score += Math.sqrt(lvl.hp * lvl.damage) * (h.hpPercent / 100);
  }
  for (const s of army.spells) score += 40 * s.level * s.count;
  for (const s of army.siege) score += 150 * s.level * s.count;
  return Math.round(score);
}

/** Rough defensive strength used for matchmaking. */
export function defenseStrength(content: GameContent, snap: DefenderSnapshot): number {
  let score = 0;
  for (const b of snap.buildings) {
    const lvl = content.structures[b.defId]?.levels[b.level - 1];
    if (!lvl) continue;
    if (lvl.defense) score += Math.sqrt(lvl.hp * (lvl.defense.damage / lvl.defense.attackSeconds)) * 4;
    else if (content.structures[b.defId]?.category === 'wall') score += lvl.hp / 200;
    else score += lvl.hp / 100;
  }
  return Math.round(score);
}
