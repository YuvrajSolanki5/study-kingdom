import type { Cost, GameContent } from '@sk/content';
import { fail } from './errors.ts';
import { storageCapacity, type PlayerAggregate } from './state.ts';

export type Resource = 'gold' | 'essence';

/** One signed balance change. The server writes each as an append-only ledger entry. */
export interface LedgerDelta {
  resource: Resource;
  amount: number;
  reason: string;
  ref?: string;
}

export interface Ctx {
  content: GameContent;
  /** Server time in epoch milliseconds. */
  now: number;
}

export function costOf(cost: Cost): { gold: number; essence: number } {
  return { gold: cost.gold ?? 0, essence: cost.essence ?? 0 };
}

export function canAfford(agg: PlayerAggregate, cost: Cost): boolean {
  const c = costOf(cost);
  return agg.gold >= c.gold && agg.essence >= c.essence;
}

export function spend(
  agg: PlayerAggregate,
  cost: Cost,
  deltas: LedgerDelta[],
  reason: string,
  ref?: string,
): { gold: number; essence: number } {
  const c = costOf(cost);
  if (agg.gold < c.gold) fail('insufficient_funds', `Needs ${c.gold - agg.gold} more Gold`);
  if (agg.essence < c.essence) fail('insufficient_funds', `Needs ${c.essence - agg.essence} more Essence`);
  if (c.gold) {
    agg.gold -= c.gold;
    deltas.push({ resource: 'gold', amount: -c.gold, reason, ...(ref ? { ref } : {}) });
  }
  if (c.essence) {
    agg.essence -= c.essence;
    deltas.push({ resource: 'essence', amount: -c.essence, reason, ...(ref ? { ref } : {}) });
  }
  return c;
}

export interface CreditResult {
  gold: number;
  essence: number;
  /** Amounts that did not fit in storage and were not credited. */
  overflowGold: number;
  overflowEssence: number;
}

/** Credits resources up to storage capacity; anything beyond capacity is reported as overflow. */
export function credit(
  ctx: Ctx,
  agg: PlayerAggregate,
  amount: { gold?: number; essence?: number },
  deltas: LedgerDelta[],
  reason: string,
  ref?: string,
): CreditResult {
  const cap = storageCapacity(ctx.content, agg.state);
  const wantG = Math.max(0, Math.floor(amount.gold ?? 0));
  const wantE = Math.max(0, Math.floor(amount.essence ?? 0));
  const g = Math.max(0, Math.min(wantG, cap.gold - agg.gold));
  const e = Math.max(0, Math.min(wantE, cap.essence - agg.essence));
  if (g) {
    agg.gold += g;
    deltas.push({ resource: 'gold', amount: g, reason, ...(ref ? { ref } : {}) });
  }
  if (e) {
    agg.essence += e;
    deltas.push({ resource: 'essence', amount: e, reason, ...(ref ? { ref } : {}) });
  }
  return { gold: g, essence: e, overflowGold: wantG - g, overflowEssence: wantE - e };
}
