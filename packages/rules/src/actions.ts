import {
  heroDef,
  hqTier,
  isHeroId,
  maxCountAt,
  structureDef,
  type BuildingId,
  type HeroId,
} from '@sk/content';
import { fail } from './errors.ts';
import { areaFree, assertValidLayout, markArea, occupancy } from './layout.ts';
import { retimeQueue, settle, type SettleEvent } from './settle.ts';
import {
  buildingLevelMax,
  buildingUpgrading,
  campCapacity,
  countBuildings,
  freeBuilder,
  heroUpgrading,
  housingOf,
  hqLevel,
  siegeCapacity,
  spellCapacity,
  spellHousing,
  sumCounts,
  unlockedSiege,
  unlockedSpells,
  unlockedTroops,
  type PlayerAggregate,
  type PlayerState,
  type QueueItem,
} from './state.ts';
import { credit, spend, type Ctx, type LedgerDelta } from './wallet.ts';

export type ArmyKind = 'troops' | 'spells' | 'siege';

export type VillageAction =
  | { type: 'build'; defId: BuildingId; x: number; y: number }
  | { type: 'build_walls'; positions: { x: number; y: number }[] }
  | { type: 'upgrade'; buildingId: number }
  | { type: 'upgrade_walls'; buildingIds: number[] }
  | { type: 'cancel_upgrade'; builder: number }
  | { type: 'move'; buildingId: number; x: number; y: number }
  | { type: 'apply_layout'; positions: { id: number; x: number; y: number }[] }
  | { type: 'save_layout'; slot: number; name: string }
  | { type: 'load_layout'; slot: number }
  | { type: 'delete_layout'; slot: number }
  | { type: 'set_war_layout'; slot: number | null }
  | { type: 'research'; kind: 'troop' | 'spell' | 'siege'; id: string }
  | { type: 'cancel_research' }
  | { type: 'train'; kind: ArmyKind; id: string; count: number }
  | { type: 'cancel_training'; kind: ArmyKind; index: number }
  | { type: 'dismiss'; kind: ArmyKind; id: string; count: number }
  | { type: 'upgrade_hero'; heroId: HeroId }
  | { type: 'tutorial'; step: number };

export type VillageActionType = VillageAction['type'];

export interface ActionOutcome {
  agg: PlayerAggregate;
  deltas: LedgerDelta[];
  events: SettleEvent[];
}

const MAX_BATCH = 100;

/**
 * Applies one player action at server time `ctx.now`. Settles elapsed timers
 * first so every rule sees up-to-date levels. Never mutates the input.
 */
