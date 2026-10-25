import { getContent } from '../packages/content/src/index.ts';
import {
  runBattle,
  SIM_VERSION,
  validateCommands,
  type BattleSetup,
  type Command,
} from '../packages/sim/src/index.ts';
const c = getContent();
const armies = {
  ground: [
    ['bulwark', 18],
    ['archer', 60],
    ['mage', 6],
    ['mender', 2],
    ['necromancer', 1],
  ],
  air: [
    ['drake', 5],
    ['wyvern', 20],
    ['skyship', 8],
    ['archer', 40],
  ],
  summoning: [
    ['bulwark', 8],
    ['archer', 60],
    ['mender', 3],
    ['necromancer', 6],
  ],
} as const;
const results = [];
for (const [name, composition] of Object.entries(armies))
  for (const base of c.campaign.filter((b) => b.hqLevel >= 8)) {
    const setup: BattleSetup = {
      simVersion: SIM_VERSION,
      contentVersion: c.version,
      seed: 4242,
      defender: {
        hqLevel: base.hqLevel,
        buildings: base.buildings.map((b, id) => ({ id, ...b })),
        reinforcements: base.reinforcements.map((r) => ({ id: r.unitId, level: r.level, count: r.count })),
      },
      attacker: {
        troops: composition.map(([id, count]) => ({ id, count, level: c.troops[id]!.levels.length })),
        spells: ['thunder', 'mending', 'fury', 'frost'].map((id) => ({
          id,
          level: c.spells[id]!.levels.length,
          count: 1,
        })),
        heroes: ['warlord', 'sage'].map((id) => ({ id, level: 10, hpPercent: 100 })),
        siege: [{ id: 'battering_ram', level: 3, count: 1 }],
        reinforcements: [{ id: 'bulwark', level: 5, count: 4 }],
      },
    };
    const commands: Command[] = [];
    let n = 0;
    for (const t of setup.attacker.troops)
      for (let i = 0; i < t.count; i++, n++)
        commands.push({ t: Math.floor(n / 6), k: 'troop', id: t.id, x: 7000 + (n % 60) * 500, y: 500 });
    commands.push(
      { t: 0, k: 'siege', id: 'battering_ram', x: 21500, y: 500 },
      { t: 1, k: 'hero', id: 'warlord', x: 20500, y: 500 },
      { t: 2, k: 'hero', id: 'sage', x: 22500, y: 500 },
      { t: 100, k: 'spell', id: 'thunder', x: 21000, y: 21000 },
      { t: 110, k: 'spell', id: 'fury', x: 21000, y: 17000 },
      { t: 120, k: 'spell', id: 'mending', x: 21000, y: 18000 },
      { t: 130, k: 'spell', id: 'frost', x: 30000, y: 30000 },
      { t: 140, k: 'ability', id: 'warlord' },
      { t: 141, k: 'ability', id: 'sage' },
    );
    commands.sort((a, b) => a.t - b.t);
    const check = validateCommands(setup, commands);
    if (!check.ok) throw new Error(check.error);
    const r = runBattle(setup, commands);
    results.push({
      army: name,
      base: base.name,
      stars: r.stars,
      destruction: r.destructionPercent,
      ticks: r.ticks,
    });
  }
if (process.argv.includes('--json')) console.log(JSON.stringify(results, null, 2));
else console.table(results);
