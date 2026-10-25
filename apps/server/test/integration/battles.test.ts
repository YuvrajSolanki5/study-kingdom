import { MT, type Command } from '@sk/sim';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { finalizeExpired } from '../../src/services/battles.ts';
import { chunkedVerifier, inlineVerifier } from '../../src/verify/verifiers.ts';
import { createHarness, rid, signedInClient, type Client, type Harness } from './harness.ts';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => h.close());

const deployAll = (count: number, id = 'swordsman'): Command[] =>
  Array.from({ length: count }, (_, i) => ({
    t: Math.floor(i / 5),
    k: 'troop' as const,
    id,
    x: 15000 + i * 400,
    y: 500,
  }));

async function startCampaign(c: Client, target = 'c01_bandit_camp') {
  return c.post('/api/battles', { requestId: rid(), kind: 'campaign', target });
}

describe('campaign battles', () => {
  it('a new player wins the first base, gets rewards once, and loses deployed troops', async () => {
    const c = await signedInClient(h);
    const before = (await c.get('/api/player')).body;
    expect(before.state.army.troops.swordsman).toBe(15);
    const start = await startCampaign(c);
    expect(start.status).toBe(200);
    expect(start.body.setup.attacker.troops).toEqual([{ id: 'swordsman', level: 1, count: 15 }]);
    const id = start.body.battle.id;
    const again = await startCampaign(c);
    expect(again.status).toBe(409);

    const sub = await c.post(`/api/battles/${id}/submit`, { commands: deployAll(15) });
    expect(sub.status).toBe(200);
    expect(sub.body.battle.status).toBe('settled');
    expect(sub.body.battle.result.stars).toBe(3);
    expect(sub.body.battle.rewards).toEqual({ gold: 700, essence: 200, trophies: 0 });

    const after = (await c.get('/api/player')).body;
    expect(after.state.campaign.c01_bandit_camp).toBe(3);
    expect(after.state.army.troops.swordsman ?? 0).toBe(15 - sub.body.battle.result.troopsUsed.swordsman);
    expect(after.activeBattleId).toBeNull();
    expect(after.wallet.gold).toBe(before.wallet.gold + 700);

    const replay = await c.post(`/api/battles/${id}/submit`, { commands: deployAll(15) });
    expect(replay.body.battle.status).toBe('settled');
    expect((await c.get('/api/player')).body.wallet.gold).toBe(after.wallet.gold);
    expect(await h.admin`select * from game.ledger_mismatches`).toHaveLength(0);
  });

  it('rejects forged armies and forfeits the army', async () => {
    const c = await signedInClient(h);
    const start = await startCampaign(c);
    const sub = await c.post(`/api/battles/${start.body.battle.id}/submit`, { commands: deployAll(16) });
    expect(sub.body.battle.status).toBe('rejected');
    expect(sub.body.battle.rejectReason).toMatch(/no swordsman left/);
    const after = (await c.get('/api/player')).body;
    expect(after.state.army.troops.swordsman ?? 0).toBe(0);
    expect(after.wallet.gold).toBe(750);
  });

  it('rejects deployment inside the no-deploy zone', async () => {
    const c = await signedInClient(h);
    const start = await startCampaign(c);
    const sub = await c.post(`/api/battles/${start.body.battle.id}/submit`, {
      commands: [{ t: 0, k: 'troop', id: 'swordsman', x: 21 * MT, y: 21 * MT }],
    });
    expect(sub.body.battle.status).toBe('rejected');
  });

  it('locks later campaign bases until the previous one is beaten', async () => {
    const c = await signedInClient(h);
    const res = await startCampaign(c, 'c02_riverside_watch');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('locked');
  });

  it('chunked verification settles identically across several calls', async () => {
    const inline = await signedInClient(h);
    const chunked = await signedInClient(h);
    const cmds = deployAll(15);
    const a = await startCampaign(inline);
    // Same seed is not guaranteed, so compare against an inline re-run of the stored setup.
    const ra = await inline.post(`/api/battles/${a.body.battle.id}/submit`, { commands: cmds });
    h.setVerifier(chunkedVerifier(300));
    const b = await startCampaign(chunked);
    let res = await chunked.post(`/api/battles/${b.body.battle.id}/submit`, { commands: cmds });
    let calls = 1;
    while (res.body.battle.status === 'verifying') {
      res = await chunked.post(`/api/battles/${b.body.battle.id}/verify`);
      calls++;
      expect(calls).toBeLessThan(200);
    }
    h.setVerifier(inlineVerifier());
    expect(calls).toBeGreaterThan(2);
    expect(res.body.battle.status).toBe('settled');
    expect(res.body.battle.result.stars).toBe(ra.body.battle.result.stars);
    const full = await chunked.get(`/api/battles/${b.body.battle.id}?full=1`);
    const { runBattle } = await import('@sk/sim');
    expect(runBattle(full.body.setup, full.body.commands).hash).toBe(res.body.battle.result.hash);
  });

  it('settles an abandoned battle from recorded progress when it expires', async () => {
    const c = await signedInClient(h);
    const start = await startCampaign(c);
    const id = start.body.battle.id;
    const progress = await c.post(`/api/battles/${id}/progress`, { commands: deployAll(5) });
    expect(progress.status).toBe(200);
    const stale = await c.post(`/api/battles/${id}/progress`, { commands: deployAll(3) });
    expect(stale.status).toBe(200); // shorter (out-of-order) progress is ignored
    const diverge = await c.post(`/api/battles/${id}/progress`, {
      commands: deployAll(6).map((x, i) => (i === 0 ? { ...x, x: x.x + 1 } : x)),
    });
    expect(diverge.status).toBe(400);
    h.clock.advance(10 * 60_000);
    const late = await c.post(`/api/battles/${id}/submit`, { commands: deployAll(15) });
    expect(late.status).toBe(410);
    const n = await finalizeExpired(h.db, h.deps);
    expect(n).toBeGreaterThanOrEqual(1);
    const b = (await c.get(`/api/battles/${id}`)).body.battle;
    expect(b.status).toBe('settled');
    expect(b.result.troopsUsed.swordsman).toBe(5);
    const after = (await c.get('/api/player')).body;
    expect(after.state.army.troops.swordsman).toBe(10);
    // Finalizing again changes nothing.
    await finalizeExpired(h.db, h.deps);
    expect((await c.get('/api/player')).body.wallet.gold).toBe(after.wallet.gold);
  });
});

