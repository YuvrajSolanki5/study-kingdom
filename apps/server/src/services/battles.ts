import { getContent, type GameContent } from '@sk/content';
import {
  attackerArmy,
  campaignStarRewards,
  consumeArmy,
  credit,
  settle,
  type LedgerDelta,
  type PlayerAggregate,
} from '@sk/rules';
import type { BattleSummary, StartBattleBody } from '@sk/shared';
import {
  SIM_VERSION,
  validateCommands,
  type BattleResult,
  type BattleSetup,
  type Command,
  type DefenderSnapshot,
  type SimState,
} from '@sk/sim';
import type { z } from 'zod';
import type { Deps } from '../context.ts';
import { transaction, type Sql, type Tx } from '../db.ts';
import { badRequest, conflict, HttpError, notFound } from '../errors.ts';
import { aggregateOf, lockPlayer, lockPlayers, withReceipt, writePlayer, type PlayerRow } from './player.ts';

export type BattleKind = 'campaign' | 'ranked' | 'friendly' | 'war';

export interface BattleRow {
  id: string;
  attacker_id: string;
  defender_id: string | null;
  kind: BattleKind;
  target_ref: string | null;
  status: 'active' | 'verifying' | 'settled' | 'rejected';
  sim_version: number;
  content_version: string;
  seed: number;
  setup: BattleSetup;
  commands: Command[] | null;
  client_hash: string | null;
  result: BattleResult | null;
  checkpoint: SimState | null;
  verify_attempts: number;
  rewards: { gold: number; essence: number; trophies: number } | null;
  attacker_trophies_delta: number | null;
  defender_trophies_delta: number | null;
  started_at: Date;
  expires_at: Date;
  submitted_at: Date | null;
  settled_at: Date | null;
  share_token: string | null;
  reject_reason: string | null;
}

export function battleSummary(row: BattleRow, names: Record<string, string> = {}): BattleSummary {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    targetRef: row.target_ref,
    attackerId: row.attacker_id,
    defenderId: row.defender_id,
    ...(names[row.attacker_id] ? { attackerName: names[row.attacker_id] } : {}),
    ...(row.defender_id && names[row.defender_id] ? { defenderName: names[row.defender_id] } : {}),
    startedAt: row.started_at.getTime(),
    expiresAt: row.expires_at.getTime(),
    result: row.result,
    rewards: row.rewards,
    rejectReason: row.reject_reason,
    shareToken: row.share_token,
  };
}

/** What a battle kind needs at start (defender) and at settlement (rewards). */
export interface BattleTarget {
  defenderId: string | null;
  targetRef: string | null;
  defender: DefenderSnapshot;
}

export interface SettleContext {
  tx: Tx;
  deps: Deps;
  content: GameContent;
  battle: BattleRow;
  result: BattleResult;
  attacker: PlayerRow;
  attackerAgg: PlayerAggregate;
  deltas: LedgerDelta[];
  /** Locked defender row, when the battle has a player defender. */
  defender: PlayerRow | null;
}

export interface SettleOutcome {
  rewards: { gold: number; essence: number; trophies: number };
  attackerTrophies?: number;
  defenderTrophies?: number;
  defenderShieldUntil?: Date | null;
  attackerTrophiesDelta?: number;
  defenderTrophiesDelta?: number;
}

export interface BattleKindHandler {
  /** Resolves the defending base. Runs inside the start transaction with the attacker locked. */
  resolve(
    tx: Tx,
    deps: Deps,
    content: GameContent,
    attacker: PlayerRow,
    target: string | undefined,
  ): Promise<BattleTarget>;
  started?(tx: Tx, battle: BattleRow): Promise<void>;
  /** Applies kind-specific rewards. The army has already been consumed. */
  settle(ctx: SettleContext): Promise<SettleOutcome>;
}

const campaignHandler: BattleKindHandler = {
  async resolve(_tx, _deps, content, attacker, target) {
    const base = content.campaign.find((b) => b.id === target);
    if (!base) throw notFound('Unknown campaign base');
    const prev = content.campaign.find((b) => b.order === base.order - 1);
    if (prev && !(attacker.state.campaign[prev.id] ?? 0))
      throw conflict('locked', `Defeat ${prev.name} first`);
    return {
      defenderId: null,
      targetRef: base.id,
      defender: {
        hqLevel: base.hqLevel,
        buildings: base.buildings.map((b, i) => ({ id: i + 1, ...b })),
        reinforcements: base.reinforcements.map((r) => ({ id: r.unitId, level: r.level, count: r.count })),
      },
    };
  },
  async settle({ content, battle, result, attackerAgg, deltas, deps }) {
    const base = content.campaign.find((b) => b.id === battle.target_ref)!;
    const prevStars = attackerAgg.state.campaign[base.id] ?? 0;
    const reward = campaignStarRewards(base, prevStars, result.stars);
    attackerAgg.state.campaign[base.id] = Math.max(prevStars, result.stars);
    const paid = credit(
      { content, now: deps.now() },
      attackerAgg,
      reward,
      deltas,
      'campaign_reward',
      `battle:${battle.id}`,
    );
    return { rewards: { gold: paid.gold, essence: paid.essence, trophies: 0 } };
  },
};

