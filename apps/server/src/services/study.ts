import { getContent, type StudyConfig } from '@sk/content';
import {
  accrue,
  computeStudyReward,
  credit,
  hqLevel,
  localDate,
  newClock,
  reviewableSeconds,
  settle,
  transition,
  type IntervalReport,
  type LedgerDelta,
  type SessionClock,
} from '@sk/rules';
import type { CompleteBody, HeartbeatBody, ReviewBody, StartSessionBody } from '@sk/shared';
import type { z } from 'zod';
import type { Deps } from '../context.ts';
import type { Sql, Tx } from '../db.ts';
import { transaction } from '../db.ts';
import { conflict, HttpError, notFound } from '../errors.ts';
import { aggregateOf, lockPlayer, withReceipt, writePlayer, type PlayerRow } from './player.ts';
import { sessionView, type SessionRow } from './view.ts';

const ACTIVE = ['created', 'running', 'paused'];

function studyCfg(row: PlayerRow): StudyConfig {
  return getContent(row.content_version).economy.study;
}

export async function activeSession(sql: Sql | Tx, userId: string): Promise<SessionRow | null> {
  const [row] = await sql<SessionRow[]>`
    select * from game.study_sessions where user_id = ${userId} and status in ${sql(ACTIVE)} limit 1`;
  return row ?? null;
}

async function lockSession(tx: Tx, userId: string, id: string): Promise<SessionRow> {
  const [row] = await tx<SessionRow[]>`
    select * from game.study_sessions where id = ${id} and user_id = ${userId} for update`;
  if (!row) throw notFound('Session not found');
  return row;
}

async function saveClock(
  tx: Tx,
  row: SessionRow,
  clock: SessionClock,
  now: number,
  extra: { seq?: number; device?: string } = {},
) {
  const [updated] = await tx<SessionRow[]>`
    update game.study_sessions set clock = ${tx.json(clock as never)}, status = ${clock.status},
      heartbeat_seq = ${extra.seq ?? row.heartbeat_seq}, device_id = ${extra.device ?? row.device_id},
      last_seen_at = ${new Date(now)}, eligible_seconds = ${Math.floor(clock.eligibleMs / 1000)},
      unreviewed_seconds = ${Math.floor(clock.unreviewedMs / 1000)}
    where id = ${row.id} returning *`;
  return updated as SessionRow;
}

export async function startSession(
  sql: Sql,
  deps: Deps,
  userId: string,
  body: z.infer<typeof StartSessionBody>,
) {
  const now = deps.now();
  return transaction(sql, async (tx) => {
    const player = await lockPlayer(tx, userId);
    const cfg = studyCfg(player);
    const existing = await activeSession(tx, userId);
    if (existing) {
      if (existing.device_id === body.deviceId) return sessionView(existing, cfg.reviewWindowHours);
      if (!body.takeOver)
        throw conflict('session_active', 'A study session is already running on another device', {
          session: sessionView(existing, cfg.reviewWindowHours),
        });
      // Continue the same session here; the other device's heartbeats will be refused.
      const clock = accrue(cfg, existing.clock, now);
      const moved = await saveClock(tx, existing, clock, now, { device: body.deviceId });
      return sessionView(moved, cfg.reviewWindowHours);
    }
    const out = await withReceipt(
      tx,
      userId,
      body.requestId,
      'study_start',
      async () => {
        const clock = transition(cfg, newClock(body.mode, now), 'running', now);
        const [row] = await tx<SessionRow[]>`
          insert into game.study_sessions (user_id, device_id, platform, mode, status, goal, subjects,
            planned_minutes, clock, started_at, created_at, last_seen_at)
          values (${userId}, ${body.deviceId}, ${body.platform}, ${body.mode}, ${clock.status}, ${body.goal},
            ${tx.json(body.subjects)}, ${body.plannedMinutes}, ${tx.json(clock as never)}, ${new Date(now)},
            ${new Date(now)}, ${new Date(now)})
          returning *`;
        return row as SessionRow;
      },
      (row) => ({ sessionId: row.id }),
    );
    if (out.replayed) {
      const id = (out.response as { sessionId: string }).sessionId;
      return sessionView(await lockSession(tx, userId, id), cfg.reviewWindowHours);
    }
    return sessionView(out.value, cfg.reviewWindowHours);
  });
}

