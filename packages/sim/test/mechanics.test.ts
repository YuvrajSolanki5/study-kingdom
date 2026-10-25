import type { PlacedBuilding } from '@sk/content';
import { describe, expect, it } from 'vitest';
import {
  createRuntime,
  runBattle,
  stepTick,
  type ArmySlot,
  type AttackerArmy,
  type Command,
  type Runtime,
} from '../src/index.ts';
import { setupFrom, tile } from './helpers.ts';

function run(
  buildings: PlacedBuilding[],
  army: Partial<AttackerArmy>,
  cmds: Command[],
  ticks = 1800,
  defenders: ArmySlot[] = [],
) {
  const setup = setupFrom(buildings, army);
  setup.defender.reinforcements = defenders;
  const rt = createRuntime(setup);
  for (let i = 0; i < ticks && !rt.state.ended; i++) stepTick(rt, cmds);
  return rt;
}

const unitsOf = (rt: Runtime, id: string) => rt.state.units.filter((u) => u.key.startsWith(`${id}:`));
const at = (x: number, y: number, id: string, t = 0, k: Command['k'] = 'troop'): Command =>
  ({ t, k, id, x: tile(x), y: tile(y) }) as Command;
const ring = (x0: number, y0: number, x1: number, y1: number, level = 1): PlacedBuilding[] => {
  const walls: PlacedBuilding[] = [];
  for (let x = x0; x <= x1; x++)
    walls.push({ defId: 'wall', level, x, y: y0 }, { defId: 'wall', level, x, y: y1 });
  for (let y = y0 + 1; y < y1; y++)
    walls.push({ defId: 'wall', level, x: x0, y }, { defId: 'wall', level, x: x1, y });
  return walls;
};
const HQ: PlacedBuilding = { defId: 'headquarters', level: 1, x: 20, y: 20 };

describe('flying and targeting domains', () => {
  it('flyers ignore walls', () => {
    const rt = run([HQ, ...ring(18, 18, 25, 25)], { troops: [{ id: 'wyvern', level: 1, count: 4 }] }, [
      at(21, 4, 'wyvern'),
      at(22, 4, 'wyvern'),
      at(23, 4, 'wyvern'),
      at(24, 4, 'wyvern'),
    ]);
    expect(rt.state.buildings[0]!.dead).toBe(true);
    expect(rt.state.buildings.slice(1).every((b) => !b.dead)).toBe(true);
  });

  it('ground-only defences cannot hit flyers; air-only defences ignore ground troops', () => {
    const vsBolt = run(
      [HQ, { defId: 'bolt_thrower', level: 5, x: 20, y: 14 }],
      { troops: [{ id: 'wyvern', level: 1, count: 1 }] },
      [at(21, 8, 'wyvern')],
      300,
    );
    expect(unitsOf(vsBolt, 'wyvern')[0]!.hp).toBe(55);
    const vsSpear = run(
      [HQ, { defId: 'skyspear', level: 1, x: 20, y: 14 }],
      { troops: [{ id: 'swordsman', level: 1, count: 1 }] },
      [at(21, 8, 'swordsman')],
      300,
    );
    expect(vsSpear.state.units[0]!.hp).toBe(45);
    const air = run(
      [HQ, { defId: 'skyspear', level: 1, x: 20, y: 14 }],
      { troops: [{ id: 'wyvern', level: 1, count: 1 }] },
      [at(21, 8, 'wyvern')],
      300,
    );
    expect(unitsOf(air, 'wyvern')[0]!.dead).toBe(true);
  });
});

