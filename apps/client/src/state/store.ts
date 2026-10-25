import { getContent, type GameContent } from '@sk/content';
import { applyAction, RuleError, settle, storageCapacity, type VillageAction } from '@sk/rules';
import type { BattleSummary, PlayerView, SessionView } from '@sk/shared';
import type { BattleResult, BattleSetup, Command, DefenderSnapshot } from '@sk/sim';
import { create } from 'zustand';
import { auth, game } from '../api/endpoints.ts';
import { clearDesktopTokens, isNetworkError, refreshDesktopSession } from '../api/http.ts';
import { IS_DESKTOP } from '../platform/env.ts';
import { local } from '../platform/storage.ts';

export type Screen = 'village' | 'study' | 'army' | 'attack' | 'history' | 'social' | 'clan' | 'settings';

export interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'good' | 'bad';
}

export type BattlePhase = 'scouting' | 'fighting' | 'submitting' | 'done';

export interface BattleSession {
  id: string;
  kind: BattleSummary['kind'];
  title: string;
  setup: BattleSetup;
  phase: BattlePhase;
  replay: boolean;
  /** Commands for replays; live battles record their own. */
  commands: Command[];
  localResult: BattleResult | null;
  summary: BattleSummary | null;
  error: string | null;
}

interface GameStore {
  visit: { displayName: string; contentVersion: string; snapshot: DefenderSnapshot } | null;
  setVisit(v: GameStore['visit']): void;
  auth: 'loading' | 'signed_out' | 'signed_in';
  username: string | null;
  view: PlayerView | null;
  /** serverTime - Date.now(), measured on every view fetch. */
  offset: number;
  screen: Screen;
  selected: number | null;
  placing: string | null;
  editMode: boolean;
  battle: BattleSession | null;
  toasts: Toast[];
  /** Notifications held back while a focus session is running. */
  held: string[];
  muted: boolean;
  boot(): Promise<void>;
  signedIn(username?: string): Promise<void>;
  signOut(everywhere?: boolean): Promise<void>;
  refresh(): Promise<void>;
  setView(view: PlayerView, requestedAt?: number): void;
  setSession(session: SessionView | null): void;
  act(action: VillageAction): Promise<boolean>;
  tick(): void;
  setScreen(screen: Screen): void;
  select(id: number | null): void;
  setPlacing(defId: string | null): void;
  setEditMode(on: boolean): void;
  setBattle(b: BattleSession | null): void;
  patchBattle(p: Partial<BattleSession>): void;
  toast(text: string, tone?: Toast['tone']): void;
  dismissToast(id: number): void;
  notify(text: string): void;
  releaseHeld(): void;
  setMuted(m: boolean): void;
}

let toastId = 0;
let queue: Promise<unknown> = Promise.resolve();

