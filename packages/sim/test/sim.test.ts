import { describe, expect, it } from 'vitest';
import {
  createRuntime,
  runBattle,
  runBattleChunk,
  stepTick,
  validateCommands,
  type Command,
  type SimState,
} from '../src/index.ts';
import { campaignSetup, lineDeploy, setupFrom, tile } from './helpers.ts';

describe('determinism', () => {
  it('produces identical results for identical inputs', () => {
    const setup = campaignSetup('c02_riverside_watch', {
      troops: [
        { id: 'swordsman', level: 1, count: 15 },
        { id: 'archer', level: 1, count: 10 },
      ],
    });
    const cmds = [...lineDeploy('swordsman', 15), ...lineDeploy('archer', 10, 20)];
    const a = runBattle(setup, cmds);
    const b = runBattle(setup, cmds);
    expect(a).toEqual(b);
    expect(a.ticks).toBeGreaterThan(0);
  });

  it('chunked verification matches an uninterrupted run', () => {
    const setup = campaignSetup('c03_stone_ford', {
      troops: [
        { id: 'swordsman', level: 2, count: 20 },
        { id: 'archer', level: 2, count: 20 },
        { id: 'bulwark', level: 1, count: 4 },
      ],
      spells: [{ id: 'thunder', level: 1, count: 1 }],
    });
    const cmds: Command[] = [
      ...lineDeploy('bulwark', 4),
      ...lineDeploy('swordsman', 20, 30),
      ...lineDeploy('archer', 20, 40),
      { t: 120, k: 'spell', id: 'thunder', x: tile(21), y: tile(21) },
    ];
    const full = runBattle(setup, cmds);
    let state: SimState | null = null;
    let chunks = 0;
    for (;;) {
      const r = runBattleChunk(setup, cmds, state, 2000);
      chunks++;
      // Round-trip through JSON exactly as a stored checkpoint would.
      state = JSON.parse(JSON.stringify(r.state)) as SimState;
      if (r.done) {
        expect(r.result).toEqual(full);
        break;
      }
      expect(chunks).toBeLessThan(500);
    }
    expect(chunks).toBeGreaterThan(1);
  });

  it('different seeds can change thunder strike placement but not validity', () => {
    const setup = campaignSetup('c01_bandit_camp', {
      spells: [{ id: 'thunder', level: 1, count: 1 }],
      troops: [{ id: 'swordsman', level: 1, count: 1 }],
    });
    const cmds: Command[] = [{ t: 0, k: 'spell', id: 'thunder', x: tile(16), y: tile(22) }];
    const r1 = runBattle(setup, cmds);
    const r2 = runBattle({ ...setup, seed: 999 }, cmds);
    expect(r1.ticks).toBeGreaterThan(0);
    expect(r2.ticks).toBeGreaterThan(0);
  });
});

