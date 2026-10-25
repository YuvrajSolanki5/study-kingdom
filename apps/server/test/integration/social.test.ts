import { afterAll, beforeAll, expect, it } from 'vitest';
import { runBattle, type Command } from '@sk/sim';
import { createHarness, signedInClient, rid, type Harness } from './harness.ts';
let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => h.close());
async function pair() {
  const a = await signedInClient(h, 'Alice'),
    b = await signedInClient(h, 'Bob');
  const av = (await a.get('/api/player')).body,
    bv = (await b.get('/api/player')).body;
  expect((await a.post('/api/social/friends', { code: bv.profile.friendCode })).status).toBe(200);
  expect((await b.post(`/api/social/friends/${av.profile.userId}/accept`)).status).toBe(200);
  return { a, b, av, bv };
}
const deploy: Command[] = Array.from({ length: 15 }, (_, i) => ({
  t: Math.floor(i / 5),
  k: 'troop',
  id: 'swordsman',
  x: 15000 + i * 400,
  y: 500,
}));
it('friend requests, visits, challenges, replays and privacy work end to end', async () => {
  const { a, b, av, bv } = await pair(),
    stranger = await signedInClient(h);
  expect((await stranger.get(`/api/social/visit/${av.profile.userId}`)).status).toBe(403);
  expect((await b.get('/api/social')).body.friends[0].displayName).toBe('Alice');
  const visit = await b.get(`/api/social/visit/${av.profile.userId}`);
  expect(visit.status).toBe(200);
  expect(visit.body.snapshot.buildings).toHaveLength(7);
  expect(visit.body.wallet).toBeUndefined();
  const challenge = await a.post('/api/social/challenges', { id: bv.profile.userId });
  const start = await b.post('/api/battles', {
    requestId: rid(),
    kind: 'friendly',
    target: challenge.body.id,
  });
  expect(start.status).toBe(200);
  expect(start.body.setup.defender.buildings).toEqual(visit.body.snapshot.buildings);
  const submitted = await b.post(`/api/battles/${start.body.battle.id}/submit`, { commands: deploy });
  expect(submitted.body.battle.status).toBe('settled');
  expect(submitted.body.battle.result).toEqual(runBattle(start.body.setup, deploy));
  const token = await a.post(`/api/social/replays/${start.body.battle.id}/share`);
  expect(token.status).toBe(200);
  const shared = await stranger.get(`/api/social/replays/${token.body.token}`);
  expect(shared.body.commands).toEqual(deploy);
  expect((await stranger.get(`/api/battles/${start.body.battle.id}?full=1`)).status).toBe(404);
  expect((await b.get('/api/player')).body.profile.trophies).toBe(0);
  expect((await a.get('/api/player')).body.wallet).toEqual(av.wallet);
  const notifications = await a.get('/api/social/notifications');
  expect(notifications.body.notifications.length).toBeGreaterThan(0);
  await a.post('/api/social/notifications/read', { through: notifications.body.notifications.at(-1).id });
  expect((await a.get('/api/social/notifications')).body.notifications).toHaveLength(0);
});
it('blocking removes friendship and prevents visits and new challenges', async () => {
  const { a, b, av, bv } = await pair();
  await a.post(`/api/social/friends/${bv.profile.userId}/block`);
  expect((await b.get('/api/social')).body.friends).toHaveLength(0);
  expect((await b.post('/api/social/friends', { code: av.profile.friendCode })).status).toBe(403);
  expect((await b.post('/api/social/challenges', { id: av.profile.userId })).status).toBe(403);
  expect((await a.get(`/api/social/visit/${bv.profile.userId}`)).status).toBe(403);
  expect((await a.get('/api/social')).body.blocked).toHaveLength(1);
  await a.post(`/api/social/friends/${bv.profile.userId}/unblock`);
  expect((await b.post('/api/social/friends', { code: av.profile.friendCode })).status).toBe(200);
});
it('friend acceptance requires the recipient and duplicate requests stay unique', async () => {
  const a = await signedInClient(h),
    b = await signedInClient(h),
    av = (await a.get('/api/player')).body,
    bv = (await b.get('/api/player')).body;
  await Promise.all([
    a.post('/api/social/friends', { code: bv.profile.friendCode }),
    a.post('/api/social/friends', { code: bv.profile.friendCode }),
  ]);
  expect((await a.get('/api/social')).body.friends).toHaveLength(1);
  expect((await a.post(`/api/social/friends/${bv.profile.userId}/accept`)).status).toBe(404);
  expect((await b.post(`/api/social/friends/${av.profile.userId}/accept`)).status).toBe(200);
});
it('private leagues count only activity after joining and weekly standings reset', async () => {
  const { a, b, av } = await pair(),
    outsider = await signedInClient(h);
  const league = await a.post('/api/social/leagues', { name: 'Study circle' });
  expect(league.status).toBe(200);
  expect((await outsider.get(`/api/social/leagues/${league.body.id}`)).status).toBe(404);
  await b.post('/api/social/leagues/join', { code: league.body.code });
  const scored = await a.get(`/api/social/leagues/${league.body.id}`);
  expect(scored.body.standings).toHaveLength(2);
  expect(scored.body.standings.every((r: { points: number }) => r.points === 0)).toBe(true);
  // A verified ranked battle is an authoritative scoring event.
  const [battle] =
    await h.admin`insert into game.battles (attacker_id,kind,status,sim_version,content_version,seed,setup,started_at,expires_at,result) values (${av.profile.userId},'ranked','settled',1,'1',1,'{}',${new Date(h.clock.now)},${new Date(h.clock.now + 1000)},'{"stars":3}') returning id`;
  expect(battle).toBeTruthy();
  expect(
    (await a.get(`/api/social/leagues/${league.body.id}`)).body.standings.find(
      (r: { userId: string }) => r.userId === av.profile.userId,
    ).points,
  ).toBe(30);
  h.clock.advance(7 * 86400000);
  expect(
    (await a.get(`/api/social/leagues/${league.body.id}`)).body.standings.every(
      (r: { points: number }) => r.points === 0,
    ),
  ).toBe(true);
});
it('study room presence reflects real sessions and expires while disconnected', async () => {
  const { a, b } = await pair();
  const room = await a.post('/api/social/rooms', { name: 'Library' });
  await b.post('/api/social/rooms/join', { code: room.body.code });
  expect((await a.get('/api/social')).body.room.members).toHaveLength(2);
  const started = await b.post('/api/study/sessions', {
    requestId: rid(),
    deviceId: 'test-device',
    mode: 'paper',
    platform: 'web',
    plannedMinutes: 25,
  });
  expect(started.status).toBe(200);
  const bv = (await b.get('/api/player')).body;
  expect(bv.activeSession).toBeTruthy();
  expect(
    (await a.get('/api/social')).body.room.members.find(
      (m: { userId: string }) => m.userId === bv.profile.userId,
    ).status,
  ).toBe('focus');
  h.clock.advance(121000);
  await a.post('/api/social/rooms/presence');
  expect((await a.get('/api/social')).body.room.members).toHaveLength(1);
  await a.post('/api/social/rooms/leave');
  expect((await a.get('/api/social')).body.room).toBeNull();
});
it('ranked matching freezes a snapshot and applies capped rewards exactly once', async () => {
  const { a, b, av, bv } = await pair();
  const start = await a.post('/api/battles', { requestId: rid(), kind: 'ranked', target: bv.profile.userId });
  expect(start.status).toBe(200);
  await b.post('/api/player/actions', {
    requestId: rid(),
    action: { type: 'move', buildingId: 2, x: 30, y: 20 },
  });
  const result = await a.post(`/api/battles/${start.body.battle.id}/submit`, { commands: deploy });
  expect(result.status).toBe(200);
  const before = (await a.get('/api/player')).body;
  await a.post(`/api/battles/${start.body.battle.id}/submit`, { commands: deploy });
  expect((await a.get('/api/player')).body.wallet).toEqual(before.wallet);
  expect((await b.get('/api/player')).body.wallet).toEqual(bv.wallet);
  expect((await a.get(`/api/battles/${start.body.battle.id}?full=1`)).body.setup).toEqual(start.body.setup);
  await a.post('/api/player/actions', {
    requestId: rid(),
    action: { type: 'train', kind: 'troops', id: 'swordsman', count: 5 },
  });
  h.clock.advance(60000);
  // A chosen target that cannot be raided again says why (shield or daily cooldown).
  expect(
    (await a.post('/api/battles', { requestId: rid(), kind: 'ranked', target: bv.profile.userId })).status,
  ).toBe(409);
  expect(
    (await b.get('/api/battles')).body.battles.some(
      (r: { attackerId: string }) => r.attackerId === av.profile.userId,
    ),
  ).toBe(true);
  expect(await h.admin`select * from game.ledger_mismatches`).toHaveLength(0);
});
it('friends can attack each other directly: friendly for practice, ranked for trophies', async () => {
  const { a, b, av } = await pair(),
    stranger = await signedInClient(h);
  const armyOf = async () => (await b.get('/api/player')).body.state.army.troops.swordsman;
  const before = await armyOf();
  // Friendly: no challenge needed, nothing is used up or won.
  const friendly = await b.post('/api/battles', {
    requestId: rid(),
    kind: 'friendly',
    target: av.profile.userId,
  });
  expect(friendly.status).toBe(200);
  expect(friendly.body.battle.kind).toBe('friendly');
  const done = await b.post(`/api/battles/${friendly.body.battle.id}/submit`, { commands: deploy });
  expect(done.body.battle.status).toBe('settled');
  expect(await armyOf()).toBe(before);
  expect((await b.get('/api/player')).body.profile.trophies).toBe(0);
  const note = (await a.get('/api/social/notifications')).body.notifications;
  expect(note.some((n: { message: string }) => /practised on your village/.test(n.message))).toBe(true);
  // Only friends.
  const nope = await stranger.post('/api/battles', {
    requestId: rid(),
    kind: 'friendly',
    target: av.profile.userId,
  });
  expect(nope.status).toBe(403);
  // Ranked against a chosen friend uses the army and moves trophies.
  const ranked = await b.post('/api/battles', {
    requestId: rid(),
    kind: 'ranked',
    target: av.profile.userId,
  });
  expect(ranked.status).toBe(200);
  expect(ranked.body.battle.defenderId ?? av.profile.userId).toBe(av.profile.userId);
  const five = deploy.slice(0, 5);
  const raided = await b.post(`/api/battles/${ranked.body.battle.id}/submit`, { commands: five });
  expect(raided.body.battle.status).toBe('settled');
  expect(await armyOf()).toBe(before - 5);
  // The usual once-a-day limit per target applies, with a reason the player can act on.
  const again = await b.post('/api/battles', { requestId: rid(), kind: 'ranked', target: av.profile.userId });
  expect(again.status).toBe(409);
  // A big raid shields the defender, which is checked before the daily cooldown.
  expect(again.body.error.message).toMatch(/Alice is shielded|raided Alice/);
});
