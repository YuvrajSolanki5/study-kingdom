import { getContent } from '@sk/content';
import { StartBattleBody, SubmitBattleBody } from '@sk/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../context.ts';
import { notFound } from '../errors.ts';
import {
  battleSummary,
  getBattle,
  listBattles,
  recordProgress,
  startBattle,
  submitBattle,
  verifyStep,
} from '../services/battles.ts';
import { getPlayer } from '../services/player.ts';

export const battleRoutes = new Hono<AppEnv>()
  .get('/', async (c) => c.json({ battles: await listBattles(c.var.sql, c.var.user.sub) }))
  .post('/', async (c) => {
    const body = StartBattleBody.parse(await c.req.json());
    return c.json(await startBattle(c.var.sql, c.var.deps, c.var.user.sub, body));
  })
  .get('/campaign', async (c) => {
    const player = await getPlayer(c.var.sql, c.var.user.sub);
    if (!player) throw notFound();
    const content = getContent(player.content_version);
    const progress = player.state.campaign;
    const bases = content.campaign.map((b, i) => ({
      id: b.id,
      order: b.order,
      name: b.name,
      description: b.description,
      hqLevel: b.hqLevel,
      stars: progress[b.id] ?? 0,
      unlocked: i === 0 || (progress[content.campaign[i - 1]!.id] ?? 0) > 0,
      starRewards: b.starRewards,
    }));
    return c.json({ bases });
  })
  .get('/:id', async (c) => {
    const b = await getBattle(c.var.sql, c.req.param('id'));
    const uid = c.var.user.sub;
    if (!b || (b.attacker_id !== uid && b.defender_id !== uid)) throw notFound('Battle not found');
    const withSetup = c.req.query('full') === '1';
    return c.json({
      battle: battleSummary(b),
      ...(withSetup ? { setup: b.setup, commands: b.commands ?? [] } : {}),
    });
  })
  .post('/:id/progress', async (c) => {
    const body = SubmitBattleBody.parse(await c.req.json());
    return c.json(await recordProgress(c.var.sql, c.var.user.sub, c.req.param('id'), body.commands));
  })
  .post('/:id/submit', async (c) => {
    const body = SubmitBattleBody.parse(await c.req.json());
    const battle = await submitBattle(
      c.var.sql,
      c.var.deps,
      c.var.user.sub,
      c.req.param('id'),
      body.commands,
      body.clientHash,
    );
    return c.json({ battle }, battle.status === 'verifying' ? 202 : 200);
  })
  .post('/:id/verify', async (c) => {
    const battle = await verifyStep(c.var.sql, c.var.deps, c.var.user.sub, c.req.param('id'));
    return c.json({ battle }, battle.status === 'verifying' ? 202 : 200);
  });
