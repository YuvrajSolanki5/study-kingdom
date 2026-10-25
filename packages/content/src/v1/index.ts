import type { GameContent } from '../types.ts';
import { campaign } from './campaign.ts';
import { economy, hqTiers } from './progression.ts';
import { structures } from './structures.ts';
import { heroes, siege, spells, troops } from './units.ts';

function byId<T extends { id: string }>(items: T[]): Record<string, T> {
  const out: Record<string, T> = {};
  for (const item of items) out[item.id] = item;
  return out;
}

export const contentV1: GameContent = {
  version: '1',
  maxHq: hqTiers.length,
  map: { size: 44, buildMin: 2, buildMax: 42 },
  structures: byId(structures),
  troops: byId(troops),
  spells: byId(spells),
  heroes: byId(heroes),
  siege: byId(siege),
  hqTiers,
  economy,
  campaign,
};