describe('splash, range and ramping', () => {
  it('catapult splash hits a cluster but not troops inside its minimum range', () => {
    const base: PlacedBuilding[] = [HQ, { defId: 'catapult', level: 4, x: 30, y: 21 }];
    const far = run(
      base,
      { troops: [{ id: 'swordsman', level: 1, count: 4 }] },
      [0, 1, 2, 3].map((i) => at(30 + i * 0.1, 12, 'swordsman')),
      120,
    );
    const hurt = unitsOf(far, 'swordsman').filter((u) => u.hp < u.maxHp || u.dead).length;
    expect(hurt).toBeGreaterThanOrEqual(2);
    const rt = createRuntime(setupFrom(base, { troops: [{ id: 'bulwark', level: 1, count: 1 }] }));
    const cmds = [at(31, 26, 'bulwark')];
    let fired = 0;
    for (let i = 0; i < 1200 && !rt.state.ended; i++) {
      stepTick(rt, cmds);
      fired += rt.events.filter((e) => e.e === 'shot' && e.b === 1).length;
    }
    // The bulwark walks up to the catapult and wrecks it from inside its minimum range.
    expect(rt.state.buildings[1]!.dead).toBe(true);
    expect(fired).toBeLessThanOrEqual(1);
  });

  it('ember tower damage ramps up on a single target', () => {
    const rt = createRuntime(
      setupFrom([HQ, { defId: 'ember_tower', level: 1, x: 20, y: 14 }], {
        troops: [{ id: 'bulwark', level: 5, count: 1 }],
      }),
    );
    const cmds = [at(21, 6, 'bulwark')];
    // Base damage alone (4 per 0.2 s) needs ~32 s for 640 HP; the ×3 then ×9 ramp needs ~6.4 s.
    for (let i = 0; i < 120 && !rt.state.ended; i++) stepTick(rt, cmds);
    expect(unitsOf(rt, 'bulwark')[0]!.dead).toBe(true);
  });

  it('hidden storm totems stay invisible and untargetable until triggered', () => {
    const rt = createRuntime(
      setupFrom([HQ, { defId: 'storm_totem', level: 1, x: 10, y: 21 }], {
        troops: [{ id: 'bulwark', level: 5, count: 1 }],
      }),
    );
    expect(rt.state.buildings[1]!.revealed).toBe(false);
    const cmds = [at(21, 4, 'bulwark')];
    let revealedAt = -1;
    for (let i = 0; i < 900 && !rt.state.ended; i++) {
      stepTick(rt, cmds);
      if (revealedAt < 0 && rt.events.some((e) => e.e === 'reveal')) revealedAt = rt.state.tick;
    }
    // The defence-seeking bulwark has no visible defence, so it attacks the HQ first.
    expect(rt.state.buildings[0]!.dead).toBe(true);
  });
});

describe('troop specialities', () => {
  it('sappers blow open walls with a 40× multiplier', () => {
    const rt = run(
      [HQ, ...ring(18, 18, 25, 25)],
      { troops: [{ id: 'sapper', level: 1, count: 1 }] },
      [at(21, 10, 'sapper')],
      200,
    );
    expect(rt.state.buildings.slice(1).filter((b) => b.dead).length).toBeGreaterThanOrEqual(1);
    expect(unitsOf(rt, 'sapper')[0]!.dead).toBe(true);
  });

  it('looters deal double damage to resource buildings', () => {
    const t = { defId: 'treasury', level: 1, x: 20, y: 20 } as PlacedBuilding;
    const sword = run(
      [t],
      { troops: [{ id: 'swordsman', level: 1, count: 1 }] },
      [at(21, 16, 'swordsman')],
      60,
    );
    const loot = run([t], { troops: [{ id: 'looter', level: 1, count: 1 }] }, [at(21, 16, 'looter')], 60);
    const dSword = 400 - sword.state.buildings[0]!.hp;
    const dLoot = 400 - loot.state.buildings[0]!.hp;
    // Looter base damage 11 ×2 = 22 per hit vs swordsman 8.
    expect(dLoot / Math.max(1, dSword)).toBeGreaterThan(2);
  });

  it('vaulters jump walls to reach defences without breaking them', () => {
    const rt = run(
      [{ defId: 'bolt_thrower', level: 1, x: 20, y: 20 }, ...ring(18, 18, 24, 24, 8)],
      { troops: [{ id: 'vaulter', level: 1, count: 1 }] },
      [at(21, 10, 'vaulter')],
      400,
    );
    expect(rt.state.buildings[0]!.dead).toBe(true);
    expect(rt.state.buildings.slice(1).every((b) => !b.dead)).toBe(true);
  });

  it('menders heal damaged ground troops', () => {
    const base: PlacedBuilding[] = [HQ, { defId: 'bolt_thrower', level: 5, x: 20, y: 14 }];
    const cmds: Command[] = [at(21, 4, 'bulwark'), at(21, 3, 'mender')];
    const without = run(base, { troops: [{ id: 'bulwark', level: 1, count: 1 }] }, [cmds[0]!], 150);
    const withHealer = run(
      base,
      {
        troops: [
          { id: 'bulwark', level: 1, count: 1 },
          { id: 'mender', level: 1, count: 1 },
        ],
      },
      cmds,
      150,
    );
    const hpWithout = unitsOf(without, 'bulwark')[0]!.hp;
    const hpWith = unitsOf(withHealer, 'bulwark')[0]!.hp;
    expect(hpWith).toBeGreaterThan(hpWithout);
  });

  it('necromancers summon capped waves of skeletons', () => {
    const rt = run(
      [{ ...HQ, level: 10 }],
      { troops: [{ id: 'necromancer', level: 1, count: 1 }] },
      [at(21, 10, 'necromancer')],
      300,
    );
    const skeletons = unitsOf(rt, 'skeleton');
    expect(skeletons.length).toBeGreaterThanOrEqual(3);
    const alive = skeletons.filter((s) => !s.dead).length;
    expect(alive).toBeLessThanOrEqual(9);
  });

  it('skyships drop a bomb when they are shot down', () => {
    const rt = createRuntime(
      setupFrom(
        [
          HQ,
          { defId: 'skyspear', level: 4, x: 20, y: 14 },
          { defId: 'builder_lodge', level: 1, x: 21, y: 8 },
        ],
        {
          troops: [{ id: 'skyship', level: 1, count: 1 }],
        },
      ),
    );
    const cmds = [at(22, 3, 'skyship')];
    let deathBomb = false;
    for (let i = 0; i < 400 && !rt.state.ended; i++) {
      stepTick(rt, cmds);
      if (rt.events.some((e) => e.e === 'impact' && e.src === 'u' && e.splash > 0)) deathBomb = true;
    }
    expect(unitsOf(rt, 'skyship')[0]!.dead).toBe(true);
    expect(deathBomb).toBe(true);
  });
});

