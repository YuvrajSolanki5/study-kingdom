import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeStaleSessions } from '../../src/services/study.ts';
import { createHarness, rid, signedInClient, type Client, type Harness } from './harness.ts';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => h.close());

const MIN = 60_000;
const DEV_A = 'device-a-0000-0001';
const DEV_B = 'device-b-0000-0002';

async function start(c: Client, deviceId = DEV_A, extra: Record<string, unknown> = {}) {
  return c.post('/api/study/sessions', {
    requestId: rid(),
    deviceId,
    platform: 'web',
    mode: 'paper',
    plannedMinutes: 25,
    goal: 'Chapter 4 problems',
    subjects: ['Maths'],
    ...extra,
  });
}

/** Sends heartbeats every 30 s of fake time for `minutes`. */
async function studyFor(
  c: Client,
  id: string,
  minutes: number,
  seqStart: number,
  deviceId = DEV_A,
  report = {},
) {
  let seq = seqStart;
  for (let i = 0; i < minutes * 2; i++) {
    h.clock.advance(30_000);
    const r = await c.post(`/api/study/sessions/${id}/heartbeat`, { deviceId, seq: ++seq, report });
    if (r.status !== 200) throw new Error(JSON.stringify(r.body));
  }
  return seq;
}

describe('study sessions', () => {
  it('a 25-minute session pays once and funds an upgrade', async () => {
    const c = await signedInClient(h);
    const s = (await start(c)).body.session;
    expect(s.status).toBe('running');
    await studyFor(c, s.id, 25, 0);
    const requestId = rid();
    const done = await c.post(`/api/study/sessions/${s.id}/complete`, { requestId, deviceId: DEV_A });
    expect(done.status).toBe(200);
    expect(done.body.session.status).toBe('completed');
    expect(done.body.session.eligibleSeconds).toBe(1500);
    expect(done.body.session.reward.gold).toBe(1100);
    expect(done.body.view.wallet.gold).toBe(Math.min(750 + 1100, done.body.view.wallet.capacity.gold));

    // Replays (same or new request id) never pay twice.
    const again = await c.post(`/api/study/sessions/${s.id}/complete`, { requestId, deviceId: DEV_A });
    const again2 = await c.post(`/api/study/sessions/${s.id}/complete`, {
      requestId: rid(),
      deviceId: DEV_A,
    });
    expect(again.body.view.wallet.gold).toBe(done.body.view.wallet.gold);
    expect(again2.body.view.wallet.gold).toBe(done.body.view.wallet.gold);
    const rewards =
      await h.admin`select count(*)::int as n from game.ledger where reason = 'study_reward' and ref = ${'study:' + s.id}`;
    expect(rewards[0]!.n).toBe(2);
    expect(await h.admin`select * from game.ledger_mismatches`).toHaveLength(0);
  });

  it('allows only one earning session per account across devices', async () => {
    const c = await signedInClient(h);
    const s = (await start(c, DEV_A)).body.session;
    const second = await start(c, DEV_B);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('session_active');
    // Taking over moves the same session; the first device is refused.
    const moved = await start(c, DEV_B, { takeOver: true });
    expect(moved.body.session.id).toBe(s.id);
    h.clock.advance(30_000);
    const old = await c.post(`/api/study/sessions/${s.id}/heartbeat`, { deviceId: DEV_A, seq: 99 });
    expect(old.status).toBe(409);
    expect(old.body.error.code).toBe('session_moved');
    const ok = await c.post(`/api/study/sessions/${s.id}/heartbeat`, {
      deviceId: DEV_B,
      seq: moved.body.session.heartbeatSeq + 1,
    });
    expect(ok.status).toBe(200);
    await c.post(`/api/study/sessions/${s.id}/complete`, { requestId: rid(), deviceId: DEV_B });
  });

  it('ignores replayed heartbeats and device clock changes', async () => {
    const c = await signedInClient(h);
    const s = (await start(c)).body.session;
    h.clock.advance(30_000);
    const hb = await c.post(`/api/study/sessions/${s.id}/heartbeat`, { deviceId: DEV_A, seq: 1 });
    const replay = await c.post(`/api/study/sessions/${s.id}/heartbeat`, { deviceId: DEV_A, seq: 1 });
    expect(replay.body.session.eligibleSeconds).toBe(hb.body.session.eligibleSeconds);
    // The client cannot claim time: reports only subtract, and only server time counts.
    h.clock.advance(30_000);
    const claim = await c.post(`/api/study/sessions/${s.id}/heartbeat`, {
      deviceId: DEV_A,
      seq: 2,
      report: { distractedMs: 0, unconfirmedMs: 0, idleMs: 0 },
    });
    expect(claim.body.session.eligibleSeconds).toBe(60);
    await c.post(`/api/study/sessions/${s.id}/complete`, { requestId: rid(), deviceId: DEV_A });
  });

  it('never double-counts concurrent heartbeats', async () => {
    const c = await signedInClient(h);
    const s = (await start(c)).body.session;
    h.clock.advance(30_000);
    const results = await Promise.all(
      [1, 2, 3, 4].map((seq) => c.post(`/api/study/sessions/${s.id}/heartbeat`, { deviceId: DEV_A, seq })),
    );
    expect(results.every((r) => r.status === 200 || r.body.error?.code === 'busy')).toBe(true);
    const [row] = await h.admin`select clock from game.study_sessions where id = ${s.id}`;
    expect((row!.clock as { eligibleMs: number }).eligibleMs).toBe(30_000);
    await c.post(`/api/study/sessions/${s.id}/complete`, { requestId: rid(), deviceId: DEV_A });
  });

  it('holds sleep/disconnect gaps for review without competitive credit', async () => {
    const c = await signedInClient(h);
    const s = (await start(c)).body.session;
    const seq = await studyFor(c, s.id, 10, 0);
    h.clock.advance(20 * MIN); // laptop asleep
    await studyFor(c, s.id, 5, seq);
    const done = await c.post(`/api/study/sessions/${s.id}/complete`, { requestId: rid(), deviceId: DEV_A });
    expect(done.body.session.eligibleSeconds).toBe(15 * 60 - 30);
    expect(done.body.session.unreviewedSeconds).toBe(20 * 60 + 30);
    const competitive = done.body.session.competitiveSeconds;
    const gold = done.body.view.wallet.gold;
    const review = await c.post(`/api/study/sessions/${s.id}/review`, { requestId: rid(), seconds: 20 * 60 });
    expect(review.status).toBe(200);
    expect(review.body.session.reviewedSeconds).toBe(20 * 60);
    expect(review.body.session.competitiveSeconds).toBe(competitive);
    expect(review.body.view.wallet.gold).toBeGreaterThan(gold);
    const twice = await c.post(`/api/study/sessions/${s.id}/review`, { requestId: rid(), seconds: 20 * 60 });
    expect(twice.body.view.wallet.gold).toBe(review.body.view.wallet.gold);
  });

  it('pauses do not earn and abandoned sessions keep proportional credit', async () => {
    const c = await signedInClient(h);
    const s = (await start(c)).body.session;
    const seq = await studyFor(c, s.id, 5, 0);
    await c.post(`/api/study/sessions/${s.id}/pause`, { deviceId: DEV_A });
    h.clock.advance(5 * MIN);
    await c.post(`/api/study/sessions/${s.id}/resume`, { deviceId: DEV_A });
    await studyFor(c, s.id, 5, seq);
    // The app closes: no more heartbeats. The cron closes the session at the last heartbeat.
    h.clock.advance(31 * MIN);
    const closed = await closeStaleSessions(h.db, h.deps);
    expect(closed).toBeGreaterThanOrEqual(1);
    const hist = (await c.get('/api/study/history')).body;
    const row = hist.sessions.find((x: { id: string }) => x.id === s.id);
    expect(row.status).toBe('abandoned');
    expect(row.endReason).toBe('connection_lost');
    expect(row.eligibleSeconds).toBe(600);
    expect(row.pausedSeconds).toBe(300);
    expect(row.unreviewedSeconds).toBe(0);
    expect(row.reward.gold).toBe(400);
  });

  it('subtracts reported distraction in computer mode', async () => {
    const c = await signedInClient(h);
    const s = (await start(c, DEV_A, { mode: 'computer', platform: 'desktop' })).body.session;
    await studyFor(c, s.id, 10, 0, DEV_A, { distractedMs: 15_000 });
    const done = await c.post(`/api/study/sessions/${s.id}/complete`, { requestId: rid(), deviceId: DEV_A });
    expect(done.body.session.eligibleSeconds).toBe(300);
    expect(done.body.session.distractedSeconds).toBe(300);
  });

  it('reports history and goals', async () => {
    const c = await signedInClient(h);
    await c.put('/api/player/settings', {
      dailyGoalMinutes: 60,
      subjects: ['Physics'],
      timezone: 'Australia/Sydney',
    });
    const s = (await start(c)).body.session;
    await studyFor(c, s.id, 3, 0);
    await c.post(`/api/study/sessions/${s.id}/complete`, {
      requestId: rid(),
      deviceId: DEV_A,
      recall: { summary: 'Kinematics: v = u + at, and stopping distance', cards: [{ q: 'v?', a: 'u + at' }] },
    });
    const hist = (await c.get('/api/study/history')).body;
    expect(hist.today.goalMinutes).toBe(60);
    expect(hist.today.seconds).toBe(180);
    expect(hist.subjects).toEqual([{ subject: 'Maths', seconds: 180 }]);
    expect(hist.sessions[0].recall.cards).toHaveLength(1);
  });
});
