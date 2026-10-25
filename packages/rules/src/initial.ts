import type { GameContent } from '@sk/content';
import type { PlayerAggregate, PlayerState, VillageBuilding } from './state.ts';

/** Starting village: placed so new players can start upgrading straight away. */
const STARTER: Omit<VillageBuilding, 'id'>[] = [
  { defId: 'headquarters', level: 1, x: 20, y: 20 },
  { defId: 'treasury', level: 1, x: 25, y: 20 },
  { defId: 'barracks', level: 1, x: 15, y: 20 },
  { defId: 'army_camp', level: 1, x: 20, y: 26 },
  { defId: 'bolt_thrower', level: 1, x: 20, y: 15 },
  { defId: 'builder_lodge', level: 1, x: 26, y: 25 },
  { defId: 'builder_lodge', level: 1, x: 15, y: 25 },
];

export const STARTER_ARMY = { swordsman: 15 } as const;

export function initialState(content: GameContent): PlayerState {
  const buildings = STARTER.map((b, i) => ({ id: i + 1, ...b }));
  return {
    v: 1,
    nextId: buildings.length + 1,
    buildings,
    builders: Array.from({ length: content.economy.builderCount }, () => null),
    research: null,
    levels: { troops: {}, spells: {}, siege: {} },
    heroes: {},
    army: { troops: { ...STARTER_ARMY }, spells: {}, siege: {} },
    training: { troops: [], spells: [], siege: [] },
    layouts: Array.from({ length: content.economy.savedLayoutSlots }, () => null),
    warLayout: null,
    campaign: {},
    reinforcements: [],
    activeBattle: null,
    tutorialStep: 0,
    cosmetics: [],
  };
}

export function initialAggregate(content: GameContent): PlayerAggregate {
  return {
    state: initialState(content),
    gold: content.economy.starterWallet.gold,
    essence: content.economy.starterWallet.essence,
  };
}
