import { getContent } from '@sk/content';
import { describe, expect, it } from 'vitest';
import {
  applyAction,
  attackerArmy,
  campaignStarRewards,
  consumeArmy,
  defenderSnapshot,
  initialAggregate,
  rankedTrophies,
  RuleError,
  settle,
  storageCapacity,
  type PlayerAggregate,
  type VillageAction,
} from '../src/index.ts';
import { campaignBase } from '@sk/content';

const content = getContent();
const T0 = Date.UTC(2026, 9, 1, 12, 0, 0);
const ctx = (now = T0) => ({ content, now });

function act(agg: PlayerAggregate, action: VillageAction, now = T0) {
  return applyAction(ctx(now), agg, action);
}

function expectRule(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(RuleError);
    expect((e as RuleError).code).toBe(code);
    return;
  }
  throw new Error('expected a RuleError');
}

describe('village actions', () => {
  it('starts with a valid village and starter wallet', () => {
    const agg = initialAggregate(content);
    expect(agg.gold).toBe(750);
    expect(agg.state.builders).toHaveLength(2);
    expect(storageCapacity(content, agg.state)).toEqual({ gold: 2500, essence: 1250 });
  });

  it('upgrading spends gold, uses a builder and completes after its duration', () => {
    const agg = initialAggregate(content);
    const treasury = agg.state.buildings.find((b) => b.defId === 'treasury')!;
    const { agg: a1, deltas } = act(agg, { type: 'upgrade', buildingId: treasury.id });
    expect(a1.gold).toBe(0);
    expect(deltas).toEqual([
      { resource: 'gold', amount: -750, reason: 'upgrade', ref: `building:${treasury.id}:2` },
    ]);
    expect(a1.state.builders[0]).toMatchObject({ ref: treasury.id, toLevel: 2, endsAt: T0 + 180_000 });
    const done = act(a1, { type: 'tutorial', step: 1 }, T0 + 180_000);
    expect(done.agg.state.buildings.find((b) => b.id === treasury.id)!.level).toBe(2);
    expect(done.events).toContainEqual({ kind: 'building', id: 'treasury', level: 2, at: T0 + 180_000 });
  });

  it('rejects upgrades above the headquarters requirement', () => {
    const agg = initialAggregate(content);
    const bolt = agg.state.buildings.find((b) => b.defId === 'bolt_thrower')!;
    expectRule(() => act(agg, { type: 'upgrade', buildingId: bolt.id }), 'requirement');
  });

  it('runs two builders in parallel and blocks a third upgrade', () => {
    let agg = initialAggregate(content);
    agg.gold = 2500;
    const treasury = agg.state.buildings.find((b) => b.defId === 'treasury')!;
    const barracks = agg.state.buildings.find((b) => b.defId === 'barracks')!;
    const camp = agg.state.buildings.find((b) => b.defId === 'army_camp')!;
    agg = act(agg, { type: 'upgrade', buildingId: treasury.id }).agg;
    agg = act(agg, { type: 'upgrade', buildingId: barracks.id }).agg;
    expect(agg.gold).toBe(2500 - 750 - 600);
    expectRule(() => act(agg, { type: 'upgrade', buildingId: camp.id }), 'requirement');
    const hq = agg.state.buildings.find((b) => b.defId === 'headquarters')!;
    expectRule(() => act(agg, { type: 'upgrade', buildingId: hq.id }), 'no_builder');
    // Barracks L2 takes 2 minutes; settle afterwards completes it.
    const later = T0 + 2 * 60_000;
    settle(content, agg.state, later);
    expect(agg.state.buildings.find((b) => b.id === barracks.id)!.level).toBe(2);
    expect(agg.state.builders.filter(Boolean)).toHaveLength(1);
  });

  it('refunds half on cancellation and removes unfinished new buildings', () => {
    let agg = initialAggregate(content);
    agg.gold = 2000;
    agg = act(agg, { type: 'build', defId: 'watchtower', x: 30, y: 30 }).agg;
    expect(agg.gold).toBe(1000);
    const tower = agg.state.buildings.find((b) => b.defId === 'watchtower')!;
    expect(tower.level).toBe(0);
    const builder = agg.state.builders.findIndex((j) => j?.ref === tower.id);
    const out = act(agg, { type: 'cancel_upgrade', builder });
    expect(out.agg.gold).toBe(1500);
    expect(out.agg.state.buildings.some((b) => b.id === tower.id)).toBe(false);
    expect(out.deltas).toEqual([
      { resource: 'gold', amount: 500, reason: 'cancel_refund', ref: `building:${tower.id}` },
    ]);
  });

  it('rejects overlapping placement and out-of-bounds moves', () => {
    const agg = initialAggregate(content);
    agg.gold = 5000;
    expectRule(() => act(agg, { type: 'build', defId: 'watchtower', x: 21, y: 21 }), 'blocked');
    const hq = agg.state.buildings.find((b) => b.defId === 'headquarters')!;
    expectRule(() => act(agg, { type: 'move', buildingId: hq.id, x: 40, y: 40 }), 'blocked');
    expectRule(() => act(agg, { type: 'move', buildingId: hq.id, x: 1, y: 10 }), 'blocked');
    const moved = act(agg, { type: 'move', buildingId: hq.id, x: 30, y: 8 });
    expect(moved.agg.state.buildings.find((b) => b.id === hq.id)).toMatchObject({ x: 30, y: 8 });
  });

  it('enforces building counts per headquarters level', () => {
    const agg = initialAggregate(content);
    agg.gold = 5000;
    expectRule(() => act(agg, { type: 'build', defId: 'treasury', x: 30, y: 30 }), 'limit_reached');
    expectRule(() => act(agg, { type: 'build_walls', positions: [{ x: 5, y: 5 }] }), 'requirement');
  });

  it('saves and restores layouts and detects stale ones', () => {
    let agg = initialAggregate(content);
    agg = act(agg, { type: 'save_layout', slot: 0, name: 'Home' }).agg;
    const hq = agg.state.buildings.find((b) => b.defId === 'headquarters')!;
    agg = act(agg, { type: 'move', buildingId: hq.id, x: 30, y: 8 }).agg;
    agg = act(agg, { type: 'load_layout', slot: 0 }).agg;
    expect(agg.state.buildings.find((b) => b.id === hq.id)).toMatchObject({ x: 20, y: 20 });
    expectRule(() => act(agg, { type: 'load_layout', slot: 2 }), 'not_found');
    expectRule(() => act(agg, { type: 'save_layout', slot: 9, name: 'x' }), 'invalid');
  });

  it('never mutates its input', () => {
    const agg = initialAggregate(content);
    const before = JSON.stringify(agg);
    act(agg, { type: 'train', kind: 'troops', id: 'swordsman', count: 5 });
    expect(JSON.stringify(agg)).toBe(before);
  });
});