describe('combat outcomes', () => {
  it('swordsmen clear the first campaign base for three stars', () => {
    const setup = campaignSetup('c01_bandit_camp', { troops: [{ id: 'swordsman', level: 1, count: 20 }] });
    const r = runBattle(setup, lineDeploy('swordsman', 20));
    expect(r.stars).toBe(3);
    expect(r.destructionPercent).toBe(100);
    expect(r.endReason).toBe('destroyed');
  });

  it('a lone swordsman loses to a bolt thrower', () => {
    const setup = setupFrom(
      [
        { defId: 'headquarters', level: 1, x: 20, y: 20 },
        { defId: 'bolt_thrower', level: 3, x: 20, y: 12 },
      ],
      { troops: [{ id: 'swordsman', level: 1, count: 1 }] },
    );
    const r = runBattle(setup, [{ t: 0, k: 'troop', id: 'swordsman', x: tile(21), y: tile(5) }]);
    expect(r.endReason).toBe('army');
    expect(r.lost.swordsman).toBe(1);
    expect(r.stars).toBe(0);
  });

  it('archers outrange melee reach and attack from a distance', () => {
    const setup = setupFrom([{ defId: 'treasury', level: 1, x: 20, y: 20 }], {
      troops: [{ id: 'archer', level: 1, count: 1 }],
    });
    const rt = createRuntime(setup);
    const cmds: Command[] = [{ t: 0, k: 'troop', id: 'archer', x: tile(21), y: tile(5) }];
    let firstAttackY = -1;
    while (!rt.state.ended) {
      stepTick(rt, cmds);
      if (firstAttackY < 0 && rt.events.some((e) => e.e === 'swing')) firstAttackY = rt.state.units[0].y;
    }
    // Footprint starts at y=20; archer range 3.5 + reach slack 0.6 means it stops ~4 tiles away.
    expect(firstAttackY).toBeGreaterThan(15000);
    expect(firstAttackY).toBeLessThan(16500);
  });

  it('bulwarks ignore non-defences while defences stand', () => {
    const setup = setupFrom(
      [
        { defId: 'treasury', level: 1, x: 20, y: 8 },
        { defId: 'bolt_thrower', level: 1, x: 20, y: 30 },
      ],
      { troops: [{ id: 'bulwark', level: 1, count: 1 }] },
    );
    const rt = createRuntime(setup);
    const cmds: Command[] = [{ t: 0, k: 'troop', id: 'bulwark', x: tile(21), y: tile(4) }];
    stepTick(rt, cmds);
    stepTick(rt, cmds);
    expect(rt.state.units[0].tg).toBe(1);
  });

  it('enclosed targets force ground troops through walls', () => {
    const walls = [];
    for (let x = 18; x <= 25; x++) {
      walls.push(
        { defId: 'wall' as const, level: 1, x, y: 18 },
        { defId: 'wall' as const, level: 1, x, y: 25 },
      );
    }
    for (let y = 19; y <= 24; y++) {
      walls.push(
        { defId: 'wall' as const, level: 1, x: 18, y },
        { defId: 'wall' as const, level: 1, x: 25, y },
      );
    }
    const setup = setupFrom([{ defId: 'headquarters', level: 1, x: 20, y: 20 }, ...walls], {
      troops: [{ id: 'swordsman', level: 1, count: 10 }],
    });
    const r = runBattle(setup, lineDeploy('swordsman', 10, 0, tile(5), tile(19)));
    expect(r.stars).toBe(3);
    // The HQ is the only counted building, so walls must have been broken to reach it.
    const rt = createRuntime(setup);
    const cmds = lineDeploy('swordsman', 10, 0, tile(5), tile(19));
    while (!rt.state.ended) stepTick(rt, cmds);
    expect(rt.state.buildings.slice(1).some((b) => b.dead)).toBe(true);
  });

  it('troops walk around a wall with a gap instead of breaking it', () => {
    const walls = [];
    // A wall line across the approach with a gap at x = 27, a short detour away.
    for (let x = 12; x <= 31; x++) if (x !== 27) walls.push({ defId: 'wall' as const, level: 3, x, y: 15 });
    const setup = setupFrom([{ defId: 'treasury', level: 1, x: 20, y: 20 }, ...walls], {
      troops: [{ id: 'swordsman', level: 1, count: 1 }],
    });
    const rt = createRuntime(setup);
    const cmds: Command[] = [{ t: 0, k: 'troop', id: 'swordsman', x: tile(25), y: tile(10) }];
    while (!rt.state.ended) stepTick(rt, cmds);
    expect(rt.state.buildings[0].dead).toBe(true);
    expect(rt.state.buildings.slice(1).every((b) => !b.dead)).toBe(true);
  });

  it('thunder damages buildings in its radius', () => {
    const setup = setupFrom(
      [
        { defId: 'headquarters', level: 1, x: 20, y: 20 },
        { defId: 'treasury', level: 1, x: 5, y: 5 },
      ],
      {
        spells: [{ id: 'thunder', level: 1, count: 1 }],
        troops: [{ id: 'swordsman', level: 1, count: 1 }],
      },
    );
    const rt = createRuntime(setup);
    const cmds: Command[] = [{ t: 0, k: 'spell', id: 'thunder', x: tile(21), y: tile(21) }];
    for (let i = 0; i < 20; i++) stepTick(rt, cmds);
    expect(rt.state.buildings[0].hp).toBe(1500 - 3 * 150);
    expect(rt.state.buildings[1].hp).toBe(400);
  });
});

describe('command validation', () => {
  const setup = campaignSetup('c01_bandit_camp', { troops: [{ id: 'swordsman', level: 1, count: 2 }] });

  it('accepts a legitimate command list', () => {
    expect(validateCommands(setup, lineDeploy('swordsman', 2))).toEqual({ ok: true });
  });

  it('rejects forged armies', () => {
    const r = validateCommands(setup, lineDeploy('swordsman', 3));
    expect(r.ok).toBe(false);
    const r2 = validateCommands(setup, [{ t: 0, k: 'troop', id: 'bulwark', x: 500, y: 500 }]);
    expect(r2.ok).toBe(false);
  });

  it('rejects deployments inside the no-deploy zone', () => {
    const r = validateCommands(setup, [{ t: 0, k: 'troop', id: 'swordsman', x: tile(21), y: tile(21) }]);
    expect(r).toMatchObject({ ok: false, error: 'inside no-deploy zone' });
    // One tile outside the HQ footprint is still inside the 1-tile margin.
    const r2 = validateCommands(setup, [{ t: 0, k: 'troop', id: 'swordsman', x: tile(19), y: tile(21) }]);
    expect(r2.ok).toBe(false);
  });

  it('rejects decreasing ticks, bad ticks and malformed input', () => {
    expect(
      validateCommands(setup, [
        { t: 5, k: 'troop', id: 'swordsman', x: 500, y: 500 },
        { t: 4, k: 'troop', id: 'swordsman', x: 500, y: 500 },
      ]).ok,
    ).toBe(false);
    expect(validateCommands(setup, [{ t: 99999, k: 'troop', id: 'swordsman', x: 500, y: 500 }]).ok).toBe(
      false,
    );
    expect(validateCommands(setup, [{ t: 0.5, k: 'troop', id: 'swordsman', x: 500, y: 500 }]).ok).toBe(false);
    expect(validateCommands(setup, 'nope').ok).toBe(false);
    expect(validateCommands(setup, [{ t: 0, k: 'troop', id: 'swordsman', x: -1, y: 500 }]).ok).toBe(false);
    expect(validateCommands(setup, [{ t: 0, k: 'explode' }]).ok).toBe(false);
  });

  it('rejects unknown sim or content versions', () => {
    expect(validateCommands({ ...setup, simVersion: 999 }, []).ok).toBe(false);
    expect(validateCommands({ ...setup, contentVersion: 'nope' }, []).ok).toBe(false);
  });
});