const handlers: Partial<Record<BattleKind, BattleKindHandler>> = { campaign: campaignHandler };

export function registerBattleKind(kind: BattleKind, handler: BattleKindHandler) {
  handlers[kind] = handler;
}

function handlerFor(kind: BattleKind): BattleKindHandler {
  const h = handlers[kind];
  if (!h) throw badRequest(`Battles of kind ${kind} are not available yet`);
  return h;
}

async function lockBattle(tx: Tx, id: string): Promise<BattleRow> {
  const [row] = await tx<BattleRow[]>`select * from game.battles where id = ${id} for update`;
  if (!row) throw notFound('Battle not found');
  return row;
}

export async function getBattle(sql: Sql | Tx, id: string): Promise<BattleRow | null> {
  const [row] = await sql<BattleRow[]>`select * from game.battles where id = ${id}`;
  return row ?? null;
}

function randomSeed(deps: Deps): number {
  const b = deps.randomBytes(4);
  return ((b[0]! << 24) | (b[1]! << 16) | (b[2]! << 8) | b[3]!) >>> 0;
}

export async function startBattle(
  sql: Sql,
  deps: Deps,
  userId: string,
  body: z.infer<typeof StartBattleBody>,
) {
  // Finish anything left over from a crashed or abandoned battle first.
  await finalizeExpired(sql, deps, { attackerId: userId });
  const now = deps.now();
  return transaction(sql, async (tx) => {
    const player = await lockPlayer(tx, userId);
    const content = getContent(player.content_version);
    const out = await withReceipt(
      tx,
      userId,
      body.requestId,
      'battle_start',
      async () => {
        const agg = aggregateOf(player);
        settle(content, agg.state, now);
        if (agg.state.activeBattle) {
          throw conflict('battle_active', 'Finish your current battle first', {
            battleId: agg.state.activeBattle.id,
          });
        }
        const army = attackerArmy(content, agg.state, now);
        if (!army.troops.length && !army.heroes.length && !army.siege.length)
          throw conflict('no_army', 'Train some troops first');
        const target = await handlerFor(body.kind).resolve(tx, deps, content, player, body.target);
        const setup: BattleSetup = {
          simVersion: SIM_VERSION,
          contentVersion: content.version,
          seed: randomSeed(deps),
          defender: target.defender,
          attacker: army,
        };
        const b = content.economy.battle;
        const expiresAt = new Date(now + (b.durationSeconds + b.submitGraceSeconds) * 1000);
        const [battle] = await tx<BattleRow[]>`
          insert into game.battles (attacker_id, defender_id, kind, target_ref, status, sim_version,
            content_version, seed, setup, started_at, expires_at)
          values (${userId}, ${target.defenderId}, ${body.kind}, ${target.targetRef}, 'active', ${SIM_VERSION},
            ${content.version}, ${setup.seed}, ${tx.json(setup as never)}, ${new Date(now)}, ${expiresAt})
          returning *`;
        await handlerFor(body.kind).started?.(tx, battle!);
        agg.state.activeBattle = { id: battle!.id, expiresAt: expiresAt.getTime() };
        await writePlayer(tx, player, agg, [], `battle:${battle!.id}:start`);
        return battle as BattleRow;
      },
      (b) => ({ battleId: b.id }),
    );
    const battle = out.replayed
      ? ((await getBattle(tx, (out.response as { battleId: string }).battleId)) as BattleRow)
      : out.value;
    return { battle: battleSummary(battle), setup: battle.setup };
  });
}

/** JSONB may reorder object keys; compare command values, not serialised key order. */
function sameCommand(a: Command, b: Command | undefined): boolean {
  return (
    !!b &&
    a.k === b.k &&
    a.t === b.t &&
    (!('id' in a) || ('id' in b && a.id === b.id)) &&
    (!('x' in a) || ('x' in b && 'y' in b && a.x === b.x && a.y === b.y))
  );
}

