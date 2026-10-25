import { getContent, type GameContent } from '@sk/content';
import {
  armyStrength,
  attackerArmy,
  credit,
  defenderSnapshot,
  hqLevel,
  rankedBonus,
  rankedTrophies,
  settle,
} from '@sk/rules';
import type { BattleKindHandler, BattleRow } from './battles.ts';
import { registerBattleKind } from './battles.ts';
import { z } from 'zod';
import type { Deps } from '../context.ts';
import type { Tx } from '../db.ts';
import { conflict, notFound } from '../errors.ts';
import { aggregateOf, getPlayer, writePlayer, type PlayerRow } from './player.ts';
import { blocked, notify, requireFriends } from './social.ts';

/** Direct friendly attacks (without a challenge) allowed per attacker per hour. */
const FRIENDLY_PER_HOUR = 10;

/**
 * Practice battles between friends: no army is used up and nothing is won or
 * lost. `target` is either a challenge the friend sent, or the friend's user
 * id to attack their village directly. A direct attack's target_ref is the
 * defender's id, which is how the later hooks tell the two apart.
 */
const friendly: BattleKindHandler = {
  async resolve(tx, deps, content, attacker, target) {
    const id = z.uuid().parse(target);
    const [challenge] =
      await tx`select * from game.challenges where id=${id} and recipient=${attacker.user_id} and expires_at>${new Date(deps.now())} for update`;
    let defenderId: string;
    if (challenge) {
      if (challenge.battle_id) throw notFound('Open challenge not found');
      defenderId = challenge.sender as string;
    } else {
      const [friend] = await tx`select 1 from game.players where user_id=${id}`;
      if (!friend) throw notFound('Open challenge not found');
      const [recent] =
        await tx`select count(*)::int as n from game.battles where attacker_id=${attacker.user_id} and kind='friendly' and target_ref=defender_id::text and started_at>${new Date(deps.now() - 3600000)}`;
      if (recent!.n >= FRIENDLY_PER_HOUR)
        throw conflict('limit', `Up to ${FRIENDLY_PER_HOUR} friendly attacks per hour`);
      defenderId = id;
    }
    await requireFriends(tx, attacker.user_id, defenderId);
    const defender = (await getPlayer(tx, defenderId))!;
    settle(getContent(defender.content_version), defender.state, deps.now());
    return {
      defenderId: defender.user_id,
      targetRef: challenge ? (challenge.id as string) : defender.user_id,
      defender: defenderSnapshot(content, defender.state),
    };
  },
  async started(tx, battle) {
    // Reserve the challenge inside the same transaction as battle creation.
    if (!isDirect(battle))
      await tx`update game.challenges set battle_id=${battle.id} where id=${battle.target_ref!}`;
  },
  async settle({ tx, battle, result, attacker }) {
    if (!isDirect(battle))
      await tx`update game.challenges set battle_id=${battle.id} where id=${battle.target_ref!}`;
    if (battle.defender_id)
      await notify(
        tx,
        battle.defender_id,
        isDirect(battle)
          ? `${attacker.display_name} practised on your village: ${result.stars} stars`
          : `Your friendly challenge finished: ${result.stars} stars`,
        `battle:${battle.id}`,
      );
    return { rewards: { gold: 0, essence: 0, trophies: 0 } };
  },
};

