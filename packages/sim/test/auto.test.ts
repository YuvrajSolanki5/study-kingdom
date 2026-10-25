import { describe, expect, it } from 'vitest';
import { autoPlan, runBattle, validateCommands, type AttackerArmy } from '../src/index.ts';
import { campaignSetup, content } from './helpers.ts';

const full: Partial<AttackerArmy> = {
  troops: [
    { id: 'bulwark', level: 3, count: 6 },
    { id: 'sapper', level: 3, count: 4 },
    { id: 'archer', level: 3, count: 40 },
    { id: 'mage', level: 3, count: 4 },
    { id: 'mender', level: 2, count: 2 },
  ],
  spells: [
    { id: 'thunder', level: 1, count: 2 },
    { id: 'fury', level: 1, count: 1 },
    { id: 'mending', level: 1, count: 1 },
    { id: 'frost', level: 1, count: 1 },
    { id: 'leap', level: 1, count: 1 },
    { id: 'aegis', level: 1, count: 1 },
  ],
  heroes: [
    { id: 'warlord', level: 3, hpPercent: 100 },
    { id: 'sage', level: 3, hpPercent: 100 },
  ],
  siege: [{ id: 'battering_ram', level: 1, count: 1 }],
};

describe('autoPlan', () => {
  it('produces valid commands that deploy the whole army on every campaign base', () => {
    for (const base of content.campaign) {
      const setup = campaignSetup(base.id, full);
      const cmds = autoPlan(setup);
      expect(validateCommands(setup, cmds), base.id).toEqual({ ok: true });
      const troops = cmds.filter((c) => c.k === 'troop').length;
      expect(troops, base.id).toBe(full.troops!.reduce((s, t) => s + t.count, 0));
      expect(cmds.filter((c) => c.k === 'spell')).toHaveLength(7);
      expect(cmds.filter((c) => c.k === 'ability')).toHaveLength(2);
    }
  });

  it('is deterministic and wins the first base with the starter army', () => {
    const setup = campaignSetup(content.campaign[0]!.id, {
      troops: [{ id: 'swordsman', level: 1, count: 15 }],
    });
    expect(autoPlan(setup)).toEqual(autoPlan(setup));
    const result = runBattle(setup, autoPlan(setup));
    expect(result.stars).toBeGreaterThan(0);
  });

  it('uses reinforcements when there is no siege unit to carry them', () => {
    const setup = campaignSetup(content.campaign[0]!.id, {
      troops: [{ id: 'archer', level: 1, count: 5 }],
      reinforcements: [{ id: 'bulwark', level: 1, count: 2 }],
    });
    const cmds = autoPlan(setup);
    expect(validateCommands(setup, cmds)).toEqual({ ok: true });
    expect(cmds.some((c) => c.k === 'reinforce')).toBe(true);
  });
});