/** Stores the commands issued so far, so a crashed client's battle can still be settled fairly. */
export async function recordProgress(sql: Sql, userId: string, id: string, commands: Command[]) {
  return transaction(sql, async (tx) => {
    const b = await lockBattle(tx, id);
    if (b.attacker_id !== userId) throw notFound('Battle not found');
    if (b.status !== 'active') return { ok: true };
    const prev = b.commands ?? [];
    if (commands.length < prev.length) return { ok: true };
    for (let i = 0; i < prev.length; i++)
      if (!sameCommand(prev[i]!, commands[i])) throw badRequest('Commands diverge from progress');
    const check = validateCommands(b.setup, commands);
    if (!check.ok) throw badRequest(`Invalid commands: ${check.error}`);
    await tx`update game.battles set commands = ${tx.json(commands as never)} where id = ${id}`;
    return { ok: true };
  });
}

export async function submitBattle(
  sql: Sql,
  deps: Deps,
  userId: string,
  id: string,
  commands: Command[],
  clientHash: string | undefined,
): Promise<BattleSummary> {
  const now = deps.now();
  const ready = await transaction(sql, async (tx) => {
    const b = await lockBattle(tx, id);
    if (b.attacker_id !== userId) throw notFound('Battle not found');
    if (b.status !== 'active') return b;
    if (now > b.expires_at.getTime())
      throw new HttpError(
        410,
        'battle_expired',
        'Too late to submit; the battle was settled with recorded progress',
      );
    const recorded = b.commands ?? [];
    if (commands.length < recorded.length || recorded.some((cmd, i) => !sameCommand(cmd, commands[i]))) {
      throw badRequest('Submitted commands must preserve recorded progress');
    }
    const check = validateCommands(b.setup, commands);
    if (!check.ok) {
      await rejectBattle(tx, deps, b, `invalid commands: ${check.error}`);
      return lockBattle(tx, id);
    }
    const [updated] = await tx<BattleRow[]>`
      update game.battles set commands = ${tx.json(commands as never)}, client_hash = ${clientHash ?? null},
        status = 'verifying', submitted_at = ${new Date(now)}
      where id = ${id} returning *`;
    return updated as BattleRow;
  });
  if (ready.status !== 'verifying') return battleSummary(ready);
  return continueVerification(sql, deps, ready);
}

/** Runs (the next part of) verification and settles when complete. */
export async function continueVerification(sql: Sql, deps: Deps, battle: BattleRow): Promise<BattleSummary> {
  const outcome = await deps.verifier.verify(battle.setup, battle.commands ?? [], battle.checkpoint);
  if (outcome.status === 'pending') {
    await sql`update game.battles set checkpoint = ${sql.json(outcome.checkpoint as never)},
      verify_attempts = verify_attempts + 1 where id = ${battle.id} and status = 'verifying'
      and (checkpoint is null or (checkpoint->>'tick')::int<=${outcome.checkpoint.tick})`;
    const current = await getBattle(sql, battle.id);
    return battleSummary(current ?? battle);
  }
  return settleBattle(sql, deps, battle.id, outcome.result);
}

export async function verifyStep(sql: Sql, deps: Deps, userId: string, id: string): Promise<BattleSummary> {
  const b = await getBattle(sql, id);
  if (!b || b.attacker_id !== userId) throw notFound('Battle not found');
  if (b.status !== 'verifying') return battleSummary(b);
  return continueVerification(sql, deps, b);
}

/** Applies a verified result exactly once: the battle row's status guards re-entry. */
export async function settleBattle(
  sql: Sql,
  deps: Deps,
  id: string,
  result: BattleResult,
): Promise<BattleSummary> {
  return transaction(sql, async (tx) => {
    const peek = await getBattle(tx, id);
    if (!peek) throw notFound('Battle not found');
    const ids = [peek.attacker_id, ...(peek.defender_id ? [peek.defender_id] : [])];
    const players = await lockPlayers(tx, ids);
    const battle = await lockBattle(tx, id);
    if (battle.status !== 'verifying') return battleSummary(battle);
    const attacker = players.get(battle.attacker_id)!;
    const content = getContent(battle.content_version);
    const now = deps.now();
    const agg = aggregateOf(attacker);
    settle(getContent(attacker.content_version), agg.state, now);
    if (battle.kind !== 'friendly') consumeArmy(agg.state, result, now);
    if (agg.state.activeBattle?.id === battle.id) agg.state.activeBattle = null;
    const deltas: LedgerDelta[] = [];
    const outcome = await handlerFor(battle.kind).settle({
      tx,
      deps,
      content,
      battle,
      result,
      attacker,
      attackerAgg: agg,
      deltas,
      defender: battle.defender_id ? (players.get(battle.defender_id) ?? null) : null,
    });
    await writePlayer(tx, attacker, agg, deltas, `battle:${battle.id}`, {
      ...(outcome.attackerTrophies !== undefined ? { trophies: outcome.attackerTrophies } : {}),
    });
    if (battle.client_hash && battle.client_hash !== result.hash)
      console.warn(`battle ${battle.id}: client hash ${battle.client_hash} != server ${result.hash}`);
    const [updated] = await tx<BattleRow[]>`
      update game.battles set status = 'settled', result = ${tx.json(result as never)},
        rewards = ${tx.json(outcome.rewards as never)}, checkpoint = null, settled_at = ${new Date(now)},
        attacker_trophies_delta = ${outcome.attackerTrophiesDelta ?? null},
        defender_trophies_delta = ${outcome.defenderTrophiesDelta ?? null}
      where id = ${id} returning *`;
    return battleSummary(updated as BattleRow);
  });
}

