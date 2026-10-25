import { updateWarLayout } from '../services/wars.ts';
import { getContent } from '@sk/content';
import { applyAction } from '@sk/rules';
import { ActionBody, DisplayName, StudySettingsBody, type ActionResponse, type PlayerView } from '@sk/shared';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../context.ts';
import { transaction } from '../db.ts';
import { finalizeExpired } from '../services/battles.ts';
import {
  aggregateOf,
  getPlayer,
  lockPlayer,
  provisionPlayer,
  validTimeZone,
  withReceipt,
  writePlayer,
  type PlayerRow,
} from '../services/player.ts';
import { activeSession } from '../services/study.ts';
import { buildView, settingsOf } from '../services/view.ts';

export async function viewFor(c: Context<AppEnv>, row: PlayerRow): Promise<PlayerView> {
  const sql = c.var.sql;
  const session = await activeSession(sql, row.user_id);
  const active = row.state.activeBattle?.id ?? null;
  const view = buildView(row, c.var.deps.now(), session, active);
  const cosmetics = await sql<
    { code: string }[]
  >`select code from game.cosmetics where user_id=${row.user_id}`;
  view.state.cosmetics = [...new Set([...view.state.cosmetics, ...cosmetics.map((r) => r.code)])];
  return view;
}

export const playerRoutes = new Hono<AppEnv>()
  .get('/', async (c) => {
    const { sql, deps, user } = c.var;
    let row = await provisionPlayer(sql, deps, user, c.req.header('x-timezone'));
    const exp = row.state.activeBattle?.expiresAt;
    if (exp && exp < deps.now()) {
      await finalizeExpired(sql, deps, { attackerId: user.sub });
      row = (await getPlayer(sql, user.sub)) ?? row;
    }
    return c.json(await viewFor(c, row));
  })
  .post('/actions', async (c) => {
    const { sql, deps, user } = c.var;
    const body = ActionBody.parse(await c.req.json());
    const row = await transaction(sql, async (tx) => {
      const player = await lockPlayer(tx, user.sub);
      const out = await withReceipt(tx, user.sub, body.requestId, 'action', async () => {
        const result = applyAction(
          { content: getContent(player.content_version), now: deps.now() },
          aggregateOf(player),
          body.action,
        );
        await updateWarLayout(tx, user.sub, result.agg.state, player.content_version, deps.now());
        return writePlayer(tx, player, result.agg, result.deltas, `req:${body.requestId}`);
      });
      return out.replayed ? player : out.value;
    });
    const response: ActionResponse = { view: await viewFor(c, row) };
    return c.json(response);
  })
  .patch('/profile', async (c) => {
    const { sql, user } = c.var;
    const body = z
      .object({ displayName: DisplayName.optional(), timezone: z.string().max(64).optional() })
      .parse(await c.req.json());
    const row = await transaction(sql, async (tx) => {
      await lockPlayer(tx, user.sub);
      if (body.displayName)
        await tx`update game.players set display_name = ${body.displayName} where user_id = ${user.sub}`;
      if (body.timezone)
        await tx`update game.players set timezone = ${validTimeZone(body.timezone)} where user_id = ${user.sub}`;
      return lockPlayer(tx, user.sub);
    });
    return c.json(await viewFor(c, row));
  })
  .put('/settings', async (c) => {
    const { sql, user } = c.var;
    const body = StudySettingsBody.parse(await c.req.json());
    const row = await transaction(sql, async (tx) => {
      const player = await lockPlayer(tx, user.sub);
      const { timezone, ...rest } = body;
      const settings = {
        ...settingsOf(player),
        ...Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)),
      };
      await tx`update game.players set settings = ${tx.json(settings as never)}
        ${timezone ? tx`, timezone = ${validTimeZone(timezone)}` : tx``} where user_id = ${user.sub}`;
      return lockPlayer(tx, user.sub);
    });
    return c.json(await viewFor(c, row));
  });
