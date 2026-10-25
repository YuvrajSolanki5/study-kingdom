import { getContent } from '@sk/content';
import { defenderSnapshot, settle, type PlayerState } from '@sk/rules';
import type { WarView } from '@sk/shared';
import type { BattleSetup } from '@sk/sim';
import { z } from 'zod';
import type { Deps } from '../context.ts';
import { transaction, type Sql, type Tx } from '../db.ts';
import { conflict, forbidden, notFound } from '../errors.ts';
import { registerBattleKind, type BattleKindHandler } from './battles.ts';
import { getPlayer } from './player.ts';
import { membership } from './clans.ts';
import { notify } from './social.ts';

interface WarRow {
  id: string;
  home: string;
  away: string;
  home_roster: string[];
  status: WarView['status'];
  preparation_until: Date | null;
  battle_until: Date | null;
  invited_at: Date;
  result: WarView['result'];
}
async function lockClanPair(tx: Tx, a: string, b: string) {
  const ids = [a, b].sort();
  await tx`select id from game.clans where id in ${tx(ids)} order by id for update`;
}
async function assertRoster(tx: Tx, clanId: string, roster: string[]) {
  if (roster.length !== 5 || new Set(roster).size !== 5)
    throw conflict('roster', 'Choose five different members');
  const members =
    await tx`select user_id from game.clan_members where clan_id=${clanId} and user_id in ${tx(roster)}`;
  if (members.length !== 5) throw conflict('roster', 'All five players must belong to the clan');
}
export async function challengeWar(sql: Sql, deps: Deps, userId: string, other: string, roster: string[]) {
  return transaction(sql, async (tx) => {
    const me = await membership(tx, userId, true);
    if (me.clan_id === other) throw forbidden();
    await lockClanPair(tx, me.clan_id, other);
    if (!(await tx`select 1 from game.clans where id=${other}`).length) throw notFound('Clan not found');
    await assertRoster(tx, me.clan_id, roster);
    const [busy] =
      await tx`select 1 from game.wars where status in ('invited','preparation','battle') and (home in (${me.clan_id},${other}) or away in (${me.clan_id},${other}))`;
    if (busy) throw conflict('war_active', 'One of these clans already has a war or pending invitation');
    const [war] =
      await tx`insert into game.wars(home,away,home_roster,status,invited_at) values (${me.clan_id},${other},${tx.json(roster)},'invited',${new Date(deps.now())}) returning id`;
    const leaders =
      await tx`select user_id from game.clan_members where clan_id=${other} and role in ('leader','officer')`;
    for (const p of leaders)
      await notify(tx, p.user_id, 'Your clan received a 5v5 war challenge', `war:${war!.id}`);
    return war!;
  });
}
export async function respondWar(sql: Sql, deps: Deps, userId: string, id: string, roster: string[] | null) {
  return transaction(sql, async (tx) => {
    const me = await membership(tx, userId, true);
    const [peek] = await tx<WarRow[]>`select * from game.wars where id=${id}`;
    if (!peek) throw notFound();
    await lockClanPair(tx, peek.home, peek.away);
    const [war] = await tx<WarRow[]>`select * from game.wars where id=${id} for update`;
    if (!war || war.away !== me.clan_id) throw forbidden();
    if (war.status !== 'invited') return { id: war.id };
    if (!roster || deps.now() - war.invited_at.getTime() > 7 * 86400000) {
      await tx`update game.wars set status='declined' where id=${id}`;
      return { id };
    }
    await assertRoster(tx, war.home, war.home_roster);
    await assertRoster(tx, war.away, roster);
    const entries = [
      ...war.home_roster.map((userId) => ({ userId, clanId: war.home })),
      ...roster.map((userId) => ({ userId, clanId: war.away })),
    ].sort((a, b) => a.userId.localeCompare(b.userId));
    // Lock players in a stable order. Layout changes take the same player lock.
    await tx`select user_id from game.players where user_id in ${tx(entries.map((e) => e.userId))} order by user_id for update`;
    for (const entry of entries) {
      const p = (await getPlayer(tx, entry.userId))!;
      const content = getContent(p.content_version);
      settle(content, p.state, deps.now());
      const position = (entry.clanId === war.home ? war.home_roster : roster).indexOf(entry.userId) + 1;
      await tx`insert into game.war_roster values (${id},${entry.userId},${entry.clanId},${position},${tx.json(defenderSnapshot(content, p.state, { useWarLayout: true }) as never)},${tx.json(p.state as never)},${content.version})`;
    }
    const cfg = getContent().economy.clan,
      prep = deps.now() + cfg.warPreparationHours * 3600000;
    await tx`update game.wars set status='preparation',preparation_until=${new Date(prep)},battle_until=${new Date(prep + cfg.warBattleHours * 3600000)} where id=${id}`;
    return { id };
  });
}
/** Called within every village mutation: preparation layouts stop changing at the deadline even if cron is late. */
export async function updateWarLayout(
  tx: Tx,
  userId: string,
  state: PlayerState,
  _contentVersion: string,
  now: number,
) {
  await tx`update game.war_roster r set preparation_state=${tx.json(state as never)} from game.wars w where r.war_id=w.id and r.user_id=${userId} and w.status='preparation' and w.preparation_until>${new Date(now)}`;
}
async function freezeWarLayouts(tx: Tx, war: WarRow) {
  const roster = await tx<
    { user_id: string; content_version: string; preparation_state: PlayerState }[]
  >`select user_id,content_version,preparation_state from game.war_roster where war_id=${war.id} order by user_id for update`;
  for (const r of roster) {
    const content = getContent(r.content_version);
    settle(content, r.preparation_state, war.preparation_until!.getTime());
    const snapshot = defenderSnapshot(content, r.preparation_state, { useWarLayout: true });
    await tx`update game.war_roster set snapshot=${tx.json(snapshot as never)} where war_id=${war.id} and user_id=${r.user_id}`;
  }
}
export async function advanceWars(sql: Sql, deps: Deps, limit = 5) {
  const now = new Date(deps.now());
  // Old invitations never keep a clan locked indefinitely.
  await sql`update game.wars set status='declined' where status='invited' and invited_at<${new Date(deps.now() - 7 * 86400000)}`;
  const rows = await sql<
    { id: string }[]
  >`select id from game.wars where (status='preparation' and preparation_until<=${now}) or (status='battle' and battle_until<=${now}) order by battle_until limit ${limit}`;
  for (const row of rows)
    await transaction(sql, async (tx) => {
      const [war] = await tx<WarRow[]>`select * from game.wars where id=${row.id} for update`;
      if (!war) return;
      if (war.status === 'preparation' && war.preparation_until! <= now) {
        await freezeWarLayouts(tx, war);
        await tx`update game.wars set status='battle' where id=${row.id}`;
      }
      if (!['preparation', 'battle'].includes(war.status) || !war.battle_until || war.battle_until > now)
        return;
      const [pending] =
        await tx`select 1 from game.war_attacks a join game.battles b on b.id=a.battle_id where a.war_id=${war.id} and b.status in ('active','verifying') limit 1`;
      if (pending) return;
      const scores =
        await tx`select r.clan_id,coalesce(sum(best.stars),0)::int as stars,coalesce(sum(best.destruction),0)::int as destruction
      from game.war_roster r left join lateral (
        select (b.result->>'stars')::int as stars,(b.result->>'destructionPercent')::int as destruction
        from game.war_attacks a join game.battles b on b.id=a.battle_id
        where a.war_id=r.war_id and a.defender=r.user_id and b.status='settled'
        order by (b.result->>'stars')::int desc,(b.result->>'destructionPercent')::int desc,b.id limit 1
      ) best on true where r.war_id=${war.id} group by r.clan_id`;
      const againstHome = scores.find((s) => s.clan_id === war.home),
        againstAway = scores.find((s) => s.clan_id === war.away);
      const homeStars = againstAway?.stars ?? 0,
        awayStars = againstHome?.stars ?? 0,
        homeDestruction = againstAway?.destruction ?? 0,
        awayDestruction = againstHome?.destruction ?? 0;
      const diff = homeStars - awayStars || homeDestruction - awayDestruction;
      const result = {
        winner: diff === 0 ? null : diff > 0 ? war.home : war.away,
        homeStars,
        awayStars,
        homeDestruction,
        awayDestruction,
      };
      await tx`update game.wars set status='settled',result=${tx.json(result)},settled_at=${now} where id=${war.id}`;
      const roster = await tx<
        { user_id: string; clan_id: string }[]
      >`select user_id,clan_id from game.war_roster where war_id=${war.id} order by user_id for update`;
      for (const p of roster) {
        if (p.clan_id === result.winner)
          await tx`insert into game.cosmetics values (${p.user_id},${`war:${war.id}`},${now}) on conflict do nothing`;
        await notify(
          tx,
          p.user_id,
          result.winner === null
            ? 'Clan war ended in a draw'
            : p.clan_id === result.winner
              ? 'Your clan won the war!'
              : 'Clan war finished',
          `war-result:${war.id}`,
        );
      }
    });
}
export async function warViews(sql: Sql, _userId: string, clanId: string): Promise<WarView[]> {
  const wars =
    await sql`select w.*,h.name as home_name,a.name as away_name from game.wars w join game.clans h on h.id=w.home join game.clans a on a.id=w.away where w.home=${clanId} or w.away=${clanId} order by w.invited_at desc limit 10`;
  const result: WarView[] = [];
  for (const w of wars) {
    const roster =
      await sql`select r.user_id as "userId",p.display_name as "displayName",r.clan_id as "clanId",r.position,(r.snapshot->>'hqLevel')::int as "hqLevel" from game.war_roster r join game.players p on p.user_id=r.user_id where war_id=${w.id} order by r.clan_id,r.position`;
    const attacks =
      await sql`select a.attacker,a.defender,a.battle_id as "battleId",(b.result->>'stars')::int as stars,(b.result->>'destructionPercent')::int as "destructionPercent" from game.war_attacks a left join game.battles b on b.id=a.battle_id where a.war_id=${w.id} order by a.attempt,a.attacker`;
    result.push({
      id: w.id,
      home: w.home,
      away: w.away,
      homeName: w.home_name,
      awayName: w.away_name,
      status: w.status,
      preparationUntil: w.preparation_until?.toISOString() ?? null,
      battleUntil: w.battle_until?.toISOString() ?? null,
      result: w.result,
      roster,
      attacks,
    } as WarView);
  }
  return result;
}
const warHandler: BattleKindHandler = {
  async resolve(tx, deps, content, attacker, target) {
    const [warId, defenderId] = String(target).split(':');
    z.uuid().parse(warId);
    z.uuid().parse(defenderId);
    const [war] = await tx<WarRow[]>`select * from game.wars where id=${warId!} for update`;
    if (
      !war ||
      !war.preparation_until ||
      !war.battle_until ||
      deps.now() < war.preparation_until.getTime() ||
      deps.now() >= war.battle_until.getTime() ||
      !['preparation', 'battle'].includes(war.status)
    )
      throw conflict('war_phase', 'Attacks are only available during the battle phase');
    if (war.status === 'preparation') await freezeWarLayouts(tx, war);
    const [me] =
      await tx`select * from game.war_roster where war_id=${war.id} and user_id=${attacker.user_id}`;
    const [enemy] = await tx`select * from game.war_roster where war_id=${war.id} and user_id=${defenderId!}`;
    if (!me || !enemy || me.clan_id === enemy.clan_id) throw forbidden('Choose an opposing war base');
    if (enemy.content_version !== content.version)
      throw conflict('version', 'War uses a different content version');
    const [used] =
      await tx`select count(*)::int as n from game.war_attacks where war_id=${war.id} and attacker=${attacker.user_id}`;
    if (used!.n >= getContent().economy.clan.warAttacksPerMember)
      throw conflict('war_attacks', 'You have used both war attacks');
    const [reservation] =
      await tx`insert into game.war_attacks (war_id,attacker,defender,attempt) values (${war.id},${attacker.user_id},${defenderId!},${used!.n + 1}) returning id`;
    await tx`update game.wars set status='battle' where id=${war.id}`;
    return {
      defenderId: defenderId!,
      targetRef: reservation!.id,
      defender: enemy.snapshot as BattleSetup['defender'],
    };
  },
  async started(tx, battle) {
    await tx`update game.war_attacks set battle_id=${battle.id} where id=${battle.target_ref!}`;
  },
  async settle() {
    return { rewards: { gold: 0, essence: 0, trophies: 0 } };
  },
};
export function registerWars() {
  registerBattleKind('war', warHandler);
}
