import { getContent } from '@sk/content';
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
import type { BattleKindHandler } from './battles.ts';
import { registerBattleKind } from './battles.ts';
import { z } from 'zod';
import { conflict, notFound } from '../errors.ts';
import { aggregateOf, getPlayer, writePlayer } from './player.ts';
import { blocked, notify, requireFriends } from './social.ts';

const friendly: BattleKindHandler = {
  async resolve(tx, deps, content, attacker, target) {
    z.uuid().parse(target);
    const [challenge] =
      await tx`select * from game.challenges where id=${target ?? null} and recipient=${attacker.user_id} and expires_at>${new Date(deps.now())} for update`;
    if (!challenge || challenge.battle_id) throw notFound('Open challenge not found');
    await requireFriends(tx, attacker.user_id, challenge.sender);
    const defender = (await getPlayer(tx, challenge.sender))!;
    settle(getContent(defender.content_version), defender.state, deps.now());
    // Reserve this challenge inside the same transaction as battle creation.

    return {
      defenderId: defender.user_id,
      targetRef: challenge.id,
      defender: defenderSnapshot(content, defender.state),
    };
  },
  async started(tx, battle) {
    await tx`update game.challenges set battle_id=${battle.id} where id=${battle.target_ref!}`;
  },
  async settle({ tx, battle, result }) {
    await tx`update game.challenges set battle_id=${battle.id} where id=${battle.target_ref!}`;
    if (battle.defender_id)
      await notify(
        tx,
        battle.defender_id,
        `Your friendly challenge finished: ${result.stars} stars`,
        `battle:${battle.id}`,
      );
    return { rewards: { gold: 0, essence: 0, trophies: 0 } };
  },
};
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
    if (!candidates.length) throw notFound('No suitable opponent yet. Try a campaign or friendly challenge.');
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
export function registerRivalry() {
  registerBattleKind('friendly', friendly);
  registerBattleKind('ranked', ranked);
}
