import { campaignBase, getContent } from '@sk/content';
import { runBattle, SIM_VERSION, type BattleSetup, type Command } from '@sk/sim';
import { replayCases } from '../../../../packages/sim/test/replays.ts';
import { describe, expect, it } from 'vitest';
import { edgeVerifier, inlineVerifier } from '../../src/verify/verifiers.ts';

// Runs only against a served Edge Function:
//   npx supabase functions serve verify-battle --env-file supabase/functions/.env --no-verify-jwt
//   VERIFY_FUNCTION_URL=http://127.0.0.1:54321/functions/v1/verify-battle \
//   VERIFY_SHARED_SECRET=... npx vitest run --project edge
const url = process.env.VERIFY_FUNCTION_URL;
const secret = process.env.VERIFY_SHARED_SECRET ?? '';
const content = getContent();

function setup(baseId: string, troops: { id: string; level: number; count: number }[]): BattleSetup {
  const base = campaignBase(content, baseId);
  return {
    simVersion: SIM_VERSION,
    contentVersion: content.version,
    seed: 77,
    defender: {
      hqLevel: base.hqLevel,
      buildings: base.buildings.map((b, id) => ({ id, ...b })),
      reinforcements: [],
    },
    attacker: { troops, spells: [], heroes: [], siege: [], reinforcements: [] },
  };
}
const line = (id: string, n: number): Command[] =>
  Array.from({ length: n }, (_, i) => ({ t: Math.floor(i / 4), k: 'troop', id, x: 12000 + i * 500, y: 600 }));

describe.skipIf(!url)('Supabase Edge Function verifier (Deno)', () => {
  const failOnFallback = {
    name: 'fail',
    verify: async () => {
      throw new Error('edge verification fell back');
    },
  };

  it('matches the in-process simulation exactly', async () => {
    const edge = edgeVerifier({ url: url!, secret, fallback: failOnFallback });
    for (const [s, cmds] of [
      ...[...replayCases(1), ...replayCases(SIM_VERSION)].map(
        (c) => [c.setup, c.commands] as [BattleSetup, Command[]],
      ),
      [setup('c01_bandit_camp', [{ id: 'swordsman', level: 1, count: 20 }]), line('swordsman', 20)],
      [
        setup('c03_stone_ford', [
          { id: 'archer', level: 3, count: 30 },
          { id: 'bulwark', level: 2, count: 4 },
        ]),
        [...line('bulwark', 4), ...line('archer', 30).map((c) => ({ ...c, t: c.t + 20 }))],
      ],
    ] as [BattleSetup, Command[]][]) {
      const remote = await edge.verify(s, cmds, null);
      const local = await inlineVerifier().verify(s, cmds, null);
      expect(remote.status).toBe('done');
      expect(remote.via).toBe('edge');
      if (remote.status === 'done' && local.status === 'done') {
        expect(remote.result).toEqual(local.result);
        expect(remote.result.hash).toBe(runBattle(s, cmds).hash);
      }
    }
  });

  it('rejects unsigned or tampered requests', async () => {
    const unsigned = await fetch(url!, { method: 'POST', body: '{}' });
    expect(unsigned.status).toBe(401);
    const forged = edgeVerifier({ url: url!, secret: 'wrong-secret', fallback: inlineVerifier() });
    const r = await forged.verify(
      setup('c01_bandit_camp', [{ id: 'swordsman', level: 1, count: 1 }]),
      [],
      null,
    );
    expect(r.via).toBe('inline');
  });
});
