import { getContent } from '@sk/content';
import {
  CompleteBody,
  HeartbeatBody,
  PauseBody,
  ReviewBody,
  StartSessionBody,
  type StudyHistory,
} from '@sk/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../context.ts';
import { getPlayer } from '../services/player.ts';
import {
  activeSession,
  completeSession,
  heartbeat,
  reviewSession,
  setPaused,
  startSession,
} from '../services/study.ts';
import { sessionView, settingsOf, type SessionRow } from '../services/view.ts';
import { viewFor } from './player.ts';
import { notFound } from '../errors.ts';
import { localDate } from '@sk/rules';

export const studyRoutes = new Hono<AppEnv>()
  .get('/current', async (c) => {
    const row = await activeSession(c.var.sql, c.var.user.sub);
    return c.json({ session: row ? sessionView(row, getContent().economy.study.reviewWindowHours) : null });
  })
  .post('/sessions', async (c) => {
    const body = StartSessionBody.parse(await c.req.json());
    const session = await startSession(c.var.sql, c.var.deps, c.var.user.sub, body);
    return c.json({ session });
  })
  .post('/sessions/:id/heartbeat', async (c) => {
    const body = HeartbeatBody.parse(await c.req.json());
    const session = await heartbeat(c.var.sql, c.var.deps, c.var.user.sub, c.req.param('id'), body);
    return c.json({ session });
  })
  .post('/sessions/:id/pause', async (c) => {
    const body = PauseBody.parse(await c.req.json());
    const session = await setPaused(
      c.var.sql,
      c.var.deps,
      c.var.user.sub,
      c.req.param('id'),
      body.deviceId,
      true,
      body.report,
    );
    return c.json({ session });
  })
  .post('/sessions/:id/resume', async (c) => {
    const body = PauseBody.parse(await c.req.json());
    const session = await setPaused(
      c.var.sql,
      c.var.deps,
      c.var.user.sub,
      c.req.param('id'),
      body.deviceId,
      false,
      body.report,
    );
    return c.json({ session });
  })
  .post('/sessions/:id/complete', async (c) => {
    const body = CompleteBody.parse(await c.req.json());
    const out = await completeSession(c.var.sql, c.var.deps, c.var.user.sub, c.req.param('id'), body);
    return c.json({ session: out.session, view: await viewFor(c, out.player) });
  })
  .post('/sessions/:id/stop', async (c) => {
    const body = CompleteBody.parse(await c.req.json());
    const out = await completeSession(
      c.var.sql,
      c.var.deps,
      c.var.user.sub,
      c.req.param('id'),
      body,
      'abandoned',
    );
    return c.json({ session: out.session, view: await viewFor(c, out.player) });
  })
  .post('/sessions/:id/review', async (c) => {
    const body = ReviewBody.parse(await c.req.json());
    const out = await reviewSession(c.var.sql, c.var.deps, c.var.user.sub, c.req.param('id'), body);
    return c.json({ session: out.session, view: await viewFor(c, out.player) });
  })
  .get('/history', async (c) => {
    const { sql, user, deps } = c.var;
    const player = await getPlayer(sql, user.sub);
    if (!player) throw notFound();
    const cfg = getContent(player.content_version).economy.study;
    const settings = settingsOf(player);
    const sessions = await sql<SessionRow[]>`
      select * from game.study_sessions where user_id = ${user.sub} order by created_at desc limit 50`;
    const days = await sql<{ date: string; seconds: number; competitive: number; sessions: number }[]>`
      select local_date as date, sum(eligible_seconds + reviewed_seconds)::int as seconds,
        sum(competitive_seconds)::int as competitive, count(*)::int as sessions
      from game.study_sessions
      where user_id = ${user.sub} and local_date is not null and local_date > (current_date - 30)
      group by local_date order by local_date desc`;
    const subjects = await sql<{ subject: string; seconds: number }[]>`
      select s as subject, sum(eligible_seconds + reviewed_seconds)::int as seconds
      from game.study_sessions, jsonb_array_elements_text(subjects) s
      where user_id = ${user.sub} and local_date > (current_date - 30)
      group by s order by seconds desc limit 20`;
    const today = localDate(deps.now(), player.timezone);
    const todayRow = days.find((d) => d.date === today);
    const weekStart = new Date(deps.now() - 6 * 86400_000);
    const weekFrom = localDate(weekStart.getTime(), player.timezone);
    const history: StudyHistory = {
      sessions: sessions.map((s) => sessionView(s, cfg.reviewWindowHours)),
      days: days.map((d) => ({
        date: d.date,
        seconds: d.seconds,
        competitiveSeconds: d.competitive,
        sessions: d.sessions,
      })),
      today: {
        seconds: todayRow?.seconds ?? 0,
        competitiveSeconds: todayRow?.competitive ?? 0,
        goalMinutes: settings.dailyGoalMinutes,
      },
      week: {
        seconds: days.filter((d) => d.date >= weekFrom).reduce((a, d) => a + d.seconds, 0),
        goalMinutes: settings.weeklyGoalMinutes,
      },
      subjects,
    };
    return c.json(history);
  });