describe('army', () => {
  it('trains within camp capacity and finishes over time', () => {
    let agg = initialAggregate(content);
    // 15 starter swordsmen in a 20-capacity camp.
    agg = act(agg, { type: 'train', kind: 'troops', id: 'swordsman', count: 5 }).agg;
    expectRule(() => act(agg, { type: 'train', kind: 'troops', id: 'swordsman', count: 1 }), 'capacity');
    expect(agg.state.training.troops).toHaveLength(5);
    settle(content, agg.state, T0 + 60_000);
    expect(agg.state.army.troops.swordsman).toBe(18);
    settle(content, agg.state, T0 + 100_000);
    expect(agg.state.army.troops.swordsman).toBe(20);
  });

  it('rejects troops the barracks has not unlocked', () => {
    const agg = initialAggregate(content);
    expectRule(() => act(agg, { type: 'train', kind: 'troops', id: 'archer', count: 1 }), 'requirement');
  });

  it('cancelling a queued item retimes the rest', () => {
    let agg = initialAggregate(content);
    agg.state.army.troops = {};
    agg = act(agg, { type: 'train', kind: 'troops', id: 'swordsman', count: 3 }).agg;
    const ends = agg.state.training.troops.map((q) => q.endsAt);
    expect(ends).toEqual([T0 + 20_000, T0 + 40_000, T0 + 60_000]);
    agg = act(agg, { type: 'cancel_training', kind: 'troops', index: 1 }, T0 + 5_000).agg;
    expect(agg.state.training.troops.map((q) => q.endsAt)).toEqual([T0 + 20_000, T0 + 40_000]);
  });

  it('freezes and consumes the army used in battle', () => {
    const agg = initialAggregate(content);
    const army = attackerArmy(content, agg.state, T0);
    expect(army.troops).toEqual([{ id: 'swordsman', level: 1, count: 15 }]);
    consumeArmy(
      agg.state,
      {
        troopsUsed: { swordsman: 10 },
        spellsUsed: {},
        siegeUsed: {},
        heroesUsed: [],
        reinforcementsUsed: false,
        heroHealth: {},
      } as never,
      T0,
    );
    expect(agg.state.army.troops.swordsman).toBe(5);
  });

  it('snapshots only completed buildings', () => {
    let agg = initialAggregate(content);
    agg.gold = 2000;
    agg = act(agg, { type: 'build', defId: 'watchtower', x: 30, y: 30 }).agg;
    const snap = defenderSnapshot(content, agg.state);
    expect(snap.buildings.some((b) => b.defId === 'watchtower')).toBe(false);
    expect(snap.buildings).toHaveLength(7);
  });
});

describe('battle rewards', () => {
  it('awards campaign stars only once', () => {
    const base = campaignBase(content, 'c01_bandit_camp');
    expect(campaignStarRewards(base, 0, 3)).toEqual({ gold: 700, essence: 200 });
    expect(campaignStarRewards(base, 2, 3)).toEqual({ gold: 400, essence: 0 });
    expect(campaignStarRewards(base, 3, 3)).toEqual({ gold: 0, essence: 0 });
  });

  it('computes symmetric bounded trophy swings', () => {
    const cfg = content.economy.ranked;
    const win = rankedTrophies(cfg, 1000, 1000, 3);
    expect(win.attacker).toBe(30);
    expect(win.defender).toBe(-30);
    const loss = rankedTrophies(cfg, 1000, 1000, 0);
    expect(loss.attacker).toBe(-15);
    expect(loss.defender).toBe(15);
    expect(rankedTrophies(cfg, 0, 5, 3).defender).toBe(-5);
    expect(rankedTrophies(cfg, 0, 0, 0).attacker).toBe(-0);
  });
});
