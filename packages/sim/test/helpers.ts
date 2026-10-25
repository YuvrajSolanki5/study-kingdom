import { campaignBase, getContent, type PlacedBuilding } from '@sk/content';
import { MT, SIM_VERSION, type AttackerArmy, type BattleSetup, type Command } from '../src/index.ts';

export const content = getContent();

export function setupFrom(
  buildings: PlacedBuilding[],
  attacker: Partial<AttackerArmy>,
  seed = 12345,
): BattleSetup {
  return {
    simVersion: SIM_VERSION,
    contentVersion: content.version,
    seed,
    defender: {
      hqLevel: 1,
      buildings: buildings.map((b, id) => ({ id, ...b })),
      reinforcements: [],
    },
    attacker: { troops: [], spells: [], heroes: [], siege: [], reinforcements: [], ...attacker },
  };
}

export function campaignSetup(id: string, attacker: Partial<AttackerArmy>, seed = 12345): BattleSetup {
  return setupFrom(campaignBase(content, id).buildings, attacker, seed);
}

/** Deploys `count` troops along the top edge starting at tick t. */
export function lineDeploy(id: string, count: number, t = 0, y = 500, x0 = 15000, spacing = 400): Command[] {
  return Array.from(
    { length: count },
    (_, i) => ({ t: t + Math.floor(i / 5), k: 'troop', id, x: x0 + i * spacing, y }) as Command,
  );
}

export const tile = (v: number) => v * MT + MT / 2;
