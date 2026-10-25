import { ALL_BUILDING_IDS, HERO_IDS, type GameContent } from '@sk/content';
import type { PlayerState, SessionStatus, StudyMode, StudyPlatform, VillageAction } from '@sk/rules';
import type { BattleResult, BattleSetup, Command } from '@sk/sim';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export const RequestId = z.uuid();
const int = z.number().int();
const coord = int.min(0).max(64);

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export const Username = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9_]{2,23}$/, 'Use 3–24 letters, numbers or underscores');
export const Password = z.string().min(10, 'Use at least 10 characters').max(128);
export const DisplayName = z
  .string()
  .trim()
  .min(2)
  .max(24)
  .regex(/^[\p{L}\p{N} _.'-]+$/u, "Letters, numbers, spaces and _ . ' - only");

export const RegisterBody = z.object({ username: Username, password: Password, displayName: DisplayName });
export const LoginBody = z.object({ username: Username, password: z.string().min(1).max(128) });
export const ChangePasswordBody = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: Password,
});
export const RefreshBody = z.object({ refreshToken: z.string().min(10).max(512).optional() });

// ---------------------------------------------------------------------------
// Village actions (validated shape; rules enforce game logic)
// ---------------------------------------------------------------------------

const BuildingIdSchema = z.enum(ALL_BUILDING_IDS as [string, ...string[]]);
const ArmyKind = z.enum(['troops', 'spells', 'siege']);
const Pos = z.object({ x: coord, y: coord });

export const VillageActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('build'), defId: BuildingIdSchema, x: coord, y: coord }),
  z.object({ type: z.literal('build_walls'), positions: z.array(Pos).min(1).max(100) }),
  z.object({ type: z.literal('upgrade'), buildingId: int.min(1) }),
  z.object({ type: z.literal('upgrade_walls'), buildingIds: z.array(int.min(1)).min(1).max(100) }),
  z.object({ type: z.literal('cancel_upgrade'), builder: int.min(0).max(9) }),
  z.object({ type: z.literal('move'), buildingId: int.min(1), x: coord, y: coord }),
  z.object({
    type: z.literal('apply_layout'),
    positions: z.array(z.object({ id: int.min(1), x: coord, y: coord })).max(600),
  }),
  z.object({ type: z.literal('save_layout'), slot: int.min(0).max(9), name: z.string().max(32) }),
  z.object({ type: z.literal('load_layout'), slot: int.min(0).max(9) }),
  z.object({ type: z.literal('delete_layout'), slot: int.min(0).max(9) }),
  z.object({ type: z.literal('set_war_layout'), slot: int.min(0).max(9).nullable() }),
  z.object({
    type: z.literal('research'),
    kind: z.enum(['troop', 'spell', 'siege']),
    id: z.string().max(32),
  }),
  z.object({ type: z.literal('cancel_research') }),
  z.object({ type: z.literal('train'), kind: ArmyKind, id: z.string().max(32), count: int.min(1).max(200) }),
  z.object({ type: z.literal('cancel_training'), kind: ArmyKind, index: int.min(0).max(500) }),
  z.object({
    type: z.literal('dismiss'),
    kind: ArmyKind,
    id: z.string().max(32),
    count: int.min(1).max(500),
  }),
  z.object({ type: z.literal('upgrade_hero'), heroId: z.enum(HERO_IDS) }),
  z.object({ type: z.literal('tutorial'), step: int.min(0).max(100) }),
]) as unknown as z.ZodType<VillageAction>;

export const ActionBody = z.object({ requestId: RequestId, action: VillageActionSchema });

// ---------------------------------------------------------------------------
// Study
// ---------------------------------------------------------------------------

export const DeviceId = z
  .string()
  .min(8)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/);
export const Subject = z.string().trim().min(1).max(32);

export const StartSessionBody = z.object({
  requestId: RequestId,
  deviceId: DeviceId,
  platform: z.enum(['web', 'desktop']),
  mode: z.enum(['computer', 'paper']),
  plannedMinutes: int.min(5).max(240),
  goal: z.string().trim().max(200).default(''),
  subjects: z.array(Subject).max(5).default([]),
  takeOver: z.boolean().default(false),
});

export const IntervalReportSchema = z.object({
  distractedMs: int.min(0).max(86_400_000).optional(),
  unconfirmedMs: int.min(0).max(86_400_000).optional(),
  idleMs: int.min(0).max(86_400_000).optional(),
  frontApp: z.string().max(128).optional(),
});

