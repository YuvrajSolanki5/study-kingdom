import {
  ClanRoleBody,
  DonationBody,
  IdBody,
  NameBody,
  ReceiptBody,
  RosterBody,
  WarChallengeBody,
} from '@sk/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../context.ts';
import {
  changeRole,
  claimObjective,
  claimReinforcements,
  clanView,
  createClan,
  donate,
  inviteMember,
  joinClan,
  leaveClan,
  requestReinforcements,
} from '../services/clans.ts';
import { advanceWars, challengeWar, respondWar } from '../services/wars.ts';
const id = (v: string) => z.uuid().parse(v);
export const clanRoutes = new Hono<AppEnv>()
  .get('/', async (c) => {
    await advanceWars(c.var.sql, c.var.deps);
    return c.json(await clanView(c.var.sql, c.var.deps, c.var.user.sub));
  })
  .post('/', async (c) =>
    c.json(await createClan(c.var.sql, c.var.deps, c.var.user.sub, NameBody.parse(await c.req.json()).name)),
  )
  .post('/invite', async (c) => {
    await inviteMember(c.var.sql, c.var.deps, c.var.user.sub, IdBody.parse(await c.req.json()).id);
    return c.json({ ok: true });
  })
  .post('/join', async (c) => {
    await joinClan(c.var.sql, c.var.deps, c.var.user.sub, IdBody.parse(await c.req.json()).id);
    return c.json({ ok: true });
  })
  .post('/role', async (c) => {
    const b = ClanRoleBody.parse(await c.req.json());
    await changeRole(c.var.sql, c.var.user.sub, b.userId, b.role);
    return c.json({ ok: true });
  })
  .post('/leave', async (c) => {
    await leaveClan(c.var.sql, c.var.user.sub);
    return c.json({ ok: true });
  })
  .post('/remove', async (c) => {
    await leaveClan(c.var.sql, c.var.user.sub, IdBody.parse(await c.req.json()).id);
    return c.json({ ok: true });
  })
  .post('/reinforcements', async (c) =>
    c.json(await requestReinforcements(c.var.sql, c.var.deps, c.var.user.sub)),
  )
  .post('/reinforcements/:id/donate', async (c) => {
    await donate(
      c.var.sql,
      c.var.deps,
      c.var.user.sub,
      id(c.req.param('id')),
      DonationBody.parse(await c.req.json()),
    );
    return c.json({ ok: true });
  })
  .post('/reinforcements/:id/claim', async (c) => {
    await claimReinforcements(
      c.var.sql,
      c.var.deps,
      c.var.user.sub,
      id(c.req.param('id')),
      ReceiptBody.parse(await c.req.json()).requestId,
    );
    return c.json({ ok: true });
  })
  .post('/objective/claim', async (c) => {
    await claimObjective(c.var.sql, c.var.deps, c.var.user.sub);
    return c.json({ ok: true });
  })
  .post('/wars', async (c) => {
    const b = WarChallengeBody.parse(await c.req.json());
    return c.json(await challengeWar(c.var.sql, c.var.deps, c.var.user.sub, b.clanId, b.roster));
  })
  .post('/wars/:id/accept', async (c) =>
    c.json(
      await respondWar(
        c.var.sql,
        c.var.deps,
        c.var.user.sub,
        id(c.req.param('id')),
        RosterBody.parse(await c.req.json()).roster,
      ),
    ),
  )
  .post('/wars/:id/decline', async (c) =>
    c.json(await respondWar(c.var.sql, c.var.deps, c.var.user.sub, id(c.req.param('id')), null)),
  );
