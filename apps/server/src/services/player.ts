import { CURRENT_CONTENT_VERSION, getContent } from '@sk/content';
import {
  armyStrength,
  attackerArmy,
  defenderSnapshot,
  defenseStrength,
  hqLevel,
  initialAggregate,
  type LedgerDelta,
  type PlayerAggregate,
  type PlayerState,
} from '@sk/rules';
import type { Deps } from '../context.ts';
import type { Sql, Tx } from '../db.ts';
import { HttpError, notFound } from '../errors.ts';

export interface PlayerRow {
  user_id: string;
  display_name: string;
  friend_code: string;
  timezone: string;
  hq_level: number;
  trophies: number;
  gold: number;
  essence: number;
  state: PlayerState;
  state_version: number;
  content_version: string;
  settings: Record<string, unknown>;
  shield_until: Date | null;
}

const COLUMNS = `user_id, display_name, friend_code, timezone, hq_level, trophies, gold, essence, state,
  state_version, content_version, settings, shield_until`;

export async function getPlayer(sql: Sql | Tx, userId: string): Promise<PlayerRow | null> {
  const rows = await sql<
    PlayerRow[]
  >`select ${sql.unsafe(COLUMNS)} from game.players where user_id = ${userId}`;
  return rows[0] ?? null;
}

/** Locks the player's row for the rest of the transaction. */
export async function lockPlayer(tx: Tx, userId: string): Promise<PlayerRow> {
  const rows = await tx<
    PlayerRow[]
  >`select ${tx.unsafe(COLUMNS)} from game.players where user_id = ${userId} for update`;
  const row = rows[0];
  if (!row) throw notFound('Player not found');
  return row;
}

/** Locks several players in a fixed order so concurrent transactions cannot deadlock. */
export async function lockPlayers(tx: Tx, userIds: string[]): Promise<Map<string, PlayerRow>> {
  const ids = [...new Set(userIds)].sort();
  const rows = await tx<PlayerRow[]>`
    select ${tx.unsafe(COLUMNS)} from game.players where user_id in ${tx(ids)} order by user_id for update`;
  return new Map(rows.map((r) => [r.user_id, r]));
}

export function aggregateOf(row: PlayerRow): PlayerAggregate {
  return { state: row.state, gold: row.gold, essence: row.essence };
}

/**
 * Persists a mutated aggregate and appends one ledger entry per balance
 * change. `keyPrefix` makes the entries idempotent: replaying the same
 * operation violates the ledger's unique key instead of paying twice.
 */
export async function writePlayer(
  tx: Tx,
  row: PlayerRow,
  agg: PlayerAggregate,
  deltas: LedgerDelta[],
  keyPrefix: string,
  extra: { trophies?: number; shieldUntil?: Date | null } = {},
): Promise<PlayerRow> {
  let gold = row.gold;
  let essence = row.essence;
  const entries: Record<string, unknown>[] = [];
  deltas.forEach((d, i) => {
    if (!d.amount) return;
    if (d.resource === 'gold') gold += d.amount;
    else essence += d.amount;
    entries.push({
      user_id: row.user_id,
      resource: d.resource,
      amount: d.amount,
      balance_after: d.resource === 'gold' ? gold : essence,
      reason: d.reason,
      ref: d.ref ?? null,
      idempotency_key: `${keyPrefix}:${i}`,
    });
  });
  if (gold !== agg.gold || essence !== agg.essence)
    throw new Error(`ledger mismatch for ${row.user_id}: ${gold}/${essence} vs ${agg.gold}/${agg.essence}`);
  if (entries.length) await tx`insert into game.ledger ${tx(entries)}`;
  const content = getContent(row.content_version);
  const hq = hqLevel(agg.state);
  const now = Date.now();
  const army = armyStrength(content, attackerArmy(content, agg.state, now));
  const defense = defenseStrength(content, defenderSnapshot(content, agg.state));
  const trophies = extra.trophies ?? row.trophies;
  const shield = extra.shieldUntil === undefined ? row.shield_until : extra.shieldUntil;
  const [updated] = await tx<PlayerRow[]>`
    update game.players set gold = ${agg.gold}, essence = ${agg.essence}, state = ${tx.json(agg.state as never)},
      hq_level = ${hq}, army_strength = ${army}, defense_strength = ${defense}, trophies = ${trophies},
      shield_until = ${shield}, state_version = state_version + 1, updated_at = now(), last_active_at = now()
    where user_id = ${row.user_id} returning ${tx.unsafe(COLUMNS)}`;
  return updated as PlayerRow;
}