export const HeartbeatBody = z.object({
  deviceId: DeviceId,
  seq: int.min(1),
  report: IntervalReportSchema.default({}),
});

export const PauseBody = z.object({ deviceId: DeviceId, report: IntervalReportSchema.default({}) });

export const RecallSchema = z.object({
  summary: z.string().trim().max(2000),
  cards: z
    .array(z.object({ q: z.string().trim().min(1).max(300), a: z.string().trim().min(1).max(500) }))
    .max(10)
    .default([]),
  confidence: int.min(1).max(5).optional(),
});

export const CompleteBody = z.object({
  requestId: RequestId,
  deviceId: DeviceId,
  report: IntervalReportSchema.default({}),
  recall: RecallSchema.optional(),
  reviewSeconds: int.min(0).max(86_400).default(0),
});

export const ReviewBody = z.object({ requestId: RequestId, seconds: int.min(0).max(86_400) });

export const StudySettingsBody = z.object({
  dailyGoalMinutes: int.min(0).max(600).optional(),
  weeklyGoalMinutes: int.min(0).max(4200).optional(),
  subjects: z.array(Subject).max(20).optional(),
  allowedApps: z
    .array(z.object({ bundleId: z.string().min(1).max(200), name: z.string().max(100) }))
    .max(100)
    .optional(),
  graceSeconds: int.min(15).max(600).optional(),
  timezone: z.string().min(1).max(64).optional(),
});

// ---------------------------------------------------------------------------
// Battles
// ---------------------------------------------------------------------------

export const StartBattleBody = z.object({
  requestId: RequestId,
  kind: z.enum(['campaign', 'ranked', 'friendly', 'war']),
  target: z.string().max(128).optional(),
});

const CommandSchema = z.union([
  z.object({ t: int, k: z.literal('troop'), id: z.string().max(32), x: int, y: int }),
  z.object({ t: int, k: z.literal('spell'), id: z.string().max(32), x: int, y: int }),
  z.object({ t: int, k: z.literal('hero'), id: z.string().max(32), x: int, y: int }),
  z.object({ t: int, k: z.literal('ability'), id: z.string().max(32) }),
  z.object({ t: int, k: z.literal('siege'), id: z.string().max(32), x: int, y: int }),
  z.object({ t: int, k: z.literal('reinforce'), x: int, y: int }),
  z.object({ t: int, k: z.literal('end') }),
]) as unknown as z.ZodType<Command>;

export const SubmitBattleBody = z.object({
  commands: z.array(CommandSchema).max(1500),
  clientHash: z.string().max(16).optional(),
  final: z.boolean().default(true),
});

export const ClientErrorBody = z.object({
  message: z.string().max(2000),
  stack: z.string().max(8000).optional(),
  url: z.string().max(500).optional(),
  appVersion: z.string().max(32).optional(),
  platform: z.string().max(16).optional(),
});

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}

export interface SessionUser {
  id: string;
  username: string;
}

export interface AuthResponse {
  user: SessionUser;
  /** Desktop clients only: tokens returned in the body instead of cookies. */
  tokens?: { accessToken: string; refreshToken: string; expiresAt: number };
}

export interface StudySettings {
  dailyGoalMinutes: number;
  weeklyGoalMinutes: number;
  subjects: string[];
  allowedApps: { bundleId: string; name: string }[];
  graceSeconds: number;
}

export interface Profile {
  userId: string;
  displayName: string;
  friendCode: string;
  timezone: string;
  trophies: number;
  hqLevel: number;
  settings: StudySettings;
  shieldUntil: number | null;
}

export interface SessionView {
  id: string;
  status: SessionStatus;
  mode: StudyMode;
  platform: StudyPlatform;
  deviceId: string;
  goal: string;
  subjects: string[];
  plannedMinutes: number;
  startedAt: number | null;
  endedAt: number | null;
  eligibleSeconds: number;
  pausedSeconds: number;
  unreviewedSeconds: number;
  distractedSeconds: number;
  reviewedSeconds: number;
  heartbeatSeq: number;
  serverLastAt: number;
  reward: {
    gold: number;
    essence: number;
    overflowGold: number;
    overflowEssence: number;
    bonusPercent: number;
  } | null;
  competitiveSeconds: number;
  endReason: string | null;
  recall: unknown;
  localDate: string | null;
  reviewDeadline: number | null;
}

