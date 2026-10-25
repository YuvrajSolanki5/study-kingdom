import { getContent } from '@sk/content';
import type { SessionView } from '@sk/shared';
import { create } from 'zustand';
import { study, type IntervalReport } from '../api/endpoints.ts';
import { ApiError, isNetworkError } from '../api/http.ts';
import { sfx } from '../game/audio.ts';
import { desktop } from '../platform/desktop.ts';
import { IS_DESKTOP, PLATFORM } from '../platform/env.ts';
import { deviceId } from '../platform/storage.ts';
import { serverNow, useGame } from '../state/store.ts';
import { accountabilityFor, type Accountability, type FocusStatus } from './accountability.ts';

interface StudyUi {
  focus: FocusStatus;
  offline: boolean;
  plannedReached: boolean;
  /** Set when this device lost ownership of the session. */
  movedAway: boolean;
  set(p: Partial<StudyUi>): void;
}

export const useStudyUi = create<StudyUi>((set) => ({
  focus: { state: 'focused', detail: '', graceLeftMs: 0 },
  offline: false,
  plannedReached: false,
  movedAway: false,
  set: (p) => set(p),
}));

/**
 * Drives the session owned by this device: heartbeats every 30 s, retries
 * while offline, wake/sleep handling and accountability reports. The server
 * classifies time; this only reports what it observed.
 */
class Controller {
  private session: SessionView | null = null;
  private seq = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private ui: ReturnType<typeof setInterval> | null = null;
  private acc: Accountability | null = null;
  private wakeLock: { release(): Promise<void> } | null = null;
  private inFlight = false;

  readonly device = deviceId();

  owns(s: SessionView | null): boolean {
    return (
      !!s &&
      s.deviceId === this.device &&
      (s.status === 'running' || s.status === 'paused' || s.status === 'created')
    );
  }

  /** Called whenever the store's active session changes. */
  attach(s: SessionView | null) {
    if (!this.owns(s)) {
      if (this.session) this.detach();
      return;
    }
    const changed = this.session?.id !== s!.id;
    this.session = s;
    this.seq = Math.max(this.seq, s!.heartbeatSeq);
    if (changed) this.begin();
  }

  private begin() {
    const view = useGame.getState().view;
    if (!view || !this.session) return;
    const cfg = getContent(view.contentVersion).economy.study;
    this.acc?.stop();
    this.acc = accountabilityFor(this.session.mode, view.profile.settings, cfg.webCheckInMinutes);
    this.acc.start();
    useStudyUi.getState().set({ movedAway: false, plannedReached: false });
    this.schedule(cfg.heartbeatSeconds * 1000);
    this.ui ??= setInterval(() => this.uiTick(), 1000);
    window.addEventListener('online', this.onWake);
    document.addEventListener('visibilitychange', this.onWake);
    void this.keepAwake(true);
  }

  detach() {
    if (this.timer) clearTimeout(this.timer);
    if (this.ui) clearInterval(this.ui);
    this.timer = null;
    this.ui = null;
    this.acc?.stop();
    this.acc = null;
    this.session = null;
    window.removeEventListener('online', this.onWake);
    document.removeEventListener('visibilitychange', this.onWake);
    void this.keepAwake(false);
  }

  private onWake = () => {
    if (document.visibilityState === 'visible') void this.beat();
  };

  private async keepAwake(on: boolean) {
    const paper = this.session?.mode === 'paper';
    try {
      if (IS_DESKTOP) await desktop.preventSleep(on && paper);
      else if (on && paper && 'wakeLock' in navigator) {
        this.wakeLock = await (
          navigator as Navigator & {
            wakeLock: { request(t: 'screen'): Promise<{ release(): Promise<void> }> };
          }
        ).wakeLock.request('screen');
      } else if (!on && this.wakeLock) {
        await this.wakeLock.release();
        this.wakeLock = null;
      }
    } catch {
      /* wake lock unavailable: heartbeat gaps will be held for review instead */
    }
  }

  private schedule(ms: number) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.beat(), ms);
  }

  private uiTick() {
    const s = this.session;
    if (!s || !this.acc) return;
    useStudyUi.getState().set({ focus: this.acc.status() });
    if (s.status === 'running' && !useStudyUi.getState().plannedReached) {
      const elapsed = s.eligibleSeconds + Math.max(0, (serverNow() - s.serverLastAt) / 1000);
      if (elapsed >= s.plannedMinutes * 60) {
        useStudyUi.getState().set({ plannedReached: true });
        sfx('chime');
      }
    }
  }

  report(): IntervalReport {
    return this.acc?.take() ?? {};
  }

  async beat() {
    const s = this.session;
    if (!s || this.inFlight || s.status === 'paused') {
      if (s) this.schedule(30_000);
      return;
    }
    this.inFlight = true;
    const report = this.report();
    try {
      const res = await study.heartbeat(s.id, this.device, ++this.seq, report);
      useStudyUi.getState().set({ offline: false });
      useGame.getState().setSession(res.session);
      this.schedule(30_000);
    } catch (e) {
      this.acc?.restore(report);
      if (e instanceof ApiError && (e.code === 'session_moved' || e.code === 'session_ended')) {
        useStudyUi.getState().set({ movedAway: e.code === 'session_moved' });
        this.detach();
        await useGame
          .getState()
          .refresh()
          .catch(() => undefined);
      } else {
        useStudyUi.getState().set({ offline: isNetworkError(e) });
        this.schedule(10_000);
      }
    } finally {
      this.inFlight = false;
    }
  }

  confirmCheckIn() {
    this.acc?.confirmCheckIn();
    useStudyUi.getState().set({ focus: this.acc?.status() ?? useStudyUi.getState().focus });
  }
}

export const controller = new Controller();

useGame.subscribe((s, prev) => {
  if (s.view?.activeSession !== prev.view?.activeSession) controller.attach(s.view?.activeSession ?? null);
});

export async function startStudy(opts: {
  mode: 'computer' | 'paper';
  plannedMinutes: number;
  goal: string;
  subjects: string[];
  takeOver?: boolean;
}) {
  const res = await study.start({ deviceId: controller.device, platform: PLATFORM, ...opts });
  useGame.getState().setSession(res.session);
  sfx('start');
  return res.session;
}

export async function setBreak(on: boolean) {
  const s = useGame.getState().view?.activeSession;
  if (!s) return;
  const res = on
    ? await study.pause(s.id, controller.device, controller.report())
    : await study.resume(s.id, controller.device, controller.report());
  useGame.getState().setSession(res.session);
}

export async function finishStudy(opts: {
  recall?: { summary: string; cards: { q: string; a: string }[]; confidence?: number };
  reviewSeconds: number;
  early: boolean;
}) {
  const s = useGame.getState().view?.activeSession;
  if (!s) throw new Error('No active session');
  const requestId = crypto.randomUUID();
  const body = {
    requestId,
    deviceId: controller.device,
    report: controller.report(),
    reviewSeconds: opts.reviewSeconds,
    ...(opts.recall ? { recall: opts.recall } : {}),
  };
  // Retrying with the same request id is safe: the server pays at most once.
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await study.complete(s.id, body, opts.early);
      controller.detach();
      useGame.getState().setView(res.view);
      sfx('coins');
      return res.session;
    } catch (e) {
      if (!isNetworkError(e) || attempt >= 4) throw e;
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
}
