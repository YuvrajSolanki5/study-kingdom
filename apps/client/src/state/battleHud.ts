import type { BattleResult, Command } from '@sk/sim';
import { create } from 'zustand';

export type Selection =
  | { k: 'troop'; id: string }
  | { k: 'spell'; id: string }
  | { k: 'hero'; id: string }
  | { k: 'siege'; id: string }
  | { k: 'reinforce' }
  | null;

/** Fast-changing battle display state, kept apart from the main store to limit re-renders. */
interface BattleHud {
  started: boolean;
  ended: boolean;
  tick: number;
  durationTicks: number;
  stars: number;
  percent: number;
  remaining: {
    troops: Record<string, number>;
    spells: Record<string, number>;
    heroes: Record<string, number>;
    siege: Record<string, number>;
    reinforcements: boolean;
  };
  heroAbility: Record<string, 'ready' | 'used' | 'none'>;
  selection: Selection;
  speed: number;
  paused: boolean;
  invalidAt: number;
  result: BattleResult | null;
  set(p: Partial<BattleHud>): void;
  reset(): void;
}

const initial = {
  started: false,
  ended: false,
  tick: 0,
  durationTicks: 1800,
  stars: 0,
  percent: 0,
  remaining: { troops: {}, spells: {}, heroes: {}, siege: {}, reinforcements: false },
  heroAbility: {},
  selection: null as Selection,
  speed: 1,
  paused: false,
  invalidAt: 0,
  result: null,
};

export const useBattleHud = create<BattleHud>((set) => ({
  ...initial,
  set: (p) => set(p),
  reset: () => set({ ...initial }),
}));

/** Live link between the Phaser battle scene and React (commands recorded so far, actions). */
export const battleBridge = {
  commands: [] as Command[],
  activateAbility: null as ((heroId: string) => void) | null,
  surrender: null as (() => void) | null,
  restartReplay: null as (() => void) | null,
};