/** Forged or malformed submissions forfeit the whole army and count as a loss. */
async function rejectBattle(tx: Tx, deps: Deps, b: BattleRow, reason: string) {
  const attacker = await lockPlayer(tx, b.attacker_id);
  const agg = aggregateOf(attacker);
  const now = deps.now();
  settle(getContent(attacker.content_version), agg.state, now);
  const a = b.setup.attacker;
  const all = (slots: { id: string; count: number }[]) =>
    Object.fromEntries(slots.map((s) => [s.id, s.count]));
  consumeArmy(
    agg.state,
    {
      troopsUsed: all(a.troops),
      spellsUsed: all(a.spells),
      siegeUsed: all(a.siege),
      heroesUsed: [],
      reinforcementsUsed: a.reinforcements.length > 0,
      heroHealth: {},
    } as unknown as BattleResult,
    now,
  );
  if (agg.state.activeBattle?.id === b.id) agg.state.activeBattle = null;
  await writePlayer(tx, attacker, agg, [], `battle:${b.id}:reject`);
  await tx`update game.battles set status = 'rejected', reject_reason = ${reason}, settled_at = ${new Date(now)}
    where id = ${b.id}`;
}

/**
 * Settles battles whose submission window passed, using the progress the
 * client recorded. Safe to run concurrently and repeatedly (cron, startBattle).
 */
export async function finalizeExpired(
  sql: Sql,
  deps: Deps,
  opts: { attackerId?: string; limit?: number } = {},
): Promise<number> {
  const now = new Date(deps.now());
  const rows = opts.attackerId
    ? await sql<BattleRow[]>`select * from game.battles where attacker_id = ${opts.attackerId}
        and ((status = 'active' and expires_at < ${now}) or status = 'verifying') limit 5`
    : await sql<BattleRow[]>`select * from game.battles
        where (status = 'active' and expires_at < ${now}) or status = 'verifying'
        order by expires_at limit ${opts.limit ?? 10}`;
  let done = 0;
  for (const r of rows) {
    let b: BattleRow | null = r;
    if (r.status === 'active') {
      b = await transaction(sql, async (tx) => {
        const locked = await lockBattle(tx, r.id);
        if (locked.status !== 'active' || locked.expires_at > now) return null;
        const commands = locked.commands ?? [];
        if (!validateCommands(locked.setup, commands).ok) {
          await rejectBattle(tx, deps, locked, 'expired with invalid progress');
          return null;
        }
        const [u] = await tx<BattleRow[]>`update game.battles set status = 'verifying', submitted_at = ${now}
          where id = ${r.id} returning *`;
        return u as BattleRow;
      });
    }
    if (!b) continue;
    const s = await continueVerification(sql, deps, b);
    if (s.status === 'settled') done++;
  }
  return done;
}

export async function listBattles(sql: Sql, userId: string, limit = 30): Promise<BattleSummary[]> {
  const rows = await sql<(BattleRow & { attacker_name: string; defender_name: string | null })[]>`
    select b.*, a.display_name as attacker_name, d.display_name as defender_name
    from game.battles b
    join game.players a on a.user_id = b.attacker_id
    left join game.players d on d.user_id = b.defender_id
    where b.attacker_id = ${userId} or b.defender_id = ${userId}
    order by b.started_at desc limit ${limit}`;
  return rows.map((r) =>
    battleSummary(r, {
      [r.attacker_id]: r.attacker_name,
      ...(r.defender_id && r.defender_name ? { [r.defender_id]: r.defender_name } : {}),
    }),
  );
}