function assertOwner(row: SessionRow, deviceId: string) {
  if (row.status === 'completed' || row.status === 'abandoned')
    throw conflict('session_ended', 'This session has already ended');
  if (row.device_id !== deviceId) throw conflict('session_moved', 'This session continued on another device');
}

/**
 * Heartbeats are the most frequent request, so they avoid a locking
 * transaction: read, compute, then a compare-and-swap update that only
 * applies if nothing changed the session in between (2 round trips).
 */
export async function heartbeat(
  sql: Sql,
  deps: Deps,
  userId: string,
  id: string,
  body: z.infer<typeof HeartbeatBody>,
) {
  const now = deps.now();
  const cfg = getContent().economy.study;
  for (let attempt = 0; attempt < 3; attempt++) {
    const [row] = await sql<SessionRow[]>`
      select * from game.study_sessions where id = ${id} and user_id = ${userId}`;
    if (!row) throw notFound('Session not found');
    assertOwner(row, body.deviceId);
    // Replayed or out-of-order heartbeats change nothing.
    if (body.seq <= row.heartbeat_seq) return sessionView(row, cfg.reviewWindowHours);
    const clock = accrue(cfg, row.clock, now, body.report as IntervalReport);
    const [updated] = await sql<SessionRow[]>`
      update game.study_sessions set clock = ${sql.json(clock as never)}, heartbeat_seq = ${body.seq},
        last_seen_at = ${new Date(now)}, eligible_seconds = ${Math.floor(clock.eligibleMs / 1000)},
        unreviewed_seconds = ${Math.floor(clock.unreviewedMs / 1000)}
      where id = ${id} and heartbeat_seq = ${row.heartbeat_seq} and status = ${row.status}
        and device_id = ${row.device_id}
      returning *`;
    if (updated) return sessionView(updated, cfg.reviewWindowHours);
  }
  throw conflict('busy', 'Session changed concurrently; try again');
}

export async function setPaused(
  sql: Sql,
  deps: Deps,
  userId: string,
  id: string,
  deviceId: string,
  paused: boolean,
  report: IntervalReport,
) {
  const now = deps.now();
  return transaction(sql, async (tx) => {
    const row = await lockSession(tx, userId, id);
    assertOwner(row, deviceId);
    const cfg = getContent().economy.study;
    const target = paused ? 'paused' : 'running';
    if (row.status === target) return sessionView(row, cfg.reviewWindowHours);
    const clock = transition(cfg, row.clock, target, now, report);
    return sessionView(await saveClock(tx, row, clock, now), cfg.reviewWindowHours);
  });
}

async function dayTotals(tx: Tx, userId: string, date: string, excludeId: string) {
  const [t] = await tx<{ credited: number; competitive: number; reviewed: number }[]>`
    select coalesce(sum(eligible_seconds + reviewed_seconds), 0)::int as credited,
           coalesce(sum(competitive_seconds), 0)::int as competitive,
           coalesce(sum(reviewed_seconds), 0)::int as reviewed
    from game.study_sessions
    where user_id = ${userId} and local_date = ${date} and status in ('completed', 'abandoned') and id <> ${excludeId}`;
  return t ?? { credited: 0, competitive: 0, reviewed: 0 };
}

interface FinishOptions {
  status: 'completed' | 'abandoned';
  reason: string;
  report: IntervalReport;
  recall?: z.infer<typeof CompleteBody>['recall'];
  reviewSeconds: number;
  /** Close at the last heartbeat instead of now: the trailing gap is unknown and never reviewable. */
  atLastSeen: boolean;
}