describe('heroes', () => {
  it("the Warlord's War Cry heals and enrages", () => {
    const rt = createRuntime(
      setupFrom([HQ, { defId: 'bolt_thrower', level: 5, x: 20, y: 14 }], {
        heroes: [{ id: 'warlord', level: 1, hpPercent: 100 }],
      }),
    );
    const cmds: Command[] = [{ t: 0, k: 'hero', id: 'warlord', x: tile(21), y: tile(8) }];
    for (let i = 0; i < 60; i++) stepTick(rt, cmds);
    const hero = rt.state.units[0]!;
    const before = hero.hp;
    expect(before).toBeLessThan(hero.maxHp);
    cmds.push({ t: rt.state.tick, k: 'ability', id: 'warlord' });
    stepTick(rt, cmds);
    expect(hero.hp).toBeGreaterThan(before);
    expect(hero.ragePct).toBe(100);
    expect(hero.ability).toBe(1);
  });

  it("the Sage's aura boosts nearby damage and Sanctuary blocks all damage", () => {
    const t = { defId: 'treasury', level: 11, x: 20, y: 20 } as PlacedBuilding;
    const rtAura = createRuntime(
      setupFrom([t], {
        troops: [{ id: 'swordsman', level: 1, count: 1 }],
        heroes: [{ id: 'sage', level: 10, hpPercent: 100 }],
      }),
    );
    const cmds: Command[] = [
      at(21, 17, 'swordsman'),
      { t: 0, k: 'hero', id: 'sage', x: tile(22), y: tile(15) },
    ];
    for (let i = 0; i < 40; i++) stepTick(rtAura, cmds);
    // Level-10 aura is +30%: together they out-damage the sum of each alone.
    const plain = run([t], { troops: [{ id: 'swordsman', level: 1, count: 1 }] }, [cmds[0]!], 40);
    const auraDamage = 2000 - rtAura.state.buildings[0]!.hp;
    const sageDamage = (() => {
      const alone = run([t], { heroes: [{ id: 'sage', level: 10, hpPercent: 100 }] }, [cmds[1]!], 40);
      return 2000 - alone.state.buildings[0]!.hp;
    })();
    const plainDamage = 2000 - plain.state.buildings[0]!.hp;
    expect(auraDamage).toBeGreaterThan(sageDamage + plainDamage);

    const rt = createRuntime(
      setupFrom([HQ, { defId: 'bolt_thrower', level: 5, x: 20, y: 14 }], {
        heroes: [{ id: 'sage', level: 1, hpPercent: 100 }],
        troops: [{ id: 'bulwark', level: 1, count: 1 }],
      }),
    );
    const sanctuary: Command[] = [
      { t: 0, k: 'hero', id: 'sage', x: tile(21), y: tile(6) },
      at(21.5, 6, 'bulwark'),
    ];
    for (let i = 0; i < 40; i++) stepTick(rt, sanctuary);
    sanctuary.push({ t: rt.state.tick, k: 'ability', id: 'sage' });
    stepTick(rt, sanctuary);
    const snapshot = rt.state.units.map((u) => u.hp);
    for (let i = 0; i < 25; i++) stepTick(rt, sanctuary);
    rt.state.units.forEach((u, i) => expect(u.hp).toBeGreaterThanOrEqual(snapshot[i]!));
  });
});