function isDirect(battle: BattleRow) {
  return battle.target_ref === battle.defender_id;
}
const ranked: BattleKindHandler = {
  async resolve(tx, deps, content, attacker, target) {
    if (target) z.uuid().parse(target);
    const cfg = content.economy.ranked,
      now = new Date(deps.now());
    const [played] =
      await tx`select count(*)::int as n from game.battles where attacker_id=${attacker.user_id} and kind='ranked' and started_at>=${new Date(deps.now() - 86400000)}`;
    if (played!.n >= 20) throw conflict('daily_limit', 'Up to twenty ranked raids per day');
    const strength = armyStrength(content, attackerArmy(content, attacker.state, deps.now()));
    const candidates = await tx<{ user_id: string }[]>`select p.user_id from game.players p
      where p.user_id<>${attacker.user_id} and p.content_version=${content.version}
      and abs(p.hq_level-${hqLevel(attacker.state)})<=${cfg.matchHqWindow}
      and abs(p.trophies-${attacker.trophies})<=${cfg.matchTrophyWindow}
      and (p.shield_until is null or p.shield_until<=${now})
      and (${target ?? null}::uuid is null or p.user_id=${target ?? null}::uuid)
      and not exists(select 1 from game.blocks x where (x.user_id=${attacker.user_id} and x.target_id=p.user_id) or (x.user_id=p.user_id and x.target_id=${attacker.user_id}))
      and not exists(select 1 from game.battles b where b.attacker_id=${attacker.user_id} and b.defender_id=p.user_id and b.kind='ranked' and b.started_at>${new Date(deps.now() - cfg.sameTargetCooldownHours * 3600000)})
      order by abs(p.defense_strength-${strength}),abs(p.trophies-${attacker.trophies}),p.user_id limit 1`;
    if (!candidates.length) {
      if (target) throw conflict('not_raidable', await whyNotRaidable(tx, deps, content, attacker, target));
      throw notFound('No suitable opponent yet. Try a campaign or friendly challenge.');
    }
    const defender = (await getPlayer(tx, candidates[0]!.user_id))!;
    settle(getContent(defender.content_version), defender.state, deps.now());
    return {
      defenderId: defender.user_id,
      targetRef: defender.user_id,
      defender: defenderSnapshot(content, defender.state),
    };
  },
  async settle({ tx, deps, content, battle, result, attacker, attackerAgg, deltas, defender }) {
    if (!defender) return { rewards: { gold: 0, essence: 0, trophies: 0 } };
    const cfg = content.economy.ranked;
    const trophy = rankedTrophies(cfg, attacker.trophies, defender.trophies, result.stars);
    const day = new Date(deps.now());
    day.setUTCHours(0, 0, 0, 0);
    const [wins] =
      await tx`select count(*)::int as n from game.battles where attacker_id=${attacker.user_id} and kind='ranked' and status='settled' and (result->>'stars')::int>0 and settled_at>=${day}`;
    const bonus =
      result.stars > 0 && wins!.n < cfg.dailyRewardedWins ? rankedBonus(content, attacker.hq_level) : {};
    const paid = credit(
      { content, now: deps.now() },
      attackerAgg,
      bonus,
      deltas,
      'ranked_reward',
      `battle:${battle.id}`,
    );
    const dAgg = aggregateOf(defender);
    await writePlayer(tx, defender, dAgg, [], `battle:${battle.id}:defend`, {
      trophies: defender.trophies + trophy.defender,
      shieldUntil:
        result.destructionPercent >= cfg.shieldDestructionPercent
          ? new Date(deps.now() + cfg.shieldHours * 3600000)
          : defender.shield_until,
    });
    if (!(await blocked(tx, attacker.user_id, defender.user_id)))
      await notify(
        tx,
        defender.user_id,
        `${attacker.display_name} raided your village: ${result.stars} stars. Your resources are safe.`,
        `battle:${battle.id}`,
      );
    return {
      rewards: { gold: paid.gold, essence: paid.essence, trophies: trophy.attacker },
      attackerTrophies: attacker.trophies + trophy.attacker,
      attackerTrophiesDelta: trophy.attacker,
      defenderTrophiesDelta: trophy.defender,
    };
  },
};
/** Explains why a chosen player cannot be raided right now (same rules as matching). */
async function whyNotRaidable(
  tx: Tx,
  deps: Deps,
  content: GameContent,
  attacker: PlayerRow,
  target: string,
): Promise<string> {
  const cfg = content.economy.ranked;
  const p = await getPlayer(tx, target);
  if (!p || p.user_id === attacker.user_id || (await blocked(tx, attacker.user_id, target)))
    return 'This player is unavailable';
  const name = p.display_name;
  if (p.content_version !== content.version) return `${name} is on a different game version`;
  if (Math.abs(hqLevel(p.state) - hqLevel(attacker.state)) > cfg.matchHqWindow)
    return `Ranked raids need Keeps within ${cfg.matchHqWindow} level of each other. Try a friendly battle with ${name}.`;
  if (Math.abs(p.trophies - attacker.trophies) > cfg.matchTrophyWindow)
    return `Ranked raids need trophies within ${cfg.matchTrophyWindow} of each other. Try a friendly battle with ${name}.`;
  if (p.shield_until && p.shield_until.getTime() > deps.now())
    return `${name} is shielded after a recent raid. Try a friendly battle instead.`;
  return `You raided ${name} in the last ${cfg.sameTargetCooldownHours} hours. Try a friendly battle instead.`;
}

export function registerRivalry() {
  registerBattleKind('friendly', friendly);
  registerBattleKind('ranked', ranked);
}