/** Ends a session and pays its reward exactly once (ledger keys are per session). */
async function finish(tx: Tx, deps: Deps, player: PlayerRow, row: SessionRow, opts: FinishOptions) {
  const content = getContent(player.content_version);
  const cfg = content.economy.study;
  const now = deps.now();
  const endAt = opts.atLastSeen ? row.clock.lastAt : now;
  let clock = transition(cfg, row.clock, opts.status, endAt, opts.report);
  const date = localDate(endAt, player.timezone);
  const totals = await dayTotals(tx, player.user_id, date, row.id);
  const dailyReviewLeft = Math.max(0, cfg.maxReviewMinutesPerDay * 60 - totals.reviewed);
  const review = Math.min(opts.reviewSeconds, reviewableSeconds(cfg, clock), dailyReviewLeft);
  clock = { ...clock, unreviewedMs: Math.max(0, clock.unreviewedMs - review * 1000) };
  const agg = aggregateOf(player);
  settle(content, agg.state, now);
  const reward = computeStudyReward(content, {
    hq: hqLevel(agg.state),
    dailySecondsBefore: totals.credited,
    competitiveSecondsBefore: totals.competitive,
    eligibleSeconds: Math.floor(clock.eligibleMs / 1000),
    reviewedSeconds: review,
    plannedMinutes: row.planned_minutes,
    completed: opts.status === 'completed',
    recallDone: !!opts.recall && opts.recall.summary.length >= 20,
  });
  const deltas: LedgerDelta[] = [];
  const paid = credit(
    { content, now },
    agg,
    { gold: reward.gold, essence: reward.essence },
    deltas,
    'study_reward',
    `study:${row.id}`,
  );
  const updatedPlayer = await writePlayer(tx, player, agg, deltas, `study:${row.id}`);
  // Gaps bounded by heartbeats stay reviewable for a while. An abandoned
  // session's trailing silence was never accrued (closed at its last heartbeat).
  const unreviewed = Math.floor(clock.unreviewedMs / 1000);
  const [ended] = await tx<SessionRow[]>`
    update game.study_sessions set status = ${opts.status}, clock = ${tx.json(clock as never)},
      ended_at = ${new Date(endAt)}, local_date = ${date}, last_seen_at = ${new Date(now)},
      eligible_seconds = ${Math.floor(clock.eligibleMs / 1000)}, unreviewed_seconds = ${unreviewed},
      reviewed_seconds = ${review}, reviewed_at = ${review > 0 ? new Date(now) : null},
      competitive_seconds = ${reward.competitiveSeconds}, reward_gold = ${paid.gold},
      reward_essence = ${paid.essence}, overflow_gold = ${paid.overflowGold},
      overflow_essence = ${paid.overflowEssence}, bonus_percent = ${reward.bonusPercent},
      recall = ${opts.recall ? tx.json(opts.recall as never) : null}, end_reason = ${opts.reason}
    where id = ${row.id} returning *`;
  return { session: sessionView(ended as SessionRow, cfg.reviewWindowHours), player: updatedPlayer };
}

export async function completeSession(
  sql: Sql,
  deps: Deps,
  userId: string,
  id: string,
  body: z.infer<typeof CompleteBody>,
  status: 'completed' | 'abandoned' = 'completed',
) {
  return transaction(sql, async (tx) => {
    const player = await lockPlayer(tx, userId);
    const row = await lockSession(tx, userId, id);
    const cfg = studyCfg(player);
    if (row.status === 'completed' || row.status === 'abandoned')
      return { session: sessionView(row, cfg.reviewWindowHours), player };
    if (row.device_id !== body.deviceId)
      throw conflict('session_moved', 'This session continued on another device');
    const out = await withReceipt(
      tx,
      userId,
      body.requestId,
      'study_complete',
      () =>
        finish(tx, deps, player, row, {
          status,
          reason: status === 'completed' ? 'completed' : 'stopped',
          report: body.report as IntervalReport,
          recall: body.recall,
          reviewSeconds: body.reviewSeconds,
          atLastSeen: false,
        }),
      (r) => ({ sessionId: r.session.id }),
    );
    if (out.replayed)
      return { session: sessionView(await lockSession(tx, userId, id), cfg.reviewWindowHours), player };
    return out.value;
  });
}

