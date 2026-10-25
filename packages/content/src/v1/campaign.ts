import type { CampaignBase, PlacedBuilding } from '../types.ts';

/** Perimeter wall tiles of the square [x0, x1] x [y0, y1] (inclusive). */
export function wallRing(x0: number, y0: number, x1: number, y1: number, level: number): PlacedBuilding[] {
  const walls: PlacedBuilding[] = [];
  for (let x = x0; x <= x1; x++) {
    walls.push({ defId: 'wall', level, x, y: y0 });
    walls.push({ defId: 'wall', level, x, y: y1 });
  }
  for (let y = y0 + 1; y < y1; y++) {
    walls.push({ defId: 'wall', level, x: x0, y });
    walls.push({ defId: 'wall', level, x: x1, y });
  }
  return walls;
}

export const campaign: CampaignBase[] = [
  {
    id: 'c01_bandit_camp',
    order: 1,
    name: 'Bandit Camp',
    description: 'A lone Boltcaster guards a ramshackle camp. Overwhelm it with Squires.',
    hqLevel: 1,
    reinforcements: [],
    starRewards: [{ gold: 300 }, { essence: 200 }, { gold: 400 }],
    buildings: [
      { defId: 'headquarters', level: 1, x: 20, y: 20 },
      { defId: 'bolt_thrower', level: 1, x: 15, y: 21 },
      { defId: 'treasury', level: 1, x: 25, y: 20 },
      { defId: 'army_camp', level: 1, x: 20, y: 26 },
    ],
  },
  {
    id: 'c02_riverside_watch',
    order: 2,
    name: 'Riverside Watch',
    description: 'A Hawk Roost covers the camp. Fletchers can outrange the Boltcasters.',
    hqLevel: 1,
    reinforcements: [],
    starRewards: [{ gold: 500 }, { essence: 300 }, { gold: 600 }],
    buildings: [
      { defId: 'headquarters', level: 1, x: 20, y: 20 },
      { defId: 'bolt_thrower', level: 1, x: 15, y: 18 },
      { defId: 'bolt_thrower', level: 1, x: 26, y: 23 },
      { defId: 'watchtower', level: 1, x: 20, y: 15 },
      { defId: 'treasury', level: 2, x: 15, y: 24 },
      { defId: 'barracks', level: 1, x: 25, y: 17 },
      { defId: 'army_camp', level: 1, x: 20, y: 26 },
    ],
  },
  {
    id: 'c03_stone_ford',
    order: 3,
    name: 'Stone Ford',
    description: 'Walls ring the Keep. Send Ironhides at the defences or Thunderclap the gap.',
    hqLevel: 2,
    reinforcements: [],
    starRewards: [{ gold: 800 }, { essence: 500 }, { gold: 1000 }],
    buildings: [
      { defId: 'headquarters', level: 2, x: 20, y: 20 },
      ...wallRing(19, 19, 24, 24, 1),
      { defId: 'bolt_thrower', level: 2, x: 14, y: 20 },
      { defId: 'bolt_thrower', level: 2, x: 27, y: 20 },
      { defId: 'watchtower', level: 2, x: 20, y: 14 },
      { defId: 'treasury', level: 3, x: 20, y: 27 },
      { defId: 'research_library', level: 1, x: 14, y: 26 },
      { defId: 'army_camp', level: 1, x: 26, y: 26 },
    ],
  },
];

