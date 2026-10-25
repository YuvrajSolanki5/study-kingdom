import { getContent } from '@sk/content';
import { settle, storageCapacity, type SessionClock } from '@sk/rules';
import type { PlayerView, Profile, SessionView, StudySettings } from '@sk/shared';
import type { PlayerRow } from './player.ts';

export const DEFAULT_SETTINGS: StudySettings = {
  dailyGoalMinutes: 50,
  weeklyGoalMinutes: 300,
  subjects: [],
  allowedApps: [],
  graceSeconds: 60,
};

export function settingsOf(row: PlayerRow): StudySettings {
  return { ...DEFAULT_SETTINGS, ...(row.settings as Partial<StudySettings>) };
}

export function profileOf(row: PlayerRow): Profile {
  return {
    userId: row.user_id,
    displayName: row.display_name,
    friendCode: row.friend_code,
    timezone: row.timezone,
    trophies: row.trophies,
    hqLevel: row.hq_level,
    settings: settingsOf(row),
    shieldUntil: row.shield_until ? row.shield_until.getTime() : null,
  };
}

export interface SessionRow {
  id: string;
  user_id: string;
  device_id: string;
  platform: 'web' | 'desktop';
  mode: 'computer' | 'paper';
  status: SessionView['status'];
  goal: string;
  subjects: string[];
  planned_minutes: number;
  clock: SessionClock;
  heartbeat_seq: number;
  started_at: Date | null;
  ended_at: Date | null;
  last_seen_at: Date;
  local_date: string | Date | null;
  eligible_seconds: number;
  unreviewed_seconds: number;
  reviewed_seconds: number;
  reviewed_at: Date | null;
  competitive_seconds: number;
  reward_gold: number;
  reward_essence: number;
  overflow_gold: number;
  overflow_essence: number;
  bonus_percent: number;
  recall: unknown;
  end_reason: string | null;
}

export function sessionView(row: SessionRow, reviewWindowHours: number): SessionView {
  const ended = row.status === 'completed' || row.status === 'abandoned';
  const localDate =
    row.local_date instanceof Date ? row.local_date.toISOString().slice(0, 10) : (row.local_date ?? null);
  return {
    id: row.id,
    status: row.status,
    mode: row.mode,
    platform: row.platform,
    deviceId: row.device_id,
    goal: row.goal,
    subjects: row.subjects,
    plannedMinutes: row.planned_minutes,
    startedAt: row.started_at?.getTime() ?? null,
    endedAt: row.ended_at?.getTime() ?? null,
    eligibleSeconds: Math.floor(row.clock.eligibleMs / 1000),
    pausedSeconds: Math.floor(row.clock.pausedMs / 1000),
    unreviewedSeconds: Math.floor(row.clock.unreviewedMs / 1000),
    distractedSeconds: Math.floor(row.clock.distractedMs / 1000),
    reviewedSeconds: row.reviewed_seconds,
    heartbeatSeq: row.heartbeat_seq,
    serverLastAt: row.clock.lastAt,
    reward: ended
      ? {
          gold: row.reward_gold,
          essence: row.reward_essence,
          overflowGold: row.overflow_gold,
          overflowEssence: row.overflow_essence,
          bonusPercent: row.bonus_percent,
        }
      : null,
    competitiveSeconds: row.competitive_seconds,
    endReason: row.end_reason,
    recall: row.recall,
    localDate,
    reviewDeadline:
      ended && row.ended_at && !row.reviewed_at && row.unreviewed_seconds > 0
        ? row.ended_at.getTime() + reviewWindowHours * 3600_000
        : null,
  };
}

/** The client's whole picture of the player, with timers settled to `now`. */
export function buildView(
  row: PlayerRow,
  now: number,
  activeSession: SessionRow | null,
  activeBattleId: string | null,
): PlayerView {
  const content = getContent(row.content_version);
  const state = structuredClone(row.state);
  settle(content, state, now);
  return {
    serverTime: now,
    contentVersion: row.content_version,
    profile: profileOf(row),
    wallet: { gold: row.gold, essence: row.essence, capacity: storageCapacity(content, state) },
    state,
    activeSession: activeSession ? sessionView(activeSession, content.economy.study.reviewWindowHours) : null,
    activeBattleId,
  };
}