/** Grants reviewed disconnected time after the session ended (resources and history only). */
export async function reviewSession(
  sql: Sql,
  deps: Deps,
  userId: string,
  id: string,
  body: z.infer<typeof ReviewBody>,
) {
  const now = deps.now();
  return transaction(sql, async (tx) => {
    const player = await lockPlayer(tx, userId);
    const row = await lockSession(tx, userId, id);
    const content = getContent(player.content_version);
    const cfg = content.economy.study;
    if (row.status !== 'completed' && row.status !== 'abandoned')
      throw conflict('session_active', 'Finish the session first');
    if (row.reviewed_at) return { session: sessionView(row, cfg.reviewWindowHours), player };
    if (!row.ended_at || now > row.ended_at.getTime() + cfg.reviewWindowHours * 3600_000)
      throw new HttpError(410, 'review_expired', 'The review window for this session has closed');
    const date =
      typeof row.local_date === 'string'
        ? row.local_date
        : (row.local_date as Date).toISOString().slice(0, 10);
    const totals = await dayTotals(tx, userId, date, row.id);
    const dailyReviewLeft = Math.max(0, cfg.maxReviewMinutesPerDay * 60 - totals.reviewed);
    const seconds = Math.min(
      body.seconds,
      row.unreviewed_seconds,
      cfg.maxReviewMinutesPerSession * 60,
      dailyReviewLeft,
    );
    const agg = aggregateOf(player);
    settle(content, agg.state, now);
    const reward = computeStudyReward(content, {
      hq: hqLevel(agg.state),
      dailySecondsBefore: totals.credited + row.eligible_seconds,
      competitiveSecondsBefore: 0,
      eligibleSeconds: 0,
      reviewedSeconds: seconds,
      plannedMinutes: row.planned_minutes,
      completed: false,
      recallDone: false,
    });
    const deltas: LedgerDelta[] = [];
    const paid = credit({ content, now }, agg, reward, deltas, 'study_review', `study:${row.id}:review`);
    const updatedPlayer = await writePlayer(tx, player, agg, deltas, `study:${row.id}:review`);
    const [updated] = await tx<SessionRow[]>`
      update game.study_sessions set reviewed_seconds = ${seconds}, reviewed_at = ${new Date(now)},
        unreviewed_seconds = ${row.unreviewed_seconds - seconds},
        reward_gold = reward_gold + ${paid.gold}, reward_essence = reward_essence + ${paid.essence},
        overflow_gold = overflow_gold + ${paid.overflowGold}, overflow_essence = overflow_essence + ${paid.overflowEssence}
      where id = ${row.id} returning *`;
    return { session: sessionView(updated as SessionRow, cfg.reviewWindowHours), player: updatedPlayer };
  });
}

/** Cron: closes sessions whose device stopped sending heartbeats. Returns how many were closed. */
export async function closeStaleSessions(sql: Sql, deps: Deps, limit = 20): Promise<number> {
  const cfg = getContent().economy.study;
  const cutoff = new Date(deps.now() - cfg.staleSessionMinutes * 60_000);
  const stale = await sql<{ id: string; user_id: string }[]>`
    select id, user_id from game.study_sessions
    where status in ${sql(ACTIVE)} and last_seen_at < ${cutoff}
    order by last_seen_at limit ${limit}`;
  let closed = 0;
  for (const s of stale) {
    await transaction(sql, async (tx) => {
      const player = await lockPlayer(tx, s.user_id);
      const row = await lockSession(tx, s.user_id, s.id);
      if (!ACTIVE.includes(row.status) || row.last_seen_at > cutoff) return;
      await finish(tx, deps, player, row, {
        status: 'abandoned',
        reason: 'connection_lost',
        report: {},
        reviewSeconds: 0,
        atLastSeen: true,
      });
      closed++;
    });
  }
  return closed;
}