// Each pair introduces or tests the tactical choices at its HQ tier. Positions
// deliberately leave four deployable edges and preserve space around the core.
const chapters: {
  slug: string;
  name: string;
  hq: number;
  description: string;
  defenses: PlacedBuilding['defId'][];
  gap?: boolean;
}[] = [
  {
    slug: 'split_watch',
    name: 'Split Watch',
    hq: 2,
    description: 'Two approaches divide the guards. Split your army or concentrate behind tanks.',
    defenses: ['bolt_thrower', 'watchtower', 'bolt_thrower'],
    gap: true,
  },
  {
    slug: 'quarry',
    name: 'Ash Quarry',
    hq: 3,
    description: 'Boulder Lobber splash punishes clustered troops. Stagger your deployment.',
    defenses: ['catapult', 'bolt_thrower', 'watchtower'],
  },
  {
    slug: 'sapper_pass',
    name: 'Sapper Pass',
    hq: 3,
    description: 'Mines protect the walled core. Open a route before sending your main force.',
    defenses: ['catapult', 'watchtower', 'bolt_thrower', 'bolt_thrower'],
  },
  {
    slug: 'sky_gate',
    name: 'Sky Gate',
    hq: 4,
    description: 'Glidewings bypass walls, but the Sky Harpoon must fall first.',
    defenses: ['skyspear', 'watchtower', 'bolt_thrower', 'catapult'],
  },
  {
    slug: 'spring_garden',
    name: 'Spring Garden',
    hq: 4,
    description: 'Bounce Plates guard the direct approach. Scout with a small vanguard.',
    defenses: ['catapult', 'skyspear', 'watchtower', 'bolt_thrower'],
    gap: true,
  },
  {
    slug: 'arcane_crossing',
    name: 'Arcane Crossing',
    hq: 5,
    description: 'The Runeglass Spire attacks ground and air. Tanks and healing buy time.',
    defenses: ['arcane_spire', 'skyspear', 'catapult', 'watchtower', 'bolt_thrower'],
  },
  {
    slug: 'warlords_test',
    name: 'Brannoc’s Test',
    hq: 5,
    description: 'Reinforcements defend the core. Save your hero ability for their arrival.',
    defenses: ['arcane_spire', 'catapult', 'skyspear', 'watchtower', 'bolt_thrower'],
  },
  {
    slug: 'frost_harbour',
    name: 'Frost Harbour',
    hq: 6,
    description: 'Freeze the air defence while Skybarges approach.',
    defenses: ['skyspear', 'skyspear', 'arcane_spire', 'catapult', 'watchtower', 'bolt_thrower'],
  },
  {
    slug: 'divided_ridge',
    name: 'Divided Ridge',
    hq: 6,
    description: 'Separate batteries make spell placement matter. Choose which wing to neutralise.',
    defenses: ['catapult', 'arcane_spire', 'skyspear', 'watchtower', 'bolt_thrower', 'skyspear'],
    gap: true,
  },
  {
    slug: 'storm_hollow',
    name: 'Storm Hollow',
    hq: 7,
    description: 'Hidden Stormcaller Totems ambush tanks. Keep support troops close.',
    defenses: ['storm_totem', 'storm_totem', 'skyspear', 'catapult', 'arcane_spire', 'watchtower'],
  },
  {
    slug: 'ram_rampart',
    name: 'Ram Rampart',
    hq: 7,
    description: 'A deep core invites a Gatebreaker. Choose when to release its reinforcements.',
    defenses: ['storm_totem', 'arcane_spire', 'catapult', 'skyspear', 'watchtower', 'bolt_thrower'],
  },
  {
    slug: 'repeater_bastion',
    name: 'Arbalest Bastion',
    hq: 8,
    description: 'Rattle Arbalests cut through light units. Protect damage dealers behind tanks.',
    defenses: ['repeater', 'repeater', 'storm_totem', 'arcane_spire', 'catapult', 'skyspear', 'watchtower'],
  },
  {
    slug: 'drake_roost',
    name: 'Drake Roost',
    hq: 8,
    description: 'Air defences overlap. Elder Drakes need a planned route and well-timed protection.',
    defenses: ['skyspear', 'skyspear', 'repeater', 'arcane_spire', 'storm_totem', 'watchtower', 'catapult'],
    gap: true,
  },
  {
    slug: 'ember_citadel',
    name: 'Cinder Citadel',
    hq: 9,
    description: 'Cinder Pyres ramp damage on tanks. Freeze or overwhelm them before they charge.',
    defenses: [
      'ember_tower',
      'repeater',
      'skyspear',
      'arcane_spire',
      'storm_totem',
      'watchtower',
      'catapult',
    ],
  },
  {
    slug: 'menders_trial',
    name: 'Lightwing Trial',
    hq: 9,
    description: 'Sustained damage tests a healing army. Keep Lightwings away from Sky Harpoons.',
    defenses: [
      'repeater',
      'ember_tower',
      'arcane_spire',
      'catapult',
      'storm_totem',
      'skyspear',
      'watchtower',
    ],
  },
  {
    slug: 'bone_march',
    name: 'Bone March',
    hq: 10,
    description: 'Bonecallers replenish the vanguard. Clear splash defences to keep their Rattlebones alive.',
    defenses: [
      'catapult',
      'arcane_spire',
      'ember_tower',
      'repeater',
      'storm_totem',
      'skyspear',
      'watchtower',
      'bolt_thrower',
    ],
    gap: true,
  },
  {
    slug: 'crown_fortress',
    name: 'Crown Fortress',
    hq: 10,
    description: 'Every defence has a counter. Combine siege, heroes, spells and a deliberate deployment.',
    defenses: [
      'ember_tower',
      'repeater',
      'skyspear',
      'arcane_spire',
      'storm_totem',
      'catapult',
      'watchtower',
      'bolt_thrower',
    ],
  },
];
// Local level requirements keep campaign defences within their declared tier.
import { structures } from './structures.ts';
const definitions = new Map(structures.map((d) => [d.id, d]));
function availableLevel(id: PlacedBuilding['defId'], hq: number) {
  const levels = definitions.get(id)!.levels.filter((l) => l.hq <= hq);
  return levels[levels.length - 1]!.level;
}
for (const [index, c] of chapters.entries()) {
  const order = index + 4;
  const buildings: PlacedBuilding[] = [{ defId: 'headquarters', level: c.hq, x: 20, y: 20 }];
  const positions = [
    [8, 8],
    [30, 30],
    [8, 30],
    [30, 8],
    [14, 12],
    [26, 28],
    [26, 12],
    [14, 28],
  ];
  for (const [i, defId] of c.defenses.entries()) {
    const [x, y] = positions[i]!;
    buildings.push({ defId, level: availableLevel(defId, c.hq), x: x!, y: y! });
  }
  buildings.push(
    ...wallRing(18, 18, 25, 25, availableLevel('wall', c.hq)).filter(
      (b) => !c.gap || !(b.y === 18 && b.x >= 20 && b.x <= 22),
    ),
  );
  buildings.push(
    { defId: 'treasury', level: availableLevel('treasury', c.hq), x: 8, y: 20 },
    { defId: 'army_camp', level: Math.min(c.hq, 4), x: 32, y: 20 },
    { defId: 'barracks', level: Math.min(c.hq, 6), x: 20, y: 34 },
  );
  if (c.hq >= 3)
    buildings.push(
      { defId: 'clan_hall', level: 1, x: 26, y: 21 },
      { defId: 'blast_mine', level: availableLevel('blast_mine', c.hq), x: 12, y: 6 },
    );
  if (c.hq >= 4)
    buildings.push({ defId: 'spring_snare', level: availableLevel('spring_snare', c.hq), x: 22, y: 17 });
  if (c.hq >= 5) buildings.push({ defId: 'sky_mine', level: availableLevel('sky_mine', c.hq), x: 28, y: 6 });
  if (c.hq >= 8)
    buildings.push({ defId: 'seeker_mine', level: availableLevel('seeker_mine', c.hq), x: 35, y: 17 });
  campaign.push({
    id: `c${String(order).padStart(2, '0')}_${c.slug}`,
    order,
    name: c.name,
    description: c.description,
    hqLevel: c.hq,
    buildings,
    reinforcements:
      c.hq >= 5
        ? [
            {
              unitId: c.hq >= 9 ? 'mage' : 'archer',
              level: Math.min(3, Math.floor(c.hq / 3)),
              count: c.hq >= 9 ? 2 : 5,
            },
          ]
        : [],
    starRewards: [{ gold: order * 400 }, { essence: order * 250 }, { gold: order * 500 }],
  });
}