it('final submissions cannot erase or rewrite the recorded deployment history', async () => {
  const c = await signedInClient(h),
    started = await startCampaign(c),
    id = started.body.battle.id;
  const recorded = deployAll(5);
  expect((await c.post(`/api/battles/${id}/progress`, { commands: recorded })).status).toBe(200);
  expect((await c.post(`/api/battles/${id}/submit`, { commands: [] })).status).toBe(400);
  const changed = deployAll(10);
  changed[0] = { ...changed[0]!, x: 17000 } as Command;
  expect((await c.post(`/api/battles/${id}/submit`, { commands: changed })).status).toBe(400);
  expect((await c.get(`/api/battles/${id}?full=1`)).body.commands).toEqual(recorded);
  expect((await c.post(`/api/battles/${id}/progress`, { commands: deployAll(10) })).status).toBe(200);
  const final = await c.post(`/api/battles/${id}/submit`, { commands: deployAll(15) });
  expect(final.status).toBe(200);
  expect(final.body.battle.status).toBe('settled');
});

it('a delayed verification response cannot rewind a newer stored checkpoint', async () => {
  const c = await signedInClient(h),
    started = await startCampaign(c),
    id = started.body.battle.id;
  const { createRuntime } = await import('@sk/sim');
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>((r) => {
      release = r;
    }),
    ready = new Promise<void>((r) => {
      entered = r;
    });
  let calls = 0;
  h.setVerifier({
    name: 'checkpoint-race',
    async verify(setup) {
      const index = ++calls;
      const state = createRuntime(setup).state;
      state.tick = index === 1 ? 100 : 200;
      if (index === 1) {
        entered();
        await gate;
      }
      return { status: 'pending', checkpoint: state, via: 'chunked' };
    },
  });
  try {
    const slow = c.post(`/api/battles/${id}/submit`, { commands: [] });
    await ready;
    expect((await c.post(`/api/battles/${id}/verify`)).status).toBe(202);
    release();
    await slow;
    const [stored] = await h.admin`select checkpoint from game.battles where id=${id}`;
    expect(stored!.checkpoint.tick).toBe(200);
  } finally {
    release();
    h.setVerifier(inlineVerifier());
  }
  expect((await c.post(`/api/battles/${id}/verify`)).body.battle.status).toBe('settled');
});