export interface BattleSummary {
  id: string;
  kind: 'campaign' | 'ranked' | 'friendly' | 'war';
  status: 'active' | 'verifying' | 'settled' | 'rejected';
  targetRef: string | null;
  attackerId: string;
  defenderId: string | null;
  attackerName?: string;
  defenderName?: string;
  startedAt: number;
  expiresAt: number;
  result: BattleResult | null;
  rewards: { gold: number; essence: number; trophies: number } | null;
  rejectReason: string | null;
  shareToken: string | null;
}

export interface BattleStartResponse {
  battle: BattleSummary;
  setup: BattleSetup;
}

export interface PlayerView {
  serverTime: number;
  contentVersion: string;
  profile: Profile;
  wallet: { gold: number; essence: number; capacity: { gold: number; essence: number } };
  state: PlayerState;
  activeSession: SessionView | null;
  activeBattleId: string | null;
}

export interface ActionResponse {
  view: PlayerView;
}

export interface StudyDay {
  date: string;
  seconds: number;
  competitiveSeconds: number;
  sessions: number;
}

export interface StudyHistory {
  sessions: SessionView[];
  days: StudyDay[];
  today: { seconds: number; competitiveSeconds: number; goalMinutes: number };
  week: { seconds: number; goalMinutes: number };
  subjects: { subject: string; seconds: number }[];
}

export type ContentManifest = Pick<GameContent, 'version'>;

// Social and clan contracts. UUIDs are validated before reaching SQL.
export const SocialName = z.string().trim().min(2).max(40);
export const FriendBody = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{8}$/),
});
export const IdBody = z.object({ id: z.uuid() });
export const CodeBody = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[a-f0-9]{16}$/),
});
export const NameBody = z.object({ name: SocialName });
export interface SocialPlayer {
  userId: string;
  displayName: string;
  friendCode: string;
  hqLevel: number;
  trophies: number;
}
export interface FriendView extends SocialPlayer {
  accepted: boolean;
  incoming: boolean;
}
export interface ChallengeView {
  id: string;
  sender: string;
  recipient: string;
  senderName: string;
  recipientName: string;
  expiresAt: string;
  battleId: string | null;
}
export interface LeagueView {
  id: string;
  name: string;
  code: string;
}
export interface LeagueStanding {
  userId: string;
  displayName: string;
  studyMinutes: number;
  stars: number;
  points: number;
}
export interface RoomView {
  id: string;
  name: string;
  code: string;
  members: { userId: string; displayName: string; status: 'focus' | 'break' | 'finished' }[];
}
export interface SocialView {
  friends: FriendView[];
  blocked: SocialPlayer[];
  challenges: ChallengeView[];
  leagues: LeagueView[];
  room: RoomView | null;
}
export const RosterBody = z.object({
  roster: z
    .array(z.uuid())
    .length(5)
    .refine((v) => new Set(v).size === 5, 'Choose five different members'),
});
export const WarChallengeBody = RosterBody.extend({ clanId: z.uuid() });
export const DonationBody = z.object({
  requestId: RequestId,
  troop: z.string().max(32),
  count: z.number().int().min(1).max(30),
});
export const ReceiptBody = z.object({ requestId: RequestId });
export const ClanRoleBody = z.object({ userId: z.uuid(), role: z.enum(['leader', 'officer', 'member']) });
export interface ClanMember {
  userId: string;
  displayName: string;
  role: 'leader' | 'officer' | 'member';
}
export interface ReinforcementRequest {
  id: string;
  userId: string;
  displayName: string;
  capacity: number;
  housing: number;
  troops: { id: string; level: number; count: number }[];
}
export interface WarView {
  id: string;
  home: string;
  away: string;
  homeName: string;
  awayName: string;
  status: 'invited' | 'declined' | 'preparation' | 'battle' | 'settled';
  preparationUntil: string | null;
  battleUntil: string | null;
  result: {
    winner: string | null;
    homeStars: number;
    awayStars: number;
    homeDestruction: number;
    awayDestruction: number;
  } | null;
  roster: { userId: string; displayName: string; clanId: string; position: number; hqLevel: number }[];
  attacks: {
    attacker: string;
    defender: string;
    battleId: string | null;
    stars: number | null;
    destructionPercent: number | null;
  }[];
}
export interface ClanView {
  clan: { id: string; name: string; code: string } | null;
  members: ClanMember[];
  invites: { id: string; name: string }[];
  requests: ReinforcementRequest[];
  objective: {
    week: string;
    minutes: number;
    targetMinutes: number;
    claimed: boolean;
    contributions: { userId: string; minutes: number }[];
  } | null;
  wars: WarView[];
  cosmetics: string[];
}
