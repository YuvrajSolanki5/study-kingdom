import { getContent, isTroopId, type TroopId } from '@sk/content';
import { buildingLevelMax, settle, troopLevel, type PlayerState } from '@sk/rules';
import type { ClanView } from '@sk/shared';
import type { Deps } from '../context.ts';
import { transaction, type Sql, type Tx } from '../db.ts';
import { conflict, forbidden, notFound } from '../errors.ts';
import { aggregateOf, lockPlayer, lockPlayers, withReceipt, writePlayer } from './player.ts';
import { blocked, notify, weekStart } from './social.ts';
import { warViews } from './wars.ts';

export async function membership(sql: Sql | Tx, userId: string, officer = false) {
  const [m] = await sql<
    { clan_id: string; role: string }[]
  >`select clan_id,role from game.clan_members where user_id=${userId}`;
  if (!m || (officer && m.role === 'member'))
    throw forbidden(officer ? 'An officer or leader must do this' : 'Join a clan first');
  return m;
}
export async function clanView(sql: Sql, deps: Deps, userId: string): Promise<ClanView> {
  const [clan] =
    await sql`select c.id,c.name,c.code from game.clans c join game.clan_members m on m.clan_id=c.id where m.user_id=${userId}`;
  const invites =
    await sql`select c.id,c.name from game.clan_invites i join game.clans c on c.id=i.clan_id where i.user_id=${userId} and i.expires_at>${new Date(deps.now())}`;
  const cosmetics = await sql<
    { code: string }[]
  >`select code from game.cosmetics where user_id=${userId} order by earned_at desc`;
  if (!clan)
    return {
      clan: null,
      members: [],
      invites: invites as never,
      requests: [],
      objective: null,
      wars: [],
      cosmetics: cosmetics.map((r) => r.code),
    };
  const members =
    await sql`select m.user_id as "userId",p.display_name as "displayName",m.role from game.clan_members m join game.players p on p.user_id=m.user_id where clan_id=${clan.id} order by m.role,p.display_name`;
  const requests =
    await sql`select r.id,r.user_id as "userId",p.display_name as "displayName",r.capacity,r.housing,r.troops from game.reinforcement_requests r join game.players p on p.user_id=r.user_id where r.clan_id=${clan.id} and not r.claimed order by r.created_at`;
  const objective = await objectiveView(sql, deps, userId, clan.id);
  return {
    clan,
    members,
    invites,
    requests,
    objective,
    wars: await warViews(sql, userId, clan.id),
    cosmetics: cosmetics.map((r) => r.code),
  } as unknown as ClanView;
}
export async function createClan(sql: Sql, deps: Deps, userId: string, name: string) {
  return transaction(sql, async (tx) => {
    await lockPlayer(tx, userId);
    if ((await tx`select 1 from game.clan_members where user_id=${userId}`).length)
      throw conflict('member', 'Leave your current clan first');
    const [clan] = await tx`insert into game.clans (name) values (${name}) returning *`;
    await tx`insert into game.clan_members values (${userId},${clan!.id},'leader',${new Date(deps.now())})`;
    return clan!;
  });
}
export async function inviteMember(sql: Sql, deps: Deps, userId: string, targetId: string) {
  return transaction(sql, async (tx) => {
    const me = await membership(tx, userId, true);
    await tx`select id from game.clans where id=${me.clan_id} for update`;
    if (await blocked(tx, userId, targetId)) throw forbidden();
    if (!(await tx`select 1 from game.players where user_id=${targetId}`).length) throw notFound();
    await tx`insert into game.clan_invites values (${me.clan_id},${targetId},${new Date(deps.now() + 7 * 86400000)}) on conflict (clan_id,user_id) do update set expires_at=excluded.expires_at`;
    await notify(
      tx,
      targetId,
      'You received a clan invitation',
      `clan-invite:${me.clan_id}:${Math.floor(deps.now() / 86400000)}`,
    );
  });
}
export async function joinClan(sql: Sql, deps: Deps, userId: string, clanId: string) {
  return transaction(sql, async (tx) => {
    await lockPlayer(tx, userId);
    const [clan] = await tx`select * from game.clans where id=${clanId} for update`;
    if (!clan) throw notFound();
    const [invite] =
      await tx`select 1 from game.clan_invites where clan_id=${clanId} and user_id=${userId} and expires_at>${new Date(deps.now())}`;
    if (!invite) throw forbidden('Ask a clan officer for an invitation');
    const [member] = await tx`select 1 from game.clan_members where user_id=${userId}`;
    if (member) throw conflict('member', 'Leave your current clan first');
    const [count] = await tx`select count(*)::int as n from game.clan_members where clan_id=${clanId}`;
    if (count!.n >= getContent().economy.clan.maxMembers)
      throw conflict('full', 'Clans hold up to 20 members');
    await tx`insert into game.clan_members values (${userId},${clanId},'member',${new Date(deps.now())})`;
    await tx`delete from game.clan_invites where user_id=${userId}`;
  });
}
export async function changeRole(sql: Sql, userId: string, target: string, role: string) {
  return transaction(sql, async (tx) => {
    await lockPlayers(tx, [userId, target]);
    const me = await membership(tx, userId);
    await tx`select id from game.clans where id=${me.clan_id} for update`;
    if (me.role !== 'leader' || userId === target)
      throw forbidden('Only the leader can change another member’s role');
    const other = await membership(tx, target);
    if (other.clan_id !== me.clan_id) throw notFound();
    if (role === 'leader') await tx`update game.clan_members set role='officer' where user_id=${userId}`;
    await tx`update game.clan_members set role=${role} where user_id=${target}`;
  });
}
export async function leaveClan(sql: Sql, userId: string, target = userId) {
  return transaction(sql, async (tx) => {
    await lockPlayers(tx, [userId, target]);
    const me = await membership(tx, userId),
      other = await membership(tx, target);
    await tx`select id from game.clans where id=${me.clan_id} for update`;
    if (
      me.clan_id !== other.clan_id ||
      (userId !== target &&
        (me.role === 'member' ||
          other.role === 'leader' ||
          (me.role === 'officer' && other.role === 'officer')))
    )
      throw forbidden();
    if (
      (
        await tx`select 1 from game.war_roster r join game.wars w on w.id=r.war_id where r.user_id=${target} and w.status in ('preparation','battle')`
      ).length ||
      (await tx`select 1 from game.wars where status='invited' and home_roster ? ${target}`).length
    )
      throw conflict('war_roster', 'Finish the active war first');
    const [count] = await tx`select count(*)::int as n from game.clan_members where clan_id=${me.clan_id}`;
    if (other.role === 'leader' && count!.n > 1)
      throw conflict('leader', 'Transfer leadership before leaving');
    await tx`update game.reinforcement_requests set claimed=true where user_id=${target} and not claimed`;
    await tx`delete from game.clan_members where user_id=${target}`;
  });
}
function reinforcementCapacity(state: PlayerState) {
  const c = getContent(),
    level = buildingLevelMax(state, 'clan_hall');
  return c.structures.clan_hall?.levels[level - 1]?.reinforcement ?? 0;
}
export async function requestReinforcements(sql: Sql, deps: Deps, userId: string) {
  return transaction(sql, async (tx) => {
    const p = await lockPlayer(tx, userId),
      m = await membership(tx, userId);
    const capacity =
      reinforcementCapacity(p.state) -
      p.state.reinforcements.reduce((s, r) => s + (getContent().troops[r.id]?.housing ?? 0) * r.count, 0);
    if (capacity <= 0) throw conflict('capacity', 'Build a Banner Hall and make room for reinforcements');
    const [prev] =
      await tx`select * from game.reinforcement_requests where user_id=${userId} order by created_at desc limit 1`;
    if (prev && !prev.claimed) return { id: prev.id };
    if (
      prev &&
      deps.now() - prev.created_at.getTime() <
        getContent().economy.clan.reinforcementRequestCooldownMinutes * 60000
    )
      throw conflict('cooldown', 'Wait before requesting again');
    const [request] =
      await tx`insert into game.reinforcement_requests (user_id,clan_id,capacity,created_at) values (${userId},${m.clan_id},${capacity},${new Date(deps.now())}) returning id`;
    return request!;
  });
}
export async function donate(
  sql: Sql,
  deps: Deps,
  userId: string,
  requestId: string,
  body: { requestId: string; troop: string; count: number },
) {
  if (!isTroopId(body.troop)) throw notFound('Trainable troop not found');
  return transaction(sql, async (tx) => {
    const [peek] = await tx`select user_id from game.reinforcement_requests where id=${requestId}`;
    if (!peek) throw notFound();
    const players = await lockPlayers(tx, [userId, peek.user_id]);
    const donor = players.get(userId)!;
    return withReceipt(tx, userId, body.requestId, 'donation', async () => {
      const [req] = await tx`select * from game.reinforcement_requests where id=${requestId} for update`;
      const me = await membership(tx, userId),
        recipient = await membership(tx, req!.user_id);
      if (
        req!.claimed ||
        req!.user_id === userId ||
        me.clan_id !== req!.clan_id ||
        recipient.clan_id !== me.clan_id ||
        (await blocked(tx, userId, req!.user_id))
      )
        throw forbidden('Request is unavailable');
      const content = getContent(donor.content_version),
        agg = aggregateOf(donor);
      settle(content, agg.state, deps.now());
      if (agg.state.activeBattle) throw conflict('battle_active', 'Finish your battle before donating');
      const troop = body.troop as TroopId,
        housing = content.troops[troop]!.housing * body.count;
      if (
        housing > content.economy.clan.maxDonationHousingPerRequest ||
        req!.housing + housing > req!.capacity
      )
        throw conflict('capacity', 'Those troops do not fit in the request');
      if ((agg.state.army.troops[troop] ?? 0) < body.count)
        throw conflict('troops', 'Train those troops first');
      agg.state.army.troops[troop] = (agg.state.army.troops[troop] ?? 0) - body.count;
      const troops = [...req!.troops, { id: troop, level: troopLevel(agg.state, troop), count: body.count }];
      await tx`update game.reinforcement_requests set troops=${tx.json(troops)},housing=housing+${housing} where id=${requestId}`;
      await writePlayer(tx, donor, agg, [], `donation:${body.requestId}`);
      await notify(
        tx,
        req!.user_id,
        `${donor.display_name} donated reinforcements`,
        `donation:${body.requestId}`,
      );
    });
  });
}
export async function claimReinforcements(
  sql: Sql,
  deps: Deps,
  userId: string,
  id: string,
  requestId: string,
) {
  return transaction(sql, async (tx) => {
    const p = await lockPlayer(tx, userId);
    return withReceipt(tx, userId, requestId, 'reinforcement_claim', async () => {
      const [req] =
        await tx`select * from game.reinforcement_requests where id=${id} and user_id=${userId} for update`;
      if (!req || req.claimed) throw notFound('Open request not found');
      if (!req.housing) throw conflict('empty', 'Wait for a donation');
      const me = await membership(tx, userId);
      if (me.clan_id !== req.clan_id) throw forbidden();
      if (p.state.activeBattle) throw conflict('battle_active', 'Finish your battle first');
      const agg = aggregateOf(p),
        used = agg.state.reinforcements.reduce(
          (s, r) => s + (getContent().troops[r.id]?.housing ?? 0) * r.count,
          0,
        );
      if (used + req.housing > reinforcementCapacity(agg.state))
        throw conflict('capacity', 'Not enough reinforcement space');
      agg.state.reinforcements.push(...req.troops);
      await writePlayer(tx, p, agg, [], `reinforcement:${id}`);
      await tx`update game.reinforcement_requests set claimed=true where id=${id}`;
    });
  });
}
async function objectiveView(sql: Sql | Tx, deps: Deps, userId: string, clanId: string) {
  const week = weekStart(deps.now()),
    cfg = getContent().economy.clan;
  // Freeze the weekly roster once. Joining a different clan cannot carry past study across.
  await sql`insert into game.clan_objectives (clan_id,week,roster,target_minutes)
    select ${clanId},${week},coalesce(jsonb_agg(jsonb_build_object('id',user_id,'joined',joined_at)),'[]'),count(*)*${cfg.weeklyObjectiveMinutesPerMember}
    from game.clan_members where clan_id=${clanId} on conflict do nothing`;
  const [objective] = await sql`select * from game.clan_objectives where clan_id=${clanId} and week=${week}`;
  const contributions =
    await sql`select r->>'id' as "userId",least(${cfg.weeklyContributionCapMinutes},coalesce((select floor(sum(s.competitive_seconds)/60)::int from game.study_sessions s where s.user_id=(r->>'id')::uuid and s.ended_at>=greatest(${week},(r->>'joined')::timestamptz) and s.ended_at<${new Date(week.getTime() + 7 * 86400000)}),0)) as minutes from game.clan_objectives o,jsonb_array_elements(o.roster) r where o.clan_id=${clanId} and o.week=${week}`;
  const [claimed] =
    await sql`select 1 from game.cosmetics where user_id=${userId} and code=${`study:${week.toISOString().slice(0, 10)}`}`;
  return {
    week: week.toISOString(),
    minutes: contributions.reduce((s, r) => s + r.minutes, 0),
    targetMinutes: objective!.target_minutes,
    claimed: !!claimed,
    contributions,
  } as NonNullable<ClanView['objective']>;
}
export async function claimObjective(sql: Sql, deps: Deps, userId: string) {
  return transaction(sql, async (tx) => {
    await lockPlayer(tx, userId);
    const me = await membership(tx, userId),
      v = await objectiveView(tx, deps, userId, me.clan_id);
    const [eligible] =
      await tx`select 1 from game.clan_objectives o,jsonb_array_elements(o.roster) r where o.clan_id=${me.clan_id} and o.week=${new Date(v.week)} and r->>'id'=${userId}`;
    if (!eligible || v.minutes < v.targetMinutes)
      throw conflict('objective', 'The shared study objective is still in progress');
    await tx`insert into game.cosmetics values (${userId},${`study:${v.week.slice(0, 10)}`},${new Date(deps.now())}) on conflict do nothing`;
  });
}
