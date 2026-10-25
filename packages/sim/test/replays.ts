import { getContent, DEFENSE_IDS, TRAP_IDS } from '@sk/content';
import { type BattleSetup, type Command } from '../src/index.ts';

/** Pinned inputs shared by golden tests, browsers, Edge tests and benchmarks. */
export function replayCases(simVersion = 1): { name: string; setup: BattleSetup; commands: Command[] }[] {
  const content = getContent('1');
  const cases = content.campaign.slice(0, 3).map((base) => ({
    name: base.id,
    setup: {
      simVersion,
      contentVersion: content.version,
      seed: 4242,
      defender: {
        hqLevel: base.hqLevel,
        buildings: base.buildings.map((b, id) => ({ id, ...b })),
        reinforcements: [],
      },
      attacker: {
        troops: [{ id: 'swordsman', level: 1, count: 20 }],
        spells: [],
        heroes: [],
        siege: [],
        reinforcements: [],
      },
    } as BattleSetup,
    commands: Array.from({ length: 20 }, (_, i): Command => ({
      t: Math.floor(i / 5),
      k: 'troop',
      id: 'swordsman',
      x: 15000 + i * 400,
      y: 500,
    })),
  }));
  const setup: BattleSetup = {
    simVersion,
    contentVersion: content.version,
    seed: 0xfedcba98,
    defender: {
      hqLevel: 10,
      buildings: [
        { id: 0, defId: 'headquarters', level: 10, x: 20, y: 20 },
        ...DEFENSE_IDS.map((defId, i) => ({
          id: i + 1,
          defId,
          level: content.structures[defId]!.levels.length,
          x: 8 + (i % 4) * 8,
          y: 12 + Math.floor(i / 4) * 16,
        })),
        ...TRAP_IDS.map((defId, i) => ({ id: i + 20, defId, level: 1, x: 10 + i * 7, y: 7 })),
        ...Array.from({ length: 30 }, (_, i) => ({ id: i + 30, defId: 'wall', level: 8, x: 7 + i, y: 18 })),
        { id: 100, defId: 'clan_hall', level: 1, x: 26, y: 21 },
      ],
      reinforcements: [{ id: 'archer', level: 3, count: 10 }],
    },
    attacker: {
      troops: [
        { id: 'swordsman', level: 5, count: 80 },
        { id: 'archer', level: 5, count: 40 },
        { id: 'necromancer', level: 3, count: 2 },
        { id: 'drake', level: 3, count: 2 },
        { id: 'mender', level: 3, count: 2 },
      ],
      spells: [
        { id: 'thunder', level: 3, count: 1 },
        { id: 'fury', level: 3, count: 1 },
        { id: 'mending', level: 3, count: 1 },
      ],
      heroes: [
        { id: 'warlord', level: 10, hpPercent: 100 },
        { id: 'sage', level: 10, hpPercent: 100 },
      ],
      siege: [{ id: 'battering_ram', level: 3, count: 1 }],
      reinforcements: [{ id: 'bulwark', level: 3, count: 4 }],
    },
  };
  const commands: Command[] = [];
  let n = 0;
  for (const slot of setup.attacker.troops)
    for (let i = 0; i < slot.count; i++, n++)
      commands.push({ t: Math.floor(n / 8), k: 'troop', id: slot.id, x: 5000 + (n % 80) * 400, y: 500 });
  commands.push(
    { t: 1, k: 'hero', id: 'warlord', x: 18000, y: 500 },
    { t: 2, k: 'hero', id: 'sage', x: 19000, y: 500 },
    { t: 3, k: 'siege', id: 'battering_ram', x: 21000, y: 500 },
    { t: 100, k: 'spell', id: 'thunder', x: 20000, y: 21000 },
    { t: 110, k: 'spell', id: 'fury', x: 18000, y: 12000 },
    { t: 120, k: 'spell', id: 'mending', x: 18000, y: 12000 },
    { t: 130, k: 'ability', id: 'warlord' },
    { t: 131, k: 'ability', id: 'sage' },
  );
  commands.sort((a, b) => a.t - b.t);
  return [...cases, { name: 'hq10_combined_arms', setup, commands }];
}
