import type { GameContent, HeroId } from '@sk/content';
import type { BuilderJob, PlayerState, QueueItem } from './state.ts';
import { builderCount } from './state.ts';

export interface SettleEvent {
  kind: 'building' | 'hero' | 'research' | 'trained';
  id: string;
  level?: number;
  at: number;
}

/**
 * Completes every timer that has elapsed by `now`: upgrades, research and
 * training. Pure and idempotent: settling twice at the same time is a no-op.
 */
export function settle(content: GameContent, state: PlayerState, now: number): SettleEvent[] {
  const events: SettleEvent[] = [];
  const due = state.builders
    .map((job, idx) => ({ job, idx }))
    .filter((x): x is { job: BuilderJob; idx: number } => !!x.job && x.job.endsAt <= now)
    .sort((a, b) => a.job.endsAt - b.job.endsAt || a.idx - b.idx);
  for (const { job, idx } of due) {
    state.builders[idx] = null;
    if (job.target === 'building') {
      const b = state.buildings.find((x) => x.id === job.ref);
      if (b) {
        b.level = job.toLevel;
        events.push({ kind: 'building', id: b.defId, level: b.level, at: job.endsAt });
      }
    } else {
      const heroId = job.ref as HeroId;
      const h = state.heroes[heroId];
      state.heroes[heroId] = { level: job.toLevel, hpPercent: 100, at: job.endsAt };
      if (!h || h.level !== job.toLevel)
        events.push({ kind: 'hero', id: heroId, level: job.toLevel, at: job.endsAt });
    }
  }
  if (state.research && state.research.endsAt <= now) {
    const r = state.research;
    state.research = null;
    const table = state.levels[
      r.kind === 'troop' ? 'troops' : r.kind === 'spell' ? 'spells' : 'siege'
    ] as Record<string, number>;
    table[r.id] = r.toLevel;
    events.push({ kind: 'research', id: r.id, level: r.toLevel, at: r.endsAt });
  }
  for (const kind of ['troops', 'spells', 'siege'] as const) {
    const queue = state.training[kind];
    const army = state.army[kind] as Record<string, number>;
    while (queue.length && (queue[0] as QueueItem).endsAt <= now) {
      const item = queue.shift() as QueueItem;
      army[item.id] = (army[item.id] ?? 0) + 1;
      events.push({ kind: 'trained', id: item.id, at: item.endsAt });
    }
  }
  // New builder lodges add builder slots.
  const want = builderCount(content, state);
  while (state.builders.length < want) state.builders.push(null);
  return events;
}

/** Recomputes queue end times after a removal, keeping the in-progress item's timer. */
export function retimeQueue(queue: QueueItem[], now: number, keepFirst: boolean) {
  let t = now;
  queue.forEach((item, i) => {
    if (i === 0 && keepFirst) {
      t = item.endsAt;
      return;
    }
    t = Math.max(t, now) + item.seconds * 1000;
    item.endsAt = t;
  });
}
