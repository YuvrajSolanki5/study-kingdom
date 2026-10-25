import { CodeBody, FriendBody, IdBody, NameBody } from '@sk/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../context.ts';
import { notFound } from '../errors.ts';
import { getBattle, battleSummary } from '../services/battles.ts';
import {
  createChallenge,
  friendAction,
  joinGroup,
  socialView,
  standings,
  visit,
} from '../services/social.ts';

const uid = (v: string) => z.uuid().parse(v);
export const socialRoutes = new Hono<AppEnv>()
  .get('/', async (c) => c.json(await socialView(c.var.sql, c.var.user.sub, c.var.deps.now())))
  .post('/friends', async (c) => {
    const { code } = FriendBody.parse(await c.req.json());
    const [target] = await c.var.sql`select user_id from game.players where friend_code=${code}`;
    if (!target) throw notFound('Friend code not found');
    await friendAction(c.var.sql, c.var.deps, c.var.user.sub, target.user_id, 'request');
    return c.json({ ok: true });
  })
  .post('/friends/:id/:action', async (c) => {
    const action = z.enum(['accept', 'remove', 'block', 'unblock']).parse(c.req.param('action'));
    await friendAction(c.var.sql, c.var.deps, c.var.user.sub, uid(c.req.param('id')), action);
    return c.json({ ok: true });
  })
  .get('/visit/:id', async (c) =>
    c.json(await visit(c.var.sql, c.var.user.sub, uid(c.req.param('id')), c.var.deps.now())),
  )
  .post('/challenges', async (c) => {
    const { id } = IdBody.parse(await c.req.json());
    return c.json(await createChallenge(c.var.sql, c.var.deps, c.var.user.sub, id));
  })
  .post('/leagues', async (c) =>
    c.json(
      await joinGroup(c.var.sql, c.var.deps, c.var.user.sub, 'league', NameBody.parse(await c.req.json())),
    ),
  )
  .post('/leagues/join', async (c) =>
    c.json(
      await joinGroup(c.var.sql, c.var.deps, c.var.user.sub, 'league', CodeBody.parse(await c.req.json())),
    ),
  )
  .get('/leagues/:id', async (c) =>
    c.json(await standings(c.var.sql, c.var.user.sub, uid(c.req.param('id')), c.var.deps.now())),
  )
  .post('/rooms', async (c) =>
    c.json(
      await joinGroup(c.var.sql, c.var.deps, c.var.user.sub, 'room', NameBody.parse(await c.req.json())),
    ),
  )
  .post('/rooms/join', async (c) =>
    c.json(
      await joinGroup(c.var.sql, c.var.deps, c.var.user.sub, 'room', CodeBody.parse(await c.req.json())),
    ),
  )
  .post('/rooms/presence', async (c) => {
    await c.var
      .sql`update game.room_members set last_seen_at=${new Date(c.var.deps.now())} where user_id=${c.var.user.sub}`;
    return c.json({ ok: true });
  })
  .post('/rooms/leave', async (c) => {
    await c.var.sql`delete from game.room_members where user_id=${c.var.user.sub}`;
    return c.json({ ok: true });
  })
  .get('/notifications', async (c) => {
    const rows = await c.var
      .sql`select id,message from game.notifications where user_id=${c.var.user.sub} order by id limit 30`;
    return c.json({ notifications: rows });
  })
  .post('/notifications/read', async (c) => {
    const { through } = z
      .object({ through: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) })
      .parse(await c.req.json());
    await c.var.sql`delete from game.notifications where user_id=${c.var.user.sub} and id<=${through}`;
    return c.json({ ok: true });
  })
  .post('/replays/:id/share', async (c) => {
    const b = await getBattle(c.var.sql, uid(c.req.param('id')));
    if (
      !b ||
      b.status !== 'settled' ||
      (b.attacker_id !== c.var.user.sub && b.defender_id !== c.var.user.sub)
    )
      throw notFound();
    const [row] = await c.var
      .sql`update game.battles set share_token=coalesce(share_token,${crypto.randomUUID()}) where id=${b.id} returning share_token`;
    return c.json({ token: row!.share_token });
  })
  .get('/replays/:token', async (c) => {
    const [row] = await c.var.sql<
      { id: string }[]
    >`select id from game.battles where share_token=${uid(c.req.param('token'))} and status='settled'`;
    if (!row) throw notFound('Replay not found');
    const b = (await getBattle(c.var.sql, row.id))!;
    return c.json({ battle: battleSummary(b), setup: b.setup, commands: b.commands ?? [] });
  });