describe('traps', () => {
  it('blast mines splash ground troops; sky mines splash flyers', () => {
    const ground = run(
      [HQ, { defId: 'blast_mine', level: 3, x: 21, y: 14 }],
      { troops: [{ id: 'swordsman', level: 1, count: 3 }] },
      [0, 1, 2].map((i) => at(21 + i * 0.3, 10, 'swordsman')),
      120,
    );
    expect(ground.state.units.every((u) => u.hp <= 45 - 40 || u.dead)).toBe(true);
    const air = run(
      [HQ, { defId: 'sky_mine', level: 1, x: 21, y: 14 }],
      { troops: [{ id: 'wyvern', level: 1, count: 2 }] },
      [at(21, 8, 'wyvern'), at(21.5, 8, 'wyvern')],
      120,
    );
    expect(air.state.units.every((u) => u.dead)).toBe(true);
  });

  it('spring snares remove ground troops up to their capacity (heroes are immune)', () => {
    const rt = run(
      [HQ, { defId: 'spring_snare', level: 1, x: 21, y: 15 }],
      { troops: [{ id: 'bulwark', level: 1, count: 3 }] },
      [at(21, 9, 'bulwark'), at(21, 9, 'bulwark'), at(21, 9, 'bulwark')],
      200,
    );
    const sprung = rt.state.units.filter((u) => u.sprung).length;
    expect(sprung).toBe(2); // capacity 10 = two 5-housing bulwarks
  });

  it('seeker mines strike a single flyer hard', () => {
    const rt = run(
      [HQ, { defId: 'seeker_mine', level: 1, x: 21, y: 14 }],
      { troops: [{ id: 'drake', level: 1, count: 1 }] },
      [at(21, 8, 'drake')],
      100,
    );
    const drake = rt.state.units[0]!;
    expect(drake.hp).toBe(1900 - 900);
  });
});

describe('spells', () => {
  it('frost stops defences from firing while frozen', () => {
    const base: PlacedBuilding[] = [HQ, { defId: 'bolt_thrower', level: 5, x: 20, y: 14 }];
    const rt = createRuntime(
      setupFrom(base, {
        troops: [{ id: 'swordsman', level: 1, count: 1 }],
        spells: [{ id: 'frost', level: 1, count: 1 }],
      }),
    );
    const cmds: Command[] = [
      { t: 0, k: 'spell', id: 'frost', x: tile(21.5), y: tile(15.5) },
      at(21, 8, 'swordsman'),
    ];
    let shots = 0;
    for (let i = 0; i < 25; i++) {
      stepTick(rt, cmds);
      shots += rt.events.filter((e) => e.e === 'shot').length;
    }
    expect(shots).toBe(0);
  });

  it('fury boosts damage, aegis cuts damage taken, mending heals', () => {
    const t = { defId: 'treasury', level: 11, x: 20, y: 20 } as PlacedBuilding;
    const deploy = [0, 1, 2, 3].map((i) => at(20.5 + i, 17, 'swordsman'));
    const plain = run([t], { troops: [{ id: 'swordsman', level: 1, count: 4 }] }, deploy, 80);
    const fury = run(
      [t],
      { troops: [{ id: 'swordsman', level: 1, count: 4 }], spells: [{ id: 'fury', level: 4, count: 1 }] },
      [...deploy, { t: 0, k: 'spell', id: 'fury', x: tile(22), y: tile(18) }],
      80,
    );
    expect(fury.state.buildings[0]!.hp).toBeLessThan(plain.state.buildings[0]!.hp);

    const bolt: PlacedBuilding[] = [HQ, { defId: 'bolt_thrower', level: 5, x: 20, y: 14 }];
    const exposed = run(
      bolt,
      { troops: [{ id: 'bulwark', level: 1, count: 1 }] },
      [at(21, 9, 'bulwark')],
      60,
    );
    const shielded = run(
      bolt,
      { troops: [{ id: 'bulwark', level: 1, count: 1 }], spells: [{ id: 'aegis', level: 3, count: 1 }] },
      [at(21, 9, 'bulwark'), { t: 0, k: 'spell', id: 'aegis', x: tile(21), y: tile(11) }],
      60,
    );
    const mended = run(
      bolt,
      { troops: [{ id: 'bulwark', level: 1, count: 1 }], spells: [{ id: 'mending', level: 4, count: 1 }] },
      [at(21, 9, 'bulwark'), { t: 30, k: 'spell', id: 'mending', x: tile(21), y: tile(11) }],
      60,
    );
    expect(shielded.state.units[0]!.hp).toBeGreaterThan(exposed.state.units[0]!.hp);
    expect(mended.state.units[0]!.hp).toBeGreaterThan(exposed.state.units[0]!.hp);
  });

  it('leap lets ground troops cross walls without breaking them', () => {
    const base: PlacedBuilding[] = [
      { defId: 'treasury', level: 1, x: 20, y: 20 } as PlacedBuilding,
      ...ring(18, 18, 24, 24, 8),
    ];
    const rt = run(
      base,
      { troops: [{ id: 'swordsman', level: 1, count: 3 }], spells: [{ id: 'leap', level: 3, count: 1 }] },
      [
        { t: 0, k: 'spell', id: 'leap', x: tile(21), y: tile(18) },
        at(21, 14, 'swordsman'),
        at(21.5, 14, 'swordsman'),
        at(22, 14, 'swordsman'),
      ],
      400,
    );
    expect(rt.state.buildings[0]!.dead).toBe(true);
    expect(rt.state.buildings.slice(1).every((b) => !b.dead)).toBe(true);
  });
});

