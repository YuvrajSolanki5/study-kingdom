import { afterAll, beforeAll, expect, it } from 'vitest';
import { createApp } from '../../src/app.ts';
import { advanceWars } from '../../src/services/wars.ts';
import { createHarness, signedInClient, rid, type Harness, type Client } from './harness.ts';
let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => h.close());
async function team(name: string, n = 5) {
  const clients: Client[] = [],
    ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const c = await signedInClient(h, `${name} ${i}`);
    clients.push(c);
    ids.push((await c.get('/api/player')).body.profile.userId);
  }
  const created = await clients[0]!.post('/api/clans', { name });
  expect(created.status).toBe(200);
  for (let i = 1; i < n; i++) {
    expect((await clients[0]!.post('/api/clans/invite', { id: ids[i] })).status).toBe(200);
    expect((await clients[i]!.post('/api/clans/join', { id: created.body.id })).status).toBe(200);
  }
  return { clients, ids, id: created.body.id };
}
it('clan invitations and roles enforce membership permissions', async () => {
  const t = await team('Roles', 3),
    outsider = await signedInClient(h);
  expect((await outsider.post('/api/clans/join', { id: t.id })).status).toBe(403);
  expect((await t.clients[1]!.post('/api/clans/invite', { id: t.ids[2] })).status).toBe(403);
  expect((await t.clients[0]!.post('/api/clans/leave')).status).toBe(409);
  expect((await t.clients[0]!.post('/api/clans/role', { userId: t.ids[1], role: 'officer' })).status).toBe(
    200,
  );
  expect((await t.clients[1]!.post('/api/clans/role', { userId: t.ids[2], role: 'leader' })).status).toBe(
    403,
  );
  expect((await t.clients[0]!.post('/api/clans/role', { userId: t.ids[1], role: 'leader' })).status).toBe(
    200,
  );
  expect((await t.clients[0]!.post('/api/clans/leave')).status).toBe(200);
  expect((await t.clients[1]!.get('/api/clans')).body.members).toHaveLength(2);
});
it('concurrent invitations cannot put a player into two clans or exceed 20 members', async () => {
  const a = await team('Capacity', 1),
    b = await team('Other', 1),
    guest = await signedInClient(h),
    uid = (await guest.get('/api/player')).body.profile.userId;
  await a.clients[0]!.post('/api/clans/invite', { id: uid });
  await b.clients[0]!.post('/api/clans/invite', { id: uid });
  const joined = await Promise.all([
    guest.post('/api/clans/join', { id: a.id }),
    guest.post('/api/clans/join', { id: b.id }),
  ]);
  expect(joined.filter((r) => r.status === 200)).toHaveLength(1);
  // Fill the first clan to nineteen with real account rows, then race for the final slot.
  const [n] = await h.admin`select count(*)::int as n from game.clan_members where clan_id=${a.id}`;
  for (let i = n!.n; i < 19; i++) {
    const c = await signedInClient(h);
    const id = (await c.get('/api/player')).body.profile.userId;
    await h.admin`insert into game.clan_members values (${id},${a.id},'member',${new Date(h.clock.now)})`;
  }
  const x = await signedInClient(h),
    y = await signedInClient(h),
    xi = (await x.get('/api/player')).body.profile.userId,
    yi = (await y.get('/api/player')).body.profile.userId;
  await a.clients[0]!.post('/api/clans/invite', { id: xi });
  await a.clients[0]!.post('/api/clans/invite', { id: yi });
  const final = await Promise.all([
    x.post('/api/clans/join', { id: a.id }),
    y.post('/api/clans/join', { id: a.id }),
  ]);
  expect(final.map((r) => r.status).sort()).toEqual([200, 409]);
});
it('donation and claim retries transfer troops once and competing donors cannot overfill', async () => {
  const t = await team('Donors', 3),
    [owner, d1, d2] = t.clients;
  const [p] = await h.admin`select state from game.players where user_id=${t.ids[0]!}`;
  p!.state.buildings.push({ id: 99, defId: 'clan_hall', level: 1, x: 5, y: 5 });
  await h.admin`update game.players set state=${h.admin.json(p!.state)} where user_id=${t.ids[0]!}`;
  const req = await owner!.post('/api/clans/reinforcements');
  expect(req.status).toBe(200);
  const body = { requestId: rid(), troop: 'swordsman', count: 5 };
  const dup = await Promise.all([
    d1!.post(`/api/clans/reinforcements/${req.body.id}/donate`, body),
    d1!.post(`/api/clans/reinforcements/${req.body.id}/donate`, body),
  ]);
  expect(dup.every((r) => r.status === 200)).toBe(true);
  expect((await d1!.get('/api/player')).body.state.army.troops.swordsman).toBe(10);
  const race = await Promise.all([
    d1!.post(`/api/clans/reinforcements/${req.body.id}/donate`, {
      requestId: rid(),
      troop: 'swordsman',
      count: 5,
    }),
    d2!.post(`/api/clans/reinforcements/${req.body.id}/donate`, {
      requestId: rid(),
      troop: 'swordsman',
      count: 5,
    }),
  ]);
  expect(race.map((r) => r.status).sort()).toEqual([200, 409]);
  const claim = { requestId: rid() };
  const claims = await Promise.all([
    owner!.post(`/api/clans/reinforcements/${req.body.id}/claim`, claim),
    owner!.post(`/api/clans/reinforcements/${req.body.id}/claim`, claim),
  ]);
  expect(claims.every((r) => r.status === 200)).toBe(true);
  expect(
    (await owner!.get('/api/player')).body.state.reinforcements.reduce(
      (s: number, r: { count: number }) => s + r.count,
      0,
    ),
  ).toBe(10);
  expect((await owner!.post('/api/clans/reinforcements')).status).toBe(409);
  expect(await h.admin`select * from game.ledger_mismatches`).toHaveLength(0);
});
it('war rosters, deadlines, two attacks, best-base scoring and settlement survive restart', async () => {
  const a = await team('Dawn'),
    b = await team('Dusk');
  const proposed = await a.clients[0]!.post('/api/clans/wars', { clanId: b.id, roster: a.ids });
  expect(proposed.status).toBe(200);
  const warId = proposed.body.id;
  expect((await b.clients[1]!.post(`/api/clans/wars/${warId}/accept`, { roster: b.ids })).status).toBe(403);
  expect((await b.clients[0]!.post(`/api/clans/wars/${warId}/accept`, { roster: b.ids })).status).toBe(200);
  expect((await a.clients[1]!.post('/api/clans/leave')).status).toBe(409);
  const attack = () =>
    a.clients[0]!.post('/api/battles', { requestId: rid(), kind: 'war', target: `${warId}:${b.ids[0]}` });
  expect((await attack()).status).toBe(409);
  const moved = await b.clients[0]!.post('/api/player/actions', {
    requestId: rid(),
    action: { type: 'move', buildingId: 2, x: 30, y: 20 },
  });
  expect(moved.status).toBe(200);
  h.clock.advance(12 * 3600000);
  // A move after the deadline cannot change the frozen defence, even before cron.
  expect(
    (
      await b.clients[0]!.post('/api/player/actions', {
        requestId: rid(),
        action: { type: 'move', buildingId: 2, x: 34, y: 20 },
      })
    ).status,
  ).toBe(200);
  const first = await attack();
  expect(first.status).toBe(200);
  expect(first.body.setup.defender.buildings.find((x: { id: number }) => x.id === 2).x).toBe(30);
  expect(
    (
      await a.clients[0]!.post(`/api/battles/${first.body.battle.id}/submit`, {
        commands: [{ t: 0, k: 'end' }],
      })
    ).status,
  ).toBe(200);
  const second = await attack();
  expect(second.status).toBe(200);
  const commands = Array.from({ length: 15 }, (_, i) => ({
    t: Math.floor(i / 5),
    k: 'troop',
    id: 'swordsman',
    x: 15000 + i * 400,
    y: 500,
  }));
  const result = await a.clients[0]!.post(`/api/battles/${second.body.battle.id}/submit`, { commands });
  expect(result.body.battle.status).toBe('settled');
  // Retrain so the attack-count rule, rather than the empty-army rule, rejects attack three.
  await a.clients[0]!.post('/api/player/actions', {
    requestId: rid(),
    action: { type: 'train', kind: 'troops', id: 'swordsman', count: 5 },
  });
  h.clock.advance(60000);
  const third = await attack();
  expect(third.status).toBe(409);
  expect(third.body.error.code).toBe('war_attacks');
  h.clock.advance(24 * 3600000);
  const restarted = createApp(() => ({ ...h.deps }));
  await Promise.all([advanceWars(h.db, { ...h.deps }), advanceWars(h.db, { ...h.deps })]);
  const cookie = [...b.clients[0]!.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  const fresh = await restarted.request('http://localhost/api/clans', { headers: { cookie } });
  expect(fresh.status).toBe(200);
  const wars = (await fresh.json()).wars;
  expect(wars[0].status).toBe('settled');
  expect(wars[0].result.homeStars).toBe(result.body.battle.result.stars);
  expect(wars[0].result.homeDestruction).toBe(result.body.battle.result.destructionPercent);
  expect(wars[0].result.awayStars).toBe(0);
  const rewards = await h.admin`select * from game.cosmetics where code=${`war:${warId}`}`;
  await advanceWars(h.db, { ...h.deps });
  expect(await h.admin`select * from game.cosmetics where code=${`war:${warId}`}`).toHaveLength(
    rewards.length,
  );
  expect(await h.admin`select * from game.ledger_mismatches`).toHaveLength(0);
});
it('a war cannot settle while an on-time attack is still being verified', async () => {
  const a = await team('Patience'),
    b = await team('Resolve');
  const w = await a.clients[0]!.post('/api/clans/wars', { clanId: b.id, roster: a.ids });
  await b.clients[0]!.post(`/api/clans/wars/${w.body.id}/accept`, { roster: b.ids });
  h.clock.advance(12 * 3600000 + 24 * 3600000 - 1000);
  const battle = await a.clients[0]!.post('/api/battles', {
    requestId: rid(),
    kind: 'war',
    target: `${w.body.id}:${b.ids[0]}`,
  });
  expect(battle.status).toBe(200);
  h.clock.advance(2000);
  await advanceWars(h.db, h.deps);
  expect((await a.clients[0]!.get('/api/clans')).body.wars[0].status).toBe('battle');
  await a.clients[0]!.post(`/api/battles/${battle.body.battle.id}/submit`, {
    commands: [{ t: 0, k: 'end' }],
  });
  await advanceWars(h.db, h.deps);
  expect((await a.clients[0]!.get('/api/clans')).body.wars[0].status).toBe('settled');
});

it('weekly objectives cap contributions, exclude late joiners and award one cosmetic per week', async () => {
  const t = await team('Weekly', 1),
    owner = t.clients[0]!,
    uid = t.ids[0]!;
  const initial = await owner.get('/api/clans');
  expect(initial.body.objective.targetMinutes).toBe(300);
  for (let i = 0; i < 2; i++)
    await h.admin`insert into game.study_sessions (user_id,device_id,platform,mode,status,planned_minutes,clock,ended_at,competitive_seconds,eligible_seconds) values (${uid},'test-device','web','paper','completed',240,'{}',${new Date(h.clock.now)},36000,36000)`;
  const v = await owner.get('/api/clans');
  expect(v.body.objective.minutes).toBe(600);
  const claim = await Promise.all([
    owner.post('/api/clans/objective/claim'),
    owner.post('/api/clans/objective/claim'),
  ]);
  expect(claim.every((r) => r.status === 200)).toBe(true);
  expect(
    (await owner.get('/api/clans')).body.cosmetics.filter((c: string) => c.startsWith('study:')),
  ).toHaveLength(1);
  const late = await signedInClient(h),
    lateId = (await late.get('/api/player')).body.profile.userId;
  await owner.post('/api/clans/invite', { id: lateId });
  await late.post('/api/clans/join', { id: t.id });
  expect((await late.post('/api/clans/objective/claim')).status).toBe(409);
  h.clock.advance(7 * 86400000);
  const next = await owner.get('/api/clans');
  expect(next.body.objective.minutes).toBe(0);
  expect(next.body.objective.targetMinutes).toBe(600);
  expect(next.body.objective.claimed).toBe(false);
});

it('a layout edit committing at the phase boundary is frozen consistently', async () => {
  const a = await team('Boundary A'),
    b = await team('Boundary B');
  const w = await a.clients[0]!.post('/api/clans/wars', { clanId: b.id, roster: a.ids });
  await b.clients[0]!.post(`/api/clans/wars/${w.body.id}/accept`, { roster: b.ids });
  const [p] = await h.admin`select state from game.players where user_id=${b.ids[0]!}`;
  p!.state.buildings.find((x: { id: number }) => x.id === 2).x = 30;
  const { updateWarLayout } = await import('../../src/services/wars.ts');
  const writer = h.deps.createSql(),
    scheduler = h.deps.createSql();
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>((r) => {
      release = r;
    }),
    ready = new Promise<void>((r) => {
      entered = r;
    });
  const deadline = h.clock.now + 12 * 3600000;
  try {
    const edit = writer.begin(async (tx) => {
      await tx`select user_id from game.war_roster where war_id=${w.body.id} and user_id=${b.ids[0]!} for update`;
      await updateWarLayout(tx, b.ids[0]!, p!.state, '1', deadline - 1);
      entered();
      await gate;
    });
    await ready;
    h.clock.advance(12 * 3600000);
    const freezing = advanceWars(scheduler, h.deps);
    let waiting = false;
    for (let i = 0; i < 100; i++) {
      const locks =
        await h.admin`select 1 from pg_stat_activity where application_name='study-kingdom-api' and cardinality(pg_blocking_pids(pid))>0`;
      if (locks.length) {
        waiting = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 10));
    }
    release();
    await edit;
    await freezing;
    expect(waiting).toBe(true);
    const attack = await a.clients[0]!.post('/api/battles', {
      requestId: rid(),
      kind: 'war',
      target: `${w.body.id}:${b.ids[0]}`,
    });
    expect(attack.status).toBe(200);
    expect(attack.body.setup.defender.buildings.find((x: { id: number }) => x.id === 2).x).toBe(30);
  } finally {
    release();
    await writer.end();
    await scheduler.end();
  }
});