/**
 * Runs `fn` at most once per (player, requestId). The player row must already
 * be locked, so a concurrent duplicate waits and then sees the receipt.
 */
export async function withReceipt<T>(
  tx: Tx,
  userId: string,
  requestId: string,
  kind: string,
  fn: () => Promise<T>,
  stored: (out: T) => unknown = () => ({ ok: true }),
): Promise<{ replayed: true; response: unknown } | { replayed: false; value: T }> {
  const [prev] = await tx<{ response: unknown; kind: string }[]>`
    select response, kind from game.requests where user_id = ${userId} and request_id = ${requestId}`;
  if (prev) {
    if (prev.kind !== kind)
      throw new HttpError(409, 'request_reused', 'Request id already used for another action');
    return { replayed: true, response: prev.response };
  }
  const value = await fn();
  await tx`insert into game.requests (user_id, request_id, kind, response)
    values (${userId}, ${requestId}, ${kind}, ${tx.json(stored(value) as never)})`;
  return { replayed: false, value };
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function friendCode(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < 8; i++) out += CODE_ALPHABET[(bytes[i] ?? 0) % CODE_ALPHABET.length];
  return out;
}

function defaultName(meta: Record<string, unknown>, username: string): string {
  const raw = typeof meta.display_name === 'string' ? meta.display_name : username;
  const cleaned = raw
    .replace(/[^\p{L}\p{N} _.'-]/gu, '')
    .trim()
    .slice(0, 24);
  return cleaned.length >= 2 ? cleaned : 'Scholar';
}

function validTimeZone(tz: string | undefined): string {
  if (!tz) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

/**
 * Creates the player on first sign-in. The starter wallet is written through
 * the ledger so balances always equal the ledger sum.
 */
export async function provisionPlayer(
  sql: Sql,
  deps: Deps,
  user: { sub: string; username: string; meta: Record<string, unknown> },
  timezone?: string,
): Promise<PlayerRow> {
  const existing = await getPlayer(sql, user.sub);
  if (existing) return existing;
  const content = getContent(CURRENT_CONTENT_VERSION);
  const agg = initialAggregate(content);
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = friendCode(deps.randomBytes(8));
    try {
      return await sql.begin(async (tx) => {
        const inserted = await tx<PlayerRow[]>`
          insert into game.players (user_id, display_name, friend_code, timezone, gold, essence, state, content_version)
          values (${user.sub}, ${defaultName(user.meta, user.username)}, ${code}, ${validTimeZone(timezone)}, 0, 0,
            ${tx.json(agg.state as never)}, ${content.version})
          on conflict (user_id) do nothing
          returning ${tx.unsafe(COLUMNS)}`;
        const row = inserted[0];
        if (!row) return (await getPlayer(tx, user.sub)) as PlayerRow;
        const deltas: LedgerDelta[] = [
          { resource: 'gold', amount: agg.gold, reason: 'starter_wallet' },
          { resource: 'essence', amount: agg.essence, reason: 'starter_wallet' },
        ];
        return writePlayer(tx, row, agg, deltas, 'starter');
      });
    } catch (e) {
      // Friend code collision: retry with a new code.
      if ((e as { code?: string }).code === '23505' && String((e as Error).message).includes('friend_code'))
        continue;
      throw e;
    }
  }
  throw new Error('could not allocate a friend code');
}

export { validTimeZone };
