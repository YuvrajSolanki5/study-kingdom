import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, rid, signedInClient, type Harness } from './harness.ts';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => h.close());

async function ledgerMismatches() {
  return h.admin`select * from game.ledger_mismatches`;
}

describe('village actions through the API', () => {
  it('spends through the ledger and replays idempotently', async () => {
    const c = await signedInClient(h);
    const view = (await c.get('/api/player')).body;
    const treasury = view.state.buildings.find((b: { defId: string }) => b.defId === 'treasury');
    const requestId = rid();
    const action = { type: 'upgrade', buildingId: treasury.id };
    const first = await c.post('/api/player/actions', { requestId, action });
    expect(first.status).toBe(200);
    expect(first.body.view.wallet.gold).toBe(0);
    const replay = await c.post('/api/player/actions', { requestId, action });
    expect(replay.status).toBe(200);
    expect(replay.body.view.wallet.gold).toBe(0);
    const entries =
      await h.admin`select reason, amount from game.ledger where user_id = ${view.profile.userId} order by id`;
    expect(entries.map((e) => [e.reason, Number(e.amount)])).toEqual([
      ['starter_wallet', 750],
      ['starter_wallet', 250],
      ['upgrade', -750],
    ]);
    expect(await ledgerMismatches()).toHaveLength(0);
  });

  it('returns rule errors as 4xx with a code', async () => {
    const c = await signedInClient(h);
    const res = await c.post('/api/player/actions', {
      requestId: rid(),
      action: { type: 'build', defId: 'watchtower', x: 21, y: 21 },
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('blocked');
    const bad = await c.post('/api/player/actions', {
      requestId: rid(),
      action: { type: 'build', defId: 'watchtower', x: -5, y: 2 },
    });
    expect(bad.status).toBe(400);
  });

  it('serialises concurrent spends so the wallet never goes negative', async () => {
    const c = await signedInClient(h);
    const view = (await c.get('/api/player')).body;
    // 750 gold: each watchtower costs 1000 — at most... use treasury (750) and barracks (600): only one fits.
    const treasury = view.state.buildings.find((b: { defId: string }) => b.defId === 'treasury');
    const barracks = view.state.buildings.find((b: { defId: string }) => b.defId === 'barracks');
    const results = await Promise.all([
      c.post('/api/player/actions', {
        requestId: rid(),
        action: { type: 'upgrade', buildingId: treasury.id },
      }),
      c.post('/api/player/actions', {
        requestId: rid(),
        action: { type: 'upgrade', buildingId: barracks.id },
      }),
    ]);
    const ok = results.filter((r) => r.status === 200);
    expect(ok).toHaveLength(1);
    expect(results.find((r) => r.status !== 200)!.body.error.code).toBe('insufficient_funds');
    const after = (await c.get('/api/player')).body;
    expect(after.wallet.gold).toBeGreaterThanOrEqual(0);
    expect(await ledgerMismatches()).toHaveLength(0);
  });

  it('completes upgrades over server time', async () => {
    const c = await signedInClient(h);
    const view = (await c.get('/api/player')).body;
    const barracks = view.state.buildings.find((b: { defId: string }) => b.defId === 'barracks');
    await c.post('/api/player/actions', {
      requestId: rid(),
      action: { type: 'upgrade', buildingId: barracks.id },
    });
    h.clock.advance(2 * 60_000);
    const later = (await c.get('/api/player')).body;
    expect(later.state.buildings.find((b: { id: number }) => b.id === barracks.id).level).toBe(2);
    h.clock.advance(-2 * 60_000);
  });

  it('rejects stale, reused or malformed request ids', async () => {
    const c = await signedInClient(h);
    const requestId = rid();
    await c.post('/api/player/actions', { requestId, action: { type: 'tutorial', step: 1 } });
    const reused = await c.post('/api/study/sessions', {
      requestId,
      deviceId: 'device-aaaa-1111',
      platform: 'web',
      mode: 'paper',
      plannedMinutes: 25,
    });
    expect(reused.status).toBe(409);
    expect(reused.body.error.code).toBe('request_reused');
    const malformed = await c.post('/api/player/actions', {
      requestId: 'nope',
      action: { type: 'tutorial', step: 1 },
    });
    expect(malformed.status).toBe(400);
  });

  it('keeps the ledger append-only', async () => {
    await expect(h.admin`update game.ledger set amount = 999999`).rejects.toThrow(/append-only/);
    await expect(h.db`delete from game.ledger`).rejects.toThrow();
  });
});