export function applyAction(ctx: Ctx, input: PlayerAggregate, action: VillageAction): ActionOutcome {
  const agg: PlayerAggregate = structuredClone(input);
  const deltas: LedgerDelta[] = [];
  const events = settle(ctx.content, agg.state, ctx.now);
  const { content } = ctx;
  const s = agg.state;
  switch (action.type) {
    case 'build': {
      if (!content.structures[action.defId]) fail('invalid', 'Unknown building');
      const def = structureDef(content, action.defId);
      if (def.category === 'wall') fail('invalid', 'Use build_walls for walls');
      const hq = hqLevel(s);
      if (countBuildings(s, action.defId) >= maxCountAt(def, hq))
        fail('limit_reached', `No more ${def.name} allowed at this Keep level`);
      const lvl = def.levels[0];
      if (!lvl || lvl.hq > hq) fail('requirement', `${def.name} unlocks at Keep ${lvl?.hq}`);
      const occ = occupancy(content, s.buildings);
      if (!areaFree(content, occ, action.defId, action.x, action.y))
        fail('blocked', 'That space is not free');
      const id = s.nextId++;
      if (lvl.seconds > 0) {
        const builder = freeBuilder(s);
        if (builder < 0) fail('no_builder', 'All builders are busy');
        const paid = spend(agg, lvl.cost, deltas, 'build', `building:${id}`);
        s.buildings.push({ id, defId: action.defId, level: 0, x: action.x, y: action.y });
        s.builders[builder] = {
          target: 'building',
          ref: id,
          toLevel: 1,
          startedAt: ctx.now,
          endsAt: ctx.now + lvl.seconds * 1000,
          paid,
        };
      } else {
        spend(agg, lvl.cost, deltas, 'build', `building:${id}`);
        s.buildings.push({ id, defId: action.defId, level: 1, x: action.x, y: action.y });
      }
      break;
    }
    case 'build_walls': {
      const def = structureDef(content, 'wall');
      const hq = hqLevel(s);
      const lvl = def.levels[0];
      if (!lvl || lvl.hq > hq) fail('requirement', `Ramparts unlock at Keep ${lvl?.hq}`);
      if (!action.positions.length || action.positions.length > MAX_BATCH) fail('invalid', 'Bad wall batch');
      if (countBuildings(s, 'wall') + action.positions.length > maxCountAt(def, hq))
        fail('limit_reached', 'Not enough walls available');
      const occ = occupancy(content, s.buildings);
      const total = { gold: (lvl.cost.gold ?? 0) * action.positions.length };
      for (const p of action.positions) {
        if (!areaFree(content, occ, 'wall', p.x, p.y)) fail('blocked', `Rampart at ${p.x},${p.y} is blocked`);
        markArea(content, occ, -2, 'wall', p.x, p.y);
      }
      spend(agg, total, deltas, 'build_walls');
      for (const p of action.positions)
        s.buildings.push({ id: s.nextId++, defId: 'wall', level: 1, x: p.x, y: p.y });
      break;
    }
    case 'upgrade': {
      const b = s.buildings.find((x) => x.id === action.buildingId);
      if (!b) fail('not_found', 'No such building');
      if (b.level < 1) fail('busy', 'Still under construction');
      if (buildingUpgrading(s, b.id)) fail('busy', 'Already upgrading');
      const def = structureDef(content, b.defId);
      const next = def.levels[b.level];
      if (!next) fail('limit_reached', `${def.name} is at max level`);
      if (next.hq > hqLevel(s)) fail('requirement', `Requires Keep ${next.hq}`);
      if (next.seconds > 0) {
        const builder = freeBuilder(s);
        if (builder < 0) fail('no_builder', 'All builders are busy');
        const paid = spend(agg, next.cost, deltas, 'upgrade', `building:${b.id}:${next.level}`);
        s.builders[builder] = {
          target: 'building',
          ref: b.id,
          toLevel: next.level,
          startedAt: ctx.now,
          endsAt: ctx.now + next.seconds * 1000,
          paid,
        };
      } else {
        spend(agg, next.cost, deltas, 'upgrade', `building:${b.id}:${next.level}`);
        b.level = next.level;
      }
      break;
    }
    case 'upgrade_walls': {
      if (!action.buildingIds.length || action.buildingIds.length > MAX_BATCH)
        fail('invalid', 'Bad wall batch');
      const def = structureDef(content, 'wall');
      const hq = hqLevel(s);
      const ids = new Set(action.buildingIds);
      if (ids.size !== action.buildingIds.length) fail('invalid', 'Duplicate walls');
      let gold = 0;
      let essence = 0;
      const walls = s.buildings.filter((b) => ids.has(b.id));
      if (walls.length !== ids.size || walls.some((w) => w.defId !== 'wall'))
        fail('not_found', 'Not all walls found');
      for (const w of walls) {
        const next = def.levels[w.level];
        if (!next) fail('limit_reached', 'A wall is already at max level');
        if (next.hq > hq) fail('requirement', `Requires Keep ${next.hq}`);
        gold += next.cost.gold ?? 0;
        essence += next.cost.essence ?? 0;
      }
      spend(agg, { gold, essence }, deltas, 'upgrade_walls');
      for (const w of walls) w.level++;
      break;
    }
    case 'cancel_upgrade': {
      const job = s.builders[action.builder];
      if (!job) fail('not_found', 'That builder is idle');
      s.builders[action.builder] = null;
      const pct = content.economy.upgradeCancelRefundPercent;
      credit(
        ctx,
        agg,
        {
          gold: Math.floor((job.paid.gold * pct) / 100),
          essence: Math.floor((job.paid.essence * pct) / 100),
        },
        deltas,
        'cancel_refund',
        `${job.target}:${String(job.ref)}`,
      );
      if (job.target === 'building' && job.toLevel === 1)
        s.buildings = s.buildings.filter((b) => b.id !== job.ref);
      break;
    }
    case 'move': {
      const b = s.buildings.find((x) => x.id === action.buildingId);
      if (!b) fail('not_found', 'No such building');
      const occ = occupancy(content, s.buildings, new Set([b.id]));
      if (!areaFree(content, occ, b.defId, action.x, action.y)) fail('blocked', 'That space is not free');
      b.x = action.x;
      b.y = action.y;
      break;
    }
    case 'apply_layout': {
      if (action.positions.length > s.buildings.length) fail('invalid', 'Too many positions');
      const byId = new Map(s.buildings.map((b) => [b.id, b]));
      const seen = new Set<number>();
      for (const p of action.positions) {
        const b = byId.get(p.id);
        if (!b || seen.has(p.id)) fail('invalid', `Bad building ${p.id}`);
        seen.add(p.id);
        b.x = p.x;
        b.y = p.y;
      }
      assertValidLayout(content, s.buildings);
      break;
    }
    case 'save_layout': {
      checkSlot(ctx, action.slot);
      const name = action.name.trim().slice(0, 32) || `Layout ${action.slot + 1}`;
      while (s.layouts.length <= action.slot) s.layouts.push(null);
      s.layouts[action.slot] = { name, positions: s.buildings.map((b) => ({ id: b.id, x: b.x, y: b.y })) };
      break;
    }
    case 'load_layout': {
      checkSlot(ctx, action.slot);
      const layout = s.layouts[action.slot];
      if (!layout) fail('not_found', 'That layout slot is empty');
      const pos = new Map(layout.positions.map((p) => [p.id, p]));
      for (const b of s.buildings) {
        const p = pos.get(b.id);
        if (p) {
          b.x = p.x;
          b.y = p.y;
        }
      }
      try {
        assertValidLayout(content, s.buildings);
      } catch {
        fail('conflict', 'This layout no longer fits your village. Edit and save it again.');
      }
      break;
    }
    case 'delete_layout': {
      checkSlot(ctx, action.slot);
      if (s.layouts[action.slot]) s.layouts[action.slot] = null;
      if (s.warLayout === action.slot) s.warLayout = null;
      break;
    }
    case 'set_war_layout': {
      if (action.slot !== null) {
        checkSlot(ctx, action.slot);
        if (!s.layouts[action.slot]) fail('not_found', 'That layout slot is empty');
      }
      s.warLayout = action.slot;
      break;
    }
    case 'research': {
      const library = buildingLevelMax(s, 'research_library');
      if (library < 1) fail('requirement', 'Build a Lorehouse first');
      const libBusy = s.buildings.some(
        (b) => b.defId === 'research_library' && b.level >= 1 && buildingUpgrading(s, b.id),
      );
      if (libBusy) fail('busy', 'The Lorehouse is being upgraded');
      if (s.research) fail('busy', 'Research already in progress');
      const { levels, unlocked, table } = researchTarget(ctx, s, action.kind, action.id);
      if (!unlocked) fail('requirement', 'Unlock it first');
      const current = table[action.id] ?? 1;
      const next = levels[current];
      if (!next) fail('limit_reached', 'Already at max level');
      const needLibrary = 'libraryLevel' in next ? next.libraryLevel : 0;
      const needWorkshop = 'workshopLevel' in next ? next.workshopLevel : 0;
      if (needLibrary > library) fail('requirement', `Requires Lorehouse ${needLibrary}`);
      if (needWorkshop > buildingLevelMax(s, 'workshop'))
        fail('requirement', `Requires Tinker Forge ${needWorkshop}`);
      const paid = spend(
        agg,
        next.researchCost,
        deltas,
        'research',
        `${action.kind}:${action.id}:${next.level}`,
      );
      s.research = {
        kind: action.kind,
        id: action.id,
        toLevel: next.level,
        startedAt: ctx.now,
        endsAt: ctx.now + next.researchSeconds * 1000,
        paid,
      };
      break;
    }
    case 'cancel_research': {
      const r = s.research;
      if (!r) fail('not_found', 'No research in progress');
      s.research = null;
      const pct = content.economy.upgradeCancelRefundPercent;
      credit(
        ctx,
        agg,
        { gold: Math.floor((r.paid.gold * pct) / 100), essence: Math.floor((r.paid.essence * pct) / 100) },
        deltas,
        'cancel_refund',
        `research:${r.kind}:${r.id}`,
      );
      break;
    }
    case 'train': {
      if (!Number.isInteger(action.count) || action.count < 1 || action.count > 200)
        fail('invalid', 'Bad count');
      const queue = s.training[action.kind];
      let seconds: number;
      if (action.kind === 'troops') {
        if (!unlockedTroops(content, s).includes(action.id as never))
          fail('requirement', 'Troop not unlocked');
        const def = content.troops[action.id]!;
        const used = housingOf(content, s.army.troops) + housingOf(content, countQueue(queue));
        if (used + def.housing * action.count > campCapacity(content, s))
          fail('capacity', 'Not enough room in your army camps');
        seconds = def.trainSeconds;
      } else if (action.kind === 'spells') {
        if (!unlockedSpells(content, s).includes(action.id as never))
          fail('requirement', 'Spell not unlocked');
        const def = content.spells[action.id]!;
        const used = spellHousing(content, s.army.spells) + spellHousing(content, countQueue(queue));
        if (used + action.count * def.housing > spellCapacity(content, s))
          fail('capacity', 'Spell capacity full');
        seconds = def.brewSeconds;
      } else {
        if (!unlockedSiege(content, s).includes(action.id as never))
          fail('requirement', 'Siege not unlocked');
        const def = content.siege[action.id]!;
        const used = sumCounts(s.army.siege) + queue.length;
        if (used + action.count > siegeCapacity(content, s)) fail('capacity', 'Tinker Forge capacity full');
        seconds = def.buildSeconds;
      }
      let t = queue.length ? (queue[queue.length - 1] as QueueItem).endsAt : ctx.now;
      for (let i = 0; i < action.count; i++) {
        t = Math.max(t, ctx.now) + seconds * 1000;
        queue.push({ id: action.id, endsAt: t, seconds });
      }
      break;
    }
    case 'cancel_training': {
      const queue = s.training[action.kind];
      if (!Number.isInteger(action.index) || action.index < 0 || action.index >= queue.length)
        fail('not_found', 'Nothing queued there');
      queue.splice(action.index, 1);
      retimeQueue(queue, ctx.now, action.index !== 0);
      break;
    }
    case 'dismiss': {
      if (s.activeBattle) fail('busy', 'Your army is in battle');
      const army = s.army[action.kind] as Record<string, number>;
      const have = army[action.id] ?? 0;
      if (!Number.isInteger(action.count) || action.count < 1 || action.count > have)
        fail('invalid', 'Bad count');
      army[action.id] = have - action.count;
      if (!army[action.id]) delete army[action.id];
      break;
    }
    case 'upgrade_hero': {
      if (!isHeroId(action.heroId)) fail('invalid', 'Unknown hero');
      const def = heroDef(content, action.heroId);
      if (s.activeBattle) fail('busy', 'Your hero is in battle');
      if (heroUpgrading(s, action.heroId)) fail('busy', 'Already upgrading');
      const current = s.heroes[action.heroId]?.level ?? 0;
      const next = def.levels[current];
      if (!next) fail('limit_reached', `${def.name} is at max level`);
      if (next.hq > hqLevel(s)) fail('requirement', `Requires Keep ${next.hq}`);
      const builder = freeBuilder(s);
      if (builder < 0) fail('no_builder', 'All builders are busy');
      const paid = spend(agg, next.cost, deltas, 'hero_upgrade', `hero:${action.heroId}:${next.level}`);
      s.builders[builder] = {
        target: 'hero',
        ref: action.heroId,
        toLevel: next.level,
        startedAt: ctx.now,
        endsAt: ctx.now + next.seconds * 1000,
        paid,
      };
      break;
    }
    case 'tutorial': {
      if (!Number.isInteger(action.step) || action.step < 0 || action.step > 100) fail('invalid', 'Bad step');
      s.tutorialStep = Math.max(s.tutorialStep, action.step);
      break;
    }
    default:
      fail('invalid', 'Unknown action');
  }
  // Complete anything that finishes instantly (zero-second jobs).
  events.push(...settle(content, s, ctx.now));
  return { agg, deltas, events };
}

