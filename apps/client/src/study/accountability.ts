import type { StudySettings } from '@sk/shared';
import type { IntervalReport } from '../api/endpoints.ts';
import { desktop, type FrontApp } from '../platform/desktop.ts';
import { IS_DESKTOP } from '../platform/env.ts';

export type FocusState = 'focused' | 'grace' | 'distracted' | 'locked' | 'checkin' | 'unconfirmed';

export interface FocusStatus {
  state: FocusState;
  detail: string;
  graceLeftMs: number;
}

/**
 * Observes the device during computer-mode study. Providers only ever report
 * time to subtract; they cannot add credit. Neither mode can verify learning
 * or see which website is open in a browser.
 */
export interface Accountability {
  start(): void;
  stop(): void;
  /** Report for the interval since the previous call. */
  take(): IntervalReport;
  /** Put back an unsent report (failed heartbeat). */
  restore(r: IntervalReport): void;
  status(): FocusStatus;
  confirmCheckIn(): void;
}

const FOCUSED: FocusStatus = { state: 'focused', detail: '', graceLeftMs: 0 };

function merge(a: IntervalReport, b: IntervalReport): IntervalReport {
  return {
    distractedMs: (a.distractedMs ?? 0) + (b.distractedMs ?? 0),
    unconfirmedMs: (a.unconfirmedMs ?? 0) + (b.unconfirmedMs ?? 0),
    ...(b.idleMs !== undefined || a.idleMs !== undefined
      ? { idleMs: Math.max(a.idleMs ?? 0, b.idleMs ?? 0) }
      : {}),
    ...(a.frontApp || b.frontApp ? { frontApp: b.frontApp ?? a.frontApp } : {}),
  };
}

/** Paper mode: elapsed time only. No keyboard, mouse or app monitoring. */
export function paperAccountability(): Accountability {
  return {
    start() {},
    stop() {},
    take: () => ({}),
    restore() {},
    status: () => FOCUSED,
    confirmCheckIn() {},
  };
}

/**
 * Web computer mode: switching tabs to study materials is fine. A gentle
 * check-in appears every few minutes; if nobody answers within the reply
 * window, the following time is held for review instead of being credited.
 */
export function webAccountability(checkInMinutes: number, replyMinutes = 5): Accountability {
  let timer: ReturnType<typeof setInterval> | null = null;
  let nextCheckIn = 0;
  let checkInAt = 0;
  let last = 0;
  let pending: IntervalReport = {};
  const tick = () => {
    const now = Date.now();
    const dt = now - last;
    last = now;
    if (!checkInAt && now >= nextCheckIn) {
      checkInAt = now;
      document.title = 'Still studying? · Study Kingdom';
    }
    if (checkInAt && now - checkInAt > replyMinutes * 60_000)
      pending = merge(pending, { unconfirmedMs: Math.min(dt, now - checkInAt - replyMinutes * 60_000) });
  };
  return {
    start() {
      last = Date.now();
      nextCheckIn = last + checkInMinutes * 60_000;
      timer = setInterval(tick, 1000);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      document.title = 'Study Kingdom';
    },
    take() {
      tick();
      const r = pending;
      pending = {};
      return r;
    },
    restore(r) {
      pending = merge(r, pending);
    },
    status() {
      if (!checkInAt) return FOCUSED;
      const over = Date.now() - checkInAt > replyMinutes * 60_000;
      return over
        ? { state: 'unconfirmed', detail: 'Time since the check-in will need your review', graceLeftMs: 0 }
        : {
            state: 'checkin',
            detail: 'Tap “Still studying” to keep earning',
            graceLeftMs: checkInAt + replyMinutes * 60_000 - Date.now(),
          };
    },
    confirmCheckIn() {
      checkInAt = 0;
      nextCheckIn = Date.now() + checkInMinutes * 60_000;
      document.title = 'Study Kingdom';
    },
  };
}

/**
 * Mac computer mode: earnings pause after a grace period away from the
 * allowlisted apps, and while the screen is locked. A browser on the
 * allowlist counts as allowed whatever site it shows.
 */
export function macAccountability(settings: StudySettings): Accountability {
  let timer: ReturnType<typeof setInterval> | null = null;
  let last = 0;
  let awaySince = 0;
  let current: FrontApp | null = null;
  let pending: IntervalReport = {};
  let status: FocusStatus = FOCUSED;
  const allowed = new Set(settings.allowedApps.map((a) => a.bundleId));
  const graceMs = settings.graceSeconds * 1000;
  const poll = async () => {
    const now = Date.now();
    const dt = Math.min(now - last, 10_000);
    last = now;
    try {
      current = await desktop.frontApp();
    } catch {
      return;
    }
    const ok =
      !current.locked && (current.bundleId === current.selfBundleId || allowed.has(current.bundleId));
    if (current.locked) {
      pending = merge(pending, { distractedMs: dt, idleMs: current.idleSeconds * 1000, frontApp: 'locked' });
      status = { state: 'locked', detail: 'Screen locked — earnings paused', graceLeftMs: 0 };
      return;
    }
    if (ok) {
      awaySince = 0;
      status = FOCUSED;
      pending = merge(pending, { idleMs: current.idleSeconds * 1000, frontApp: current.bundleId });
      return;
    }
    awaySince ||= now - dt;
    const away = now - awaySince;
    if (away <= graceMs) {
      status = {
        state: 'grace',
        detail: `${current.name} is not on your study list`,
        graceLeftMs: graceMs - away,
      };
      pending = merge(pending, { frontApp: current.bundleId });
    } else {
      const over = Math.min(dt, away - graceMs);
      status = { state: 'distracted', detail: `${current.name} — earnings paused`, graceLeftMs: 0 };
      pending = merge(pending, { distractedMs: over, frontApp: current.bundleId });
    }
  };
  return {
    start() {
      last = Date.now();
      timer = setInterval(() => void poll(), 1000);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    take() {
      const r = pending;
      pending = {};
      return r;
    },
    restore(r) {
      pending = merge(r, pending);
    },
    status: () => status,
    confirmCheckIn() {},
  };
}

export function accountabilityFor(
  mode: 'computer' | 'paper',
  settings: StudySettings,
  checkInMinutes: number,
): Accountability {
  if (mode === 'paper') return paperAccountability();
  return IS_DESKTOP ? macAccountability(settings) : webAccountability(checkInMinutes);
}