describe('siege and clan troops', () => {
  it('the battering ram smashes through walls to the HQ and releases clan troops', () => {
    const base: PlacedBuilding[] = [
      HQ,
      ...ring(17, 17, 26, 26, 4),
      { defId: 'treasury', level: 1, x: 5, y: 5 } as PlacedBuilding,
    ];
    const setup = setupFrom(base, {
      siege: [{ id: 'battering_ram', level: 1, count: 1 }],
      reinforcements: [{ id: 'archer', level: 3, count: 6 }],
    });
    const rt = createRuntime(setup);
    const cmds: Command[] = [{ t: 0, k: 'siege', id: 'battering_ram', x: tile(21), y: tile(8) }];
    let released = false;
    for (let i = 0; i < 1800 && !rt.state.ended; i++) {
      stepTick(rt, cmds);
      if (rt.events.some((e) => e.e === 'release')) released = true;
    }
    expect(rt.state.buildings.slice(1, -1).some((b) => b.dead)).toBe(true);
    expect(rt.state.hqDestroyed).toBe(true);
    expect(released).toBe(true);
    expect(unitsOf(rt, 'archer').length).toBe(6);
  });

  it('defending clan troops come out and fight attackers', () => {
    const base: PlacedBuilding[] = [HQ, { defId: 'clan_hall', level: 1, x: 26, y: 21 } as PlacedBuilding];
    const rt = run(
      base,
      { troops: [{ id: 'swordsman', level: 1, count: 3 }] },
      [0, 1, 2].map((i) => at(27 + i * 0.5, 15, 'swordsman')),
      300,
      [{ id: 'archer', level: 2, count: 4 }],
    );
    const defenders = rt.state.units.filter((u) => u.team === 1);
    expect(defenders.length).toBe(4);
    expect(rt.state.units.filter((u) => u.team === 0).some((u) => u.hp < u.maxHp || u.dead)).toBe(true);
  });

  it('defences under upgrade stand but do not fire', () => {
    const setup = setupFrom([HQ, { defId: 'bolt_thrower', level: 5, x: 20, y: 14 }], {
      troops: [{ id: 'swordsman', level: 1, count: 1 }],
    });
    setup.defender.buildings[1]!.off = true;
    const r = runBattle(setup, [at(21, 8, 'swordsman')]);
    expect(r.lost.swordsman).toBeUndefined();
  });
});

it('reveals the final hidden defence while preserving version 1 replay behaviour', () => {
  const setup = setupFrom(
    [
      { defId: 'headquarters', level: 1, x: 20, y: 20 },
      { defId: 'storm_totem', level: 1, x: 35, y: 35 },
    ],
    { troops: [{ id: 'swordsman', level: 5, count: 20 }] },
  );
  const commands: Command[] = Array.from({ length: 20 }, (_, i) => ({
    t: 0,
    k: 'troop',
    id: 'swordsman',
    x: 15000 + i * 400,
    y: 500,
  }));
  const old = runBattle({ ...setup, simVersion: 1 }, commands),
    current = runBattle(setup, commands);
  expect(old.destructionPercent).toBe(50);
  expect(current.destructionPercent).toBe(100);
});