function checkSlot(ctx: Ctx, slot: number) {
  if (!Number.isInteger(slot) || slot < 0 || slot >= ctx.content.economy.savedLayoutSlots)
    fail('invalid', 'Bad layout slot');
}

function countQueue(queue: QueueItem[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const q of queue) out[q.id] = (out[q.id] ?? 0) + 1;
  return out;
}

function researchTarget(ctx: Ctx, s: PlayerState, kind: 'troop' | 'spell' | 'siege', id: string) {
  const { content } = ctx;
  if (kind === 'troop') {
    const def = content.troops[id];
    if (!def || def.barracksLevel === 0) fail('invalid', 'Unknown troop');
    return {
      levels: def.levels,
      unlocked: unlockedTroops(content, s).includes(id as never),
      table: s.levels.troops as Record<string, number>,
    };
  }
  if (kind === 'spell') {
    const def = content.spells[id];
    if (!def) fail('invalid', 'Unknown spell');
    return {
      levels: def.levels,
      unlocked: unlockedSpells(content, s).includes(id as never),
      table: s.levels.spells as Record<string, number>,
    };
  }
  const def = content.siege[id];
  if (!def) fail('invalid', 'Unknown siege unit');
  return {
    levels: def.levels,
    unlocked: unlockedSiege(content, s).includes(id as never),
    table: s.levels.siege as Record<string, number>,
  };
}

/** Spell and siege capacity for the HQ tier, exposed for UI. */
export function tierLimits(ctx: Ctx, s: PlayerState) {
  return {
    spells: spellCapacity(ctx.content, s),
    siege: siegeCapacity(ctx.content, s),
    camp: campCapacity(ctx.content, s),
    tier: hqTier(ctx.content, hqLevel(s)),
  };
}
