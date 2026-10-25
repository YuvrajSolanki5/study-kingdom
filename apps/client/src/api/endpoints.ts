import type { SocialView, LeagueView, LeagueStanding, ClanView } from '@sk/shared';
import type { DefenderSnapshot } from '@sk/sim';
import type { VillageAction } from '@sk/rules';
import type {
  ActionResponse,
  AuthResponse,
  BattleStartResponse,
  BattleSummary,
  PlayerView,
  SessionView,
  StudyHistory,
  StudySettings,
} from '@sk/shared';
import type { BattleSetup, Command } from '@sk/sim';
import { api } from './http.ts';

const rid = () => crypto.randomUUID();

export const auth = {
  register: (username: string, password: string, displayName: string) =>
    api<AuthResponse>('/auth/register', { body: { username, password, displayName }, noRetry: true }),
  login: (username: string, password: string, remember: boolean) =>
    api<AuthResponse>('/auth/login', { body: { username, password, remember }, noRetry: true }),
  logout: (scope: 'local' | 'global' = 'local') =>
    api<{ ok: true }>('/auth/logout', { body: { scope }, noRetry: true }),
  changePassword: (currentPassword: string, newPassword: string) =>
    api<AuthResponse>('/auth/password', { body: { currentPassword, newPassword }, noRetry: true }),
  session: () => api<AuthResponse>('/auth/session'),
};

export interface CampaignBaseInfo {
  id: string;
  order: number;
  name: string;
  description: string;
  hqLevel: number;
  stars: number;
  unlocked: boolean;
  starRewards: { gold?: number; essence?: number }[];
}

export const game = {
  player: () => api<PlayerView>('/player'),
  act: (action: VillageAction, requestId = rid()) =>
    api<ActionResponse>('/player/actions', { body: { requestId, action } }),
  profile: (body: { displayName?: string; timezone?: string }) =>
    api<PlayerView>('/player/profile', { method: 'PATCH', body }),
  settings: (body: Partial<StudySettings> & { timezone?: string }) =>
    api<PlayerView>('/player/settings', { method: 'PUT', body }),
};

export interface IntervalReport {
  distractedMs?: number;
  unconfirmedMs?: number;
  idleMs?: number;
  frontApp?: string;
}

export const study = {
  current: () => api<{ session: SessionView | null }>('/study/current'),
  start: (body: {
    deviceId: string;
    platform: 'web' | 'desktop';
    mode: 'computer' | 'paper';
    plannedMinutes: number;
    goal: string;
    subjects: string[];
    takeOver?: boolean;
  }) => api<{ session: SessionView }>('/study/sessions', { body: { requestId: rid(), ...body } }),
  heartbeat: (id: string, deviceId: string, seq: number, report: IntervalReport) =>
    api<{ session: SessionView }>(`/study/sessions/${id}/heartbeat`, { body: { deviceId, seq, report } }),
  pause: (id: string, deviceId: string, report: IntervalReport) =>
    api<{ session: SessionView }>(`/study/sessions/${id}/pause`, { body: { deviceId, report } }),
  resume: (id: string, deviceId: string, report: IntervalReport) =>
    api<{ session: SessionView }>(`/study/sessions/${id}/resume`, { body: { deviceId, report } }),
  complete: (
    id: string,
    body: {
      requestId: string;
      deviceId: string;
      report: IntervalReport;
      recall?: { summary: string; cards: { q: string; a: string }[]; confidence?: number };
      reviewSeconds: number;
    },
    early = false,
  ) =>
    api<{ session: SessionView; view: PlayerView }>(`/study/sessions/${id}/${early ? 'stop' : 'complete'}`, {
      body,
    }),
  review: (id: string, seconds: number) =>
    api<{ session: SessionView; view: PlayerView }>(`/study/sessions/${id}/review`, {
      body: { requestId: rid(), seconds },
    }),
  history: () => api<StudyHistory>('/study/history'),
};

export const battles = {
  campaign: () => api<{ bases: CampaignBaseInfo[] }>('/battles/campaign'),
  start: (kind: BattleSummary['kind'], target?: string) =>
    api<BattleStartResponse>('/battles', { body: { requestId: rid(), kind, ...(target ? { target } : {}) } }),
  progress: (id: string, commands: Command[]) =>
    api<{ ok: true }>(`/battles/${id}/progress`, { body: { commands, final: false }, keepalive: true }),
  submit: (id: string, commands: Command[], clientHash: string) =>
    api<{ battle: BattleSummary }>(`/battles/${id}/submit`, { body: { commands, clientHash } }),
  verify: (id: string) => api<{ battle: BattleSummary }>(`/battles/${id}/verify`, { body: {} }),
  get: (id: string, full = false) =>
    api<{ battle: BattleSummary; setup?: BattleSetup; commands?: Command[] }>(
      `/battles/${id}${full ? '?full=1' : ''}`,
    ),
  list: () => api<{ battles: BattleSummary[] }>('/battles'),
};

export const social = {
  view: () => api<SocialView>('/social'),
  friend: (code: string) => api('/social/friends', { body: { code } }),
  friendAction: (id: string, action: 'accept' | 'remove' | 'block' | 'unblock') =>
    api(`/social/friends/${id}/${action}`, { body: {} }),
  visit: (id: string) =>
    api<{ displayName: string; contentVersion: string; snapshot: DefenderSnapshot }>(`/social/visit/${id}`),
  challenge: (id: string) => api('/social/challenges', { body: { id } }),
  group: (kind: 'leagues' | 'rooms', input: { name: string } | { code: string }) =>
    api<LeagueView>(`/social/${kind}${'code' in input ? '/join' : ''}`, { body: input }),
  standings: (id: string) => api<{ week: string; standings: LeagueStanding[] }>(`/social/leagues/${id}`),
  leaveRoom: () => api('/social/rooms/leave', { body: {} }),
  presence: () => api('/social/rooms/presence', { body: {} }),
  notifications: () => api<{ notifications: { id: number; message: string }[] }>('/social/notifications'),
  read: (through: number) => api('/social/notifications/read', { body: { through } }),
  share: (id: string) => api<{ token: string }>(`/social/replays/${id}/share`, { body: {} }),
  replay: (token: string) =>
    api<{ battle: BattleSummary; setup: BattleSetup; commands: Command[] }>(`/social/replays/${token}`),
};
export const clans = {
  view: () => api<ClanView>('/clans'),
  create: (name: string) => api('/clans', { body: { name } }),
  invite: (id: string) => api('/clans/invite', { body: { id } }),
  join: (id: string) => api('/clans/join', { body: { id } }),
  role: (userId: string, role: 'leader' | 'officer' | 'member') =>
    api('/clans/role', { body: { userId, role } }),
  leave: () => api('/clans/leave', { body: {} }),
  remove: (id: string) => api('/clans/remove', { body: { id } }),
  request: () => api('/clans/reinforcements', { body: {} }),
  donate: (id: string, troop: string, count: number, requestId = rid()) =>
    api(`/clans/reinforcements/${id}/donate`, { body: { requestId, troop, count } }),
  claim: (id: string, requestId = rid()) => api(`/clans/reinforcements/${id}/claim`, { body: { requestId } }),
  objective: () => api('/clans/objective/claim', { body: {} }),
  war: (clanId: string, roster: string[]) => api('/clans/wars', { body: { clanId, roster } }),
  respond: (id: string, roster: string[] | null) =>
    api(`/clans/wars/${id}/${roster ? 'accept' : 'decline'}`, { body: roster ? { roster } : {} }),
};
