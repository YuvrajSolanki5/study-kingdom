import { hqTier, type GameContent, type StudyConfig } from '@sk/content';

export type StudyMode = 'computer' | 'paper';
export type StudyPlatform = 'web' | 'desktop';
export type SessionStatus = 'created' | 'running' | 'paused' | 'completed' | 'abandoned';

/** Server-side accounting for one session. All durations are milliseconds of server time. */
export interface SessionClock {
  status: SessionStatus;
  mode: StudyMode;
  /** Server time up to which time has been classified. */
  lastAt: number;
  eligibleMs: number;
  pausedMs: number;
  /** Disconnected or unconfirmed time awaiting the player's review. */
  unreviewedMs: number;
  /** Time away from allowed apps beyond the grace period (computer mode). */
  distractedMs: number;
  /** Eligible time beyond the maximum session length; never credited. */
  overtimeMs: number;
  gaps: number;
}

/**
 * What the client observed during the interval since its previous report.
 * Reports can only reduce credit: the server never grants more than elapsed
 * server time.
 */
export interface IntervalReport {
  /** Time beyond the grace period in non-allowlisted apps, or with the screen locked. */
  distractedMs?: number;
  /** Time after an unanswered web check-in. */
  unconfirmedMs?: number;
}

export const TRANSITIONS: Record<SessionStatus, SessionStatus[]> = {
  created: ['running', 'abandoned'],
  running: ['paused', 'completed', 'abandoned'],
  paused: ['running', 'completed', 'abandoned'],
  completed: [],
  abandoned: [],
};

export function canTransition(from: SessionStatus, to: SessionStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function newClock(mode: StudyMode, now: number): SessionClock {
  return {
    status: 'created',
    mode,
    lastAt: now,
    eligibleMs: 0,
    pausedMs: 0,
    unreviewedMs: 0,
    distractedMs: 0,
    overtimeMs: 0,
    gaps: 0,
  };
}

const clampMs = (v: number | undefined, max: number) =>
  Math.max(0, Math.min(max, Number.isFinite(v) ? Math.floor(v as number) : 0));

/**
 * Classifies server time elapsed since the last accounting point. A gap longer
 * than the heartbeat tolerance (sleep, crash, lost connection) is held for
 * review instead of being credited. Clock changes on the device cannot matter
 * because only server time is used.
 */
export function accrue(
  cfg: StudyConfig,
  clock: SessionClock,
  now: number,
  report: IntervalReport = {},
): SessionClock {
  const c = { ...clock };
  const dt = Math.max(0, now - c.lastAt);
  c.lastAt = Math.max(c.lastAt, now);
  if (c.status === 'paused') {
    c.pausedMs += dt;
    return c;
  }
  if (c.status !== 'running') return c;
  if (dt > cfg.maxHeartbeatGapSeconds * 1000) {
    c.unreviewedMs += dt;
    c.gaps++;
    return c;
  }
  let distracted = 0;
  let unconfirmed = 0;
  if (c.mode === 'computer') {
    distracted = clampMs(report.distractedMs, dt);
    unconfirmed = clampMs(report.unconfirmedMs, dt - distracted);
  }
  c.distractedMs += distracted;
  c.unreviewedMs += unconfirmed;
  let eligible = dt - distracted - unconfirmed;
  const max = cfg.maxSessionMinutes * 60_000;
  if (c.eligibleMs + eligible > max) {
    const over = c.eligibleMs + eligible - max;
    c.overtimeMs += over;
    eligible -= over;
  }
  c.eligibleMs += eligible;
  return c;
}

export function transition(
  cfg: StudyConfig,
  clock: SessionClock,
  to: SessionStatus,
  now: number,
  report: IntervalReport = {},
): SessionClock {
  if (!canTransition(clock.status, to)) throw new Error(`invalid transition ${clock.status} -> ${to}`);
  const c = clock.status === 'created' ? { ...clock, lastAt: now } : accrue(cfg, clock, now, report);
  c.status = to;
  return c;
}

export interface RewardInput {
  hq: number;
  /** Credited study seconds earlier on the same local day. */
  dailySecondsBefore: number;
  /** Competitive seconds already counted on the same local day. */
  competitiveSecondsBefore: number;
  eligibleSeconds: number;
  /** Reviewed disconnected seconds: earn resources, never competitive credit. */
  reviewedSeconds: number;
  plannedMinutes: number;
  completed: boolean;
  recallDone: boolean;
}

export interface StudyReward {
  gold: number;
  essence: number;
  creditedSeconds: number;
  competitiveSeconds: number;
  bonusPercent: number;
  fullRateSeconds: number;
  reducedRateSeconds: number;
}

export function computeStudyReward(content: GameContent, input: RewardInput): StudyReward {
  const cfg = content.economy.study;
  const tier = hqTier(content, input.hq);
  const credited =
    Math.max(0, Math.floor(input.eligibleSeconds)) + Math.max(0, Math.floor(input.reviewedSeconds));
  const zero: StudyReward = {
    gold: 0,
    essence: 0,
    creditedSeconds: credited,
    competitiveSeconds: 0,
    bonusPercent: 0,
    fullRateSeconds: 0,
    reducedRateSeconds: 0,
  };
  if (credited < cfg.minRewardSeconds) return { ...zero, creditedSeconds: credited };
  const fullLeft = Math.max(0, cfg.fullRateDailyMinutes * 60 - input.dailySecondsBefore);
  const fullRateSeconds = Math.min(credited, fullLeft);
  const reducedRateSeconds = credited - fullRateSeconds;
  const effectiveSeconds = fullRateSeconds + (reducedRateSeconds * cfg.reducedRatePercent) / 100;
  let bonusPercent = 0;
  const eligibleMinutes = input.eligibleSeconds / 60;
  if (
    input.completed &&
    eligibleMinutes >= cfg.completionBonusMinMinutes &&
    eligibleMinutes >= input.plannedMinutes * 0.9
  )
    bonusPercent += cfg.completionBonusPercent;
  if (input.recallDone && input.completed) bonusPercent += cfg.recallBonusPercent;
  const mult = (100 + bonusPercent) / 100;
  const gold = Math.floor(((effectiveSeconds * tier.studyGoldPerMinute) / 60) * mult);
  const essence = Math.floor(((effectiveSeconds * tier.studyEssencePerMinute) / 60) * mult);
  const capLeft = Math.max(0, cfg.competitiveDailyCapMinutes * 60 - input.competitiveSecondsBefore);
  const competitiveSeconds = Math.min(Math.floor(input.eligibleSeconds), capLeft);
  return {
    gold,
    essence,
    creditedSeconds: credited,
    competitiveSeconds,
    bonusPercent,
    fullRateSeconds,
    reducedRateSeconds,
  };
}

/** Reviewable seconds for a session: unreviewed time up to the per-session cap. */
export function reviewableSeconds(cfg: StudyConfig, clock: SessionClock): number {
  return Math.min(Math.floor(clock.unreviewedMs / 1000), cfg.maxReviewMinutesPerSession * 60);
}

/** Local calendar date (YYYY-MM-DD) of an instant in an IANA time zone. */
export function localDate(epochMs: number, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(epochMs));
    return parts;
  } catch {
    return new Date(epochMs).toISOString().slice(0, 10);
  }
}
