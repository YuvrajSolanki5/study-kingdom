import { getContent, type BuildingId } from '@sk/content';
import { applyAction, type VillageAction } from './actions.ts';
import { initialAggregate } from './initial.ts';
import { areaFree, occupancy } from './layout.ts';
import { settle } from './settle.ts';
import { buildingUpgrading, countBuildings, hqLevel, storageCapacity } from './state.ts';
import { computeStudyReward } from './study.ts';
import { canAfford, credit } from './wallet.ts';

export interface EconomyReport {
  minutesPerDay: number;
  reachedHq: number;
  hqDays: Record<number, number>;
  upgrades: number;
  days: number;
  overflowGold: number;
  firstSessionAffordableUpgrade: boolean;
}
/** A declared policy: prioritise storage, then HQ, then unlock buildings.
 * Uses production rewards, storage, placement, costs and two builder queues.
 * This is a progression-path estimate, not an estimate to max every defence.
 */
export function simulateEconomy(minutesPerDay: number, maxDays = 1095): EconomyReport {
  const content = getContent();
  let agg = initialAggregate(content),
    upgrades = 0,
    overflowGold = 0;
  const hqDays: Record<number, number> = { 1: 0 };
  const report: EconomyReport = {
    minutesPerDay,
    reachedHq: 1,
    hqDays,
    upgrades: 0,
    days: 0,
    overflowGold: 0,
    firstSessionAffordableUpgrade: false,
  };
  for (let day = 1; day <= maxDays; day++) {
    const now = day * 86400000;
    settle(content, agg.state, now);
    const hq = hqLevel(agg.state);
    if (hqDays[hq] === undefined) hqDays[hq] = day;
    if (hq === content.maxHq) {
      report.days = day;
      break;
    }
    const reward = computeStudyReward(content, {
      hq,
      dailySecondsBefore: 0,
      competitiveSecondsBefore: 0,
      eligibleSeconds: minutesPerDay * 60,
      reviewedSeconds: 0,
      plannedMinutes: minutesPerDay,
      completed: true,
      recallDone: false,
    });
    overflowGold += credit({ content, now }, agg, reward, [], 'study').overflowGold;
    if (day === 1)
      report.firstSessionAffordableUpgrade = content.structures.treasury!.levels[1]!.cost.gold! <= agg.gold;
    // Spend between sessions. New sessions remain the only income source.
    for (let tries = 0; tries < 10; tries++) {
      const cap = storageCapacity(content, agg.state),
        hqBuilding = agg.state.buildings.find((b) => b.defId === 'headquarters')!;
      const nextHq = content.structures.headquarters!.levels[hqBuilding.level];
      const needsStorage = !!nextHq && (nextHq.cost.gold ?? 0) > cap.gold;
      const candidates: VillageAction[] = [];
      const upgradesOf = (id: BuildingId) =>
        agg.state.buildings
          .filter((b) => b.defId === id && !buildingUpgrading(agg.state, b.id))
          .filter((b) => {
            const next = content.structures[id]!.levels[b.level];
            return next && next.hq <= hq;
          })
          .map((b) => ({ type: 'upgrade', buildingId: b.id }) as VillageAction);
      const build = (id: BuildingId) => {
        const def = content.structures[id]!;
        if (countBuildings(agg.state, id) >= (def.maxCount[hq - 1] ?? 0) || def.levels[0]!.hq > hq) return;
        const occ = occupancy(content, agg.state.buildings);
        for (let y = 2; y < 42; y++)
          for (let x = 2; x < 42; x++)
            if (areaFree(content, occ, id, x, y)) {
              candidates.push({ type: 'build', defId: id, x, y });
              return;
            }
      };
      if (needsStorage) {
        candidates.push(...upgradesOf('treasury'));
        build('treasury');
      } else {
        candidates.push(...upgradesOf('headquarters'));
      }
      // Avoid spending savings on optional upgrades while the next HQ is affordable in storage.
      if (!nextHq) break;
      let applied = false;
      for (const action of candidates) {
        const cost =
          action.type === 'upgrade'
            ? content.structures[agg.state.buildings.find((b) => b.id === action.buildingId)!.defId]!.levels[
                agg.state.buildings.find((b) => b.id === action.buildingId)!.level
              ]!.cost
            : action.type === 'build'
              ? content.structures[action.defId]!.levels[0]!.cost
              : {};
        if (!canAfford(agg, cost)) continue;
        try {
          agg = applyAction({ content, now }, agg, action).agg;
          upgrades++;
          applied = true;
          break;
        } catch {
          /* A busy builder is resolved on the following day. */
        }
      }
      if (!applied) break;
    }
    report.days = day;
  }
  report.reachedHq = hqLevel(agg.state);
  report.upgrades = upgrades;
  report.overflowGold = overflowGold;
  return report;
}
