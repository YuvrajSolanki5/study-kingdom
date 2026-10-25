import { getContent } from '@sk/content';
import { defenderSnapshot, settle } from '@sk/rules';
import type { LeagueStanding, RoomView, SocialView } from '@sk/shared';
import type { Deps } from '../context.ts';
import { transaction, type Sql, type Tx } from '../db.ts';
import { conflict, forbidden, notFound } from '../errors.ts';
import { getPlayer, lockPlayers } from './player.ts';

export async function blocked(sql: Sql | Tx, a: string, b: string) {
  const rows =
    await sql`select 1 from game.blocks where (user_id=${a} and target_id=${b}) or (user_id=${b} and target_id=${a})`;
  return rows.length > 0;
}
export async function requireFriends(sql: Sql | Tx, a: string, b: string) {
  if (a === b || (await blocked(sql, a, b))) throw forbidden('This player is unavailable');
  const [lo, hi] = [a, b].sort();
  const rows = await sql`select 1 from game.friendships where a=${lo!} and b=${hi!} and accepted`;
  if (!rows.length) throw forbidden('Add each other as friends first');
}
export async function notify(sql: Sql | Tx, userId: string, message: string, key: string) {
  await sql`insert into game.notifications (user_id,message,dedupe_key) values (${userId},${message},${key}) on conflict do nothing`;
}
export function weekStart(now: number) {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d;
}
export async function socialView(sql: Sql, userId: string, now: number): Promise<SocialView> {
  const friends =
    await sql`select p.user_id as "userId", p.display_name as "displayName", p.friend_code as "friendCode", p.hq_level as "hqLevel", p.trophies,
    f.accepted, (f.requested_by <> ${userId}) as incoming from game.friendships f
    join game.players p on p.user_id=case when f.a=${userId} then f.b else f.a end
    where f.a=${userId} or f.b=${userId} order by p.display_name`;
  const blocks =
    await sql`select p.user_id as "userId",p.display_name as "displayName",p.friend_code as "friendCode",p.hq_level as "hqLevel",p.trophies
    from game.blocks b join game.players p on p.user_id=b.target_id where b.user_id=${userId}`;
  const challenges =
    await sql`select c.id,c.sender,c.recipient,s.display_name as "senderName",r.display_name as "recipientName",c.expires_at as "expiresAt",c.battle_id as "battleId"
    from game.challenges c join game.players s on s.user_id=c.sender join game.players r on r.user_id=c.recipient
    where (c.sender=${userId} or c.recipient=${userId}) and c.expires_at>${new Date(now)} order by c.created_at desc limit 50`;
  const leagues =
    await sql`select l.id,l.name,l.code from game.leagues l join game.league_members m on m.league_id=l.id where m.user_id=${userId}`;
  const [membership] = await sql`select room_id from game.room_members where user_id=${userId}`;
  const room = membership ? await roomView(sql, userId, membership.room_id, now) : null;
  return { friends, blocked: blocks, challenges, leagues, room } as unknown as SocialView;
}
export async function friendAction(
  sql: Sql,
  deps: Deps,
  userId: string,
  targetId: string,
  action: 'request' | 'accept' | 'remove' | 'block' | 'unblock',
) {
  if (userId === targetId) throw conflict('self', 'Choose another player');
  return transaction(sql, async (tx) => {
    const players = await lockPlayers(tx, [userId, targetId]);
    if (players.size !== 2) throw notFound('Player not found');
    const [a, b] = [userId, targetId].sort() as [string, string];
    if (action === 'unblock') {
      await tx`delete from game.blocks where user_id=${userId} and target_id=${targetId}`;
      return;
    }
    if (action === 'block')
      await tx`insert into game.blocks values (${userId},${targetId}) on conflict do nothing`;
    if (action === 'remove' || action === 'block') {
      await tx`delete from game.friendships where a=${a} and b=${b}`;
      await tx`delete from game.challenges where (sender=${userId} and recipient=${targetId}) or (sender=${targetId} and recipient=${userId})`;
      return;
    }
    if (await blocked(tx, userId, targetId)) throw forbidden('This player is unavailable');
    const cfg = getContent().economy.social;
    for (const uid of [userId, targetId]) {
      const [n] = await tx`select count(*)::int as n from game.friendships where a=${uid} or b=${uid}`;
      if (n!.n >= cfg.maxFriends && action === 'request') throw conflict('full', 'Friend list is full');
    }
    if (action === 'request') {
      await tx`insert into game.friendships (a,b,requested_by) values (${a},${b},${userId}) on conflict do nothing`;
      await notify(
        tx,
        targetId,
        `${players.get(userId)!.display_name} sent a friend request`,
        `friend:${userId}:${Math.floor(deps.now() / 86400000)}`,
      );
    } else {
      const changed =
        await tx`update game.friendships set accepted=true where a=${a} and b=${b} and requested_by=${targetId} returning a`;
      if (!changed.length) throw notFound('Incoming request not found');
      await notify(
        tx,
        targetId,
        `${players.get(userId)!.display_name} accepted your friend request`,
        `accepted:${userId}:${Math.floor(deps.now() / 86400000)}`,
      );
    }
  });
}
export async function visit(sql: Sql, userId: string, targetId: string, now: number) {
  await requireFriends(sql, userId, targetId);
  const player = await getPlayer(sql, targetId);
  if (!player) throw notFound();
  const content = getContent(player.content_version);
  settle(content, player.state, now);
  const snapshot = defenderSnapshot(content, player.state);
  // Hidden traps remain private during visits; battle scouting follows combat rules.
  snapshot.buildings = snapshot.buildings.filter(
    (b) =>
      content.structures[b.defId]?.category !== 'trap' &&
      !content.structures[b.defId]?.levels[b.level - 1]?.defense?.hidden,
  );
  return { displayName: player.display_name, contentVersion: content.version, snapshot };
}
export async function createChallenge(sql: Sql, deps: Deps, sender: string, recipient: string) {
  return transaction(sql, async (tx) => {
    const players = await lockPlayers(tx, [sender, recipient]);
    await requireFriends(tx, sender, recipient);
    const [count] =
      await tx`select count(*)::int as n from game.challenges where sender=${sender} and created_at>${new Date(deps.now() - 3600000)}`;
    if (count!.n >= 10) throw conflict('limit', 'Up to ten challenges per hour');
    const [row] =
      await tx`insert into game.challenges (sender,recipient,expires_at,created_at) values (${sender},${recipient},${new Date(deps.now() + 86400000)},${new Date(deps.now())}) returning id`;
    await notify(
      tx,
      recipient,
      `${players.get(sender)!.display_name} challenged your army`,
      `challenge:${row!.id}`,
    );
    return row!;
  });
}
export async function joinGroup(
  sql: Sql,
  deps: Deps,
  userId: string,
  kind: 'league' | 'room',
  input: { name?: string; code?: string },
) {
  return transaction(sql, async (tx) => {
    const [player] = await tx`select user_id from game.players where user_id=${userId} for update`;
    if (!player) throw notFound();
    const table = kind === 'league' ? 'leagues' : 'study_rooms';
    let group;
    if (input.name) {
      const [owned] = await tx`select count(*)::int as n from game.${tx.unsafe(table)} where owner=${userId}`;
      if (owned!.n >= 5) throw conflict('limit', 'You can create up to five groups');
      [group] =
        await tx`insert into game.${tx.unsafe(table)} (owner,name) values (${userId},${input.name}) returning *`;
    } else [group] = await tx`select * from game.${tx.unsafe(table)} where code=${input.code!} for update`;
    if (!group) throw notFound('Invite code not found');
    if (await blocked(tx, userId, group.owner)) throw forbidden();
    if (kind === 'room')
      await tx`delete from game.room_members where room_id=${group.id} and last_seen_at<=${new Date(deps.now() - 120000)}`;
    const members =
      kind === 'league'
        ? await tx`select user_id from game.league_members where league_id=${group.id}`
        : await tx`select user_id from game.room_members where room_id=${group.id} and last_seen_at>${new Date(deps.now() - 120000)}`;
    const cap =
      kind === 'league'
        ? getContent().economy.social.leagueMaxMembers
        : getContent().economy.social.roomMaxMembers;
    if (!members.some((m) => m.user_id === userId) && members.length >= cap)
      throw conflict('full', 'This group is full');
    if (kind === 'league') {
      const [n] = await tx`select count(*)::int as n from game.league_members where user_id=${userId}`;
      if (n!.n >= 5 && !members.some((m) => m.user_id === userId))
        throw conflict('limit', 'Join up to five leagues');
      await tx`insert into game.league_members (league_id,user_id,joined_at) values (${group.id},${userId},${new Date(deps.now())}) on conflict do nothing`;
    } else
      await tx`insert into game.room_members values (${userId},${group.id},${new Date(deps.now())}) on conflict (user_id) do update set room_id=excluded.room_id,last_seen_at=excluded.last_seen_at`;
    return { id: group.id, name: group.name, code: group.code };
  });
}
export async function roomView(sql: Sql, userId: string, roomId: string, now: number): Promise<RoomView> {
  const [room] =
    await sql`select r.* from game.study_rooms r join game.room_members m on m.room_id=r.id where r.id=${roomId} and m.user_id=${userId}`;
  if (!room) throw notFound();
  const members =
    await sql`select p.user_id as "userId",p.display_name as "displayName",case when s.status='running' then 'focus' when s.status='paused' then 'break' else 'finished' end as status
    from game.room_members m join game.players p on p.user_id=m.user_id
    left join game.study_sessions s on s.user_id=m.user_id and s.status in ('created','running','paused')
    where m.room_id=${roomId} and m.last_seen_at>${new Date(now - 120000)}
    and not exists(select 1 from game.blocks where (user_id=${userId} and target_id=p.user_id) or (user_id=p.user_id and target_id=${userId})) order by p.display_name`;
  return { id: room.id, name: room.name, code: room.code, members } as unknown as RoomView;
}
export async function standings(
  sql: Sql,
  userId: string,
  leagueId: string,
  now: number,
): Promise<{ week: string; standings: LeagueStanding[] }> {
  const [member] =
    await sql`select 1 from game.league_members where league_id=${leagueId} and user_id=${userId}`;
  if (!member) throw notFound();
  const start = weekStart(now),
    end = new Date(start.getTime() + 7 * 86400000);
  const cfg = getContent().economy.social;
  const rows = await sql`select p.user_id as "userId",p.display_name as "displayName",
    coalesce((select floor(sum(s.competitive_seconds)/60)::int from game.study_sessions s where s.user_id=p.user_id and s.ended_at>=greatest(${start},m.joined_at) and s.ended_at<${end}),0) as "studyMinutes",
    coalesce((select sum(d.stars)::int from (select least(sum((b.result->>'stars')::int),${cfg.leagueDailyStarCap}) as stars from game.battles b where b.attacker_id=p.user_id and b.status='settled' and b.kind in ('ranked','friendly') and b.started_at>=greatest(${start},m.joined_at) and b.started_at<${end} group by (b.started_at at time zone 'UTC')::date) d),0) as stars
    from game.league_members m join game.players p on p.user_id=m.user_id where m.league_id=${leagueId}`;
  const result = rows.map((r) => ({
    ...r,
    points: r.studyMinutes * cfg.leagueStudyPointsPerMinute + r.stars * cfg.leagueBattleStarPoints,
  })) as LeagueStanding[];
  result.sort((a, b) => b.points - a.points || a.userId.localeCompare(b.userId));
  return { week: start.toISOString(), standings: result };
}