export const useGame = create<GameStore>((set, get) => ({
  visit: null,
  setVisit(visit) {
    set({ visit, screen: 'village', selected: null, placing: null, editMode: false });
  },
  auth: 'loading',
  username: null,
  view: null,
  offset: 0,
  screen: 'village',
  selected: null,
  placing: null,
  editMode: false,
  battle: null,
  toasts: [],
  held: [],
  muted: local.get('sk.muted') === '1',

  async boot() {
    let username: string;
    try {
      if (IS_DESKTOP && !(await refreshDesktopSession())) {
        set({ auth: 'signed_out' });
        return;
      }
      username = (await auth.session()).user.username;
    } catch (e) {
      set({ auth: 'signed_out' });
      if (isNetworkError(e)) get().toast('Cannot reach the server. Check your connection.', 'bad');
      return;
    }
    // Signed in: failures from here on are not authentication problems.
    try {
      await get().signedIn(username);
    } catch (e) {
      get().toast(e instanceof Error ? e.message : 'Could not load your kingdom', 'bad');
    }
  },

  async signedIn(username) {
    set({ auth: 'signed_in', username: username ?? get().username });
    await get().refresh();
  },

  async signOut(everywhere = false) {
    try {
      await auth.logout(everywhere ? 'global' : 'local');
    } catch {
      /* best effort */
    }
    if (IS_DESKTOP) await clearDesktopTokens();
    set({ auth: 'signed_out', view: null, battle: null, screen: 'village', username: null, visit: null });
  },

  async refresh() {
    const before = Date.now();
    const view = await game.player();
    get().setView(view, before);
  },

  setView(view: PlayerView, requestedAt?: number) {
    const now = Date.now();
    const rtt = requestedAt ? now - requestedAt : 0;
    set({ view, offset: view.serverTime + rtt / 2 - now });
  },

  setSession(session) {
    const view = get().view;
    if (!view) return;
    const active =
      session && (session.status === 'completed' || session.status === 'abandoned') ? null : session;
    set({ view: { ...view, activeSession: active } });
    if (!active || active.status !== 'running') get().releaseHeld();
  },

  act(action) {
    if (get().visit) return Promise.resolve(false);
    const run = async () => {
      const view = get().view;
      if (!view) return false;
      const content = getContent(view.contentVersion);
      const now = serverNow();
      try {
        const out = applyAction(
          { content, now },
          { state: view.state, gold: view.wallet.gold, essence: view.wallet.essence },
          action,
        );
        set({ view: withAggregate(view, content, out.agg) });
      } catch (e) {
        get().toast(e instanceof RuleError ? e.message : 'That is not possible right now', 'bad');
        return false;
      }
      const requestId = crypto.randomUUID();
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const res = await game.act(action, requestId);
          get().setView(res.view);
          return true;
        } catch (e) {
          if (isNetworkError(e) && attempt < 2) {
            await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
            continue;
          }
          set({ view });
          get().toast(e instanceof Error ? e.message : 'Action failed', 'bad');
          return false;
        }
      }
      return false;
    };
    const p = queue.then(run, run);
    queue = p.catch(() => undefined);
    return p;
  },

  /** Presents timers that finished since the last server sync (the server settles identically). */
  tick() {
    const view = get().view;
    if (!view) return;
    const content = getContent(view.contentVersion);
    const state = structuredClone(view.state);
    const events = settle(content, state, serverNow());
    if (!events.length) return;
    set({ view: { ...view, state, wallet: { ...view.wallet, capacity: storageCapacity(content, state) } } });
    for (const ev of events) {
      if (ev.kind === 'building')
        get().notify(`${content.structures[ev.id]?.name ?? ev.id} reached level ${ev.level}`);
      else if (ev.kind === 'research')
        get().notify(
          `Research complete: ${content.troops[ev.id]?.name ?? content.spells[ev.id]?.name ?? ev.id} level ${ev.level}`,
        );
      else if (ev.kind === 'hero')
        get().notify(`${content.heroes[ev.id]?.name ?? ev.id} reached level ${ev.level}`);
    }
  },

  setScreen(screen) {
    set({ screen, placing: null, ...(screen !== 'village' ? { editMode: false } : {}) });
  },
  select(id) {
    set({ selected: id });
  },
  setPlacing(defId) {
    set({ placing: defId, selected: null });
  },
  setEditMode(on) {
    set({ editMode: on, placing: null, selected: null });
  },
  setBattle(b) {
    set({ battle: b, selected: null, placing: null, editMode: false });
  },
  patchBattle(p) {
    const b = get().battle;
    if (b) set({ battle: { ...b, ...p } });
  },
  toast(text, tone = 'info') {
    const id = ++toastId;
    set({ toasts: [...get().toasts.slice(-3), { id, text, tone }] });
    setTimeout(() => get().dismissToast(id), tone === 'bad' ? 6000 : 4000);
  },
  dismissToast(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
  notify(text) {
    // Game notifications wait for a break so they never interrupt focus.
    if (get().view?.activeSession?.status === 'running') set({ held: [...get().held, text].slice(-20) });
    else get().toast(text, 'good');
  },
  releaseHeld() {
    const held = get().held;
    if (!held.length) return;
    set({ held: [] });
    get().toast(
      held.length === 1
        ? held[0]!
        : `While you studied: ${held.slice(0, 3).join(' · ')}${held.length > 3 ? ' …' : ''}`,
      'good',
    );
  },
  setMuted(m) {
    local.set('sk.muted', m ? '1' : '0');
    set({ muted: m });
  },
}));

export function serverNow(): number {
  return Date.now() + useGame.getState().offset;
}

function withAggregate(
  view: PlayerView,
  content: GameContent,
  agg: { state: PlayerView['state']; gold: number; essence: number },
): PlayerView {
  return {
    ...view,
    state: agg.state,
    wallet: { gold: agg.gold, essence: agg.essence, capacity: storageCapacity(content, agg.state) },
  };
}

export function contentOf(view: PlayerView | null): GameContent {
  return getContent(view?.contentVersion);
}
