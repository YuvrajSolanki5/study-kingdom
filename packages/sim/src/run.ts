import { getContent, hasContentVersion } from '@sk/content';
import { canDeploy, createRuntime, destructionPercent, starsOf, stepTick, type Runtime } from './world.ts';
import {
  MT,
  SUPPORTED_SIM_VERSIONS,
  TPS,
  Team,
  type BattleResult,
  type BattleSetup,
  type Command,
  type SimState,
} from './types.ts';

export const MAX_COMMANDS = 1500;

export type ValidationError = { ok: false; error: string; index?: number };

/**
 * Static validation of a command list against the frozen battle setup. Rejects
 * anything a legitimate client could not have produced: unknown or excess
 * units, out-of-order ticks, deployments inside the no-deploy zone.
 */
export function validateCommands(setup: BattleSetup, commands: unknown): { ok: true } | ValidationError {
  if (!SUPPORTED_SIM_VERSIONS.includes(setup.simVersion))
    return { ok: false, error: `unsupported sim version ${setup.simVersion}` };
  if (!hasContentVersion(setup.contentVersion))
    return { ok: false, error: `unknown content version ${setup.contentVersion}` };
  if (!Array.isArray(commands)) return { ok: false, error: 'commands must be an array' };
  if (commands.length > MAX_COMMANDS) return { ok: false, error: 'too many commands' };
  const content = getContent(setup.contentVersion);
  const duration = content.economy.battle.durationSeconds * TPS;
  const rt = createRuntime(setup);
  const a = setup.attacker;
  const troops = new Map(a.troops.map((t) => [t.id, t.count]));
  const spells = new Map(a.spells.map((t) => [t.id, t.count]));
  const siege = new Map(a.siege.map((t) => [t.id, t.count]));
  const heroes = new Set(a.heroes.map((h) => h.id));
  const heroTick = new Map<string, number>();
  const abilityUsed = new Set<string>();
  let reinforceUsed = false;
  let last = 0;
  const lim = content.map.size * MT;
  const isPos = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) < lim;
  for (let i = 0; i < commands.length; i++) {
    const c = commands[i] as Partial<Command> & Record<string, unknown>;
    const fail = (error: string): ValidationError => ({ ok: false, error, index: i });
    if (!c || typeof c !== 'object') return fail('command must be an object');
    if (!Number.isInteger(c.t) || (c.t as number) < 0 || (c.t as number) >= duration) return fail('bad tick');
    if ((c.t as number) < last) return fail('ticks must not decrease');
    last = c.t as number;
    const id = c.id as string;
    switch (c.k) {
      case 'troop': {
        if (!isPos(c.x) || !isPos(c.y)) return fail('bad position');
        const left = troops.get(id);
        if (!left) return fail(`no ${id} left to deploy`);
        if (!canDeploy(rt, c.x, c.y)) return fail('inside no-deploy zone');
        troops.set(id, left - 1);
        break;
      }
      case 'spell': {
        if (!isPos(c.x) || !isPos(c.y)) return fail('bad position');
        const left = spells.get(id);
        if (!left) return fail(`no ${id} left to cast`);
        spells.set(id, left - 1);
        break;
      }
      case 'hero': {
        if (!isPos(c.x) || !isPos(c.y)) return fail('bad position');
        if (!heroes.has(id) || heroTick.has(id)) return fail(`hero ${id} unavailable`);
        if (!canDeploy(rt, c.x, c.y)) return fail('inside no-deploy zone');
        heroTick.set(id, c.t as number);
        break;
      }
      case 'ability': {
        if (!heroTick.has(id) || abilityUsed.has(id)) return fail(`ability for ${id} unavailable`);
        abilityUsed.add(id);
        break;
      }
      case 'siege': {
        if (!isPos(c.x) || !isPos(c.y)) return fail('bad position');
        const left = siege.get(id);
        if (!left) return fail(`no ${id} left to deploy`);
        if (!canDeploy(rt, c.x, c.y)) return fail('inside no-deploy zone');
        siege.set(id, left - 1);
        break;
      }
      case 'reinforce': {
        if (!isPos(c.x) || !isPos(c.y)) return fail('bad position');
        if (reinforceUsed || !a.reinforcements.some((r) => r.count > 0)) return fail('no reinforcements');
        if (a.siege.length) return fail('reinforcements ride in the siege unit');
        if (!canDeploy(rt, c.x, c.y)) return fail('inside no-deploy zone');
        reinforceUsed = true;
        break;
      }
      case 'end':
        if (i !== commands.length - 1) return fail('end must be the last command');
        break;
      default:
        return fail('unknown command');
    }
  }
  return { ok: true };
}

/** Runs a battle to completion. */
export function runBattle(setup: BattleSetup, commands: readonly Command[]): BattleResult {
  const rt = createRuntime(setup);
  while (!rt.state.ended) stepTick(rt, commands);
  return battleResult(rt);
}

export interface ChunkResult {
  done: boolean;
  state: SimState;
  result: BattleResult | null;
  /** Deterministic work units consumed by this chunk. */
  work: number;
}

/**
 * Runs a battle until it ends or until `workBudget` units of simulation work
 * have been spent, so verification can be split across several short Worker
 * invocations. Resuming from the returned state yields the same outcome as an
 * uninterrupted run.
 */
export function runBattleChunk(
  setup: BattleSetup,
  commands: readonly Command[],
  from: SimState | null,
  workBudget: number,
): ChunkResult {
  const rt = createRuntime(setup, from ? structuredCloneState(from) : undefined);
  const startWork = workOf(rt);
  while (!rt.state.ended && workOf(rt) - startWork < workBudget) stepTick(rt, commands);
  const work = workOf(rt) - startWork;
  return { done: rt.state.ended, state: rt.state, result: rt.state.ended ? battleResult(rt) : null, work };
}

/** Work = units updated + path tiles settled + ticks; all deterministic. */
function workOf(rt: Runtime): number {
  return rt.unitWork + rt.grid.work + rt.state.tick * 4;
}

function structuredCloneState(s: SimState): SimState {
  return JSON.parse(JSON.stringify(s)) as SimState;
}

export function battleResult(rt: Runtime): BattleResult {
  const st = rt.state;
  const deployed: Record<string, number> = {};
  const lost: Record<string, number> = {};
  const heroHealth: Record<string, number> = {};
  for (const u of st.units) {
    if (u.team !== Team.Attacker) continue;
    const id = u.key.slice(0, u.key.indexOf(':'));
    const kind = rt.stats.get(u.key)?.kind;
    if (kind === 'summon') continue;
    deployed[id] = (deployed[id] ?? 0) + 1;
    if (u.dead) lost[id] = (lost[id] ?? 0) + 1;
    if (kind === 'hero') heroHealth[id] = Math.floor((Math.max(u.hp, 0) * 100) / u.maxHp);
  }
  for (const h of rt.setup.attacker.heroes) if (!(h.id in heroHealth)) heroHealth[h.id] = h.hpPercent;
  const used = (slots: { id: string; count: number }[], left: Record<string, number>) => {
    const out: Record<string, number> = {};
    for (const s of slots) {
      const n = s.count - (left[s.id] ?? 0);
      if (n > 0) out[s.id] = n;
    }
    return out;
  };
  const a = rt.setup.attacker;
  return {
    stars: starsOf(rt),
    destructionPercent: destructionPercent(rt),
    hqDestroyed: st.hqDestroyed,
    ticks: st.tick,
    endReason: st.endReason,
    destroyedBuildings: st.destroyed,
    totalBuildings: rt.totalCounted,
    deployed,
    lost,
    spellsUsed: used(a.spells, st.remaining.spells),
    troopsUsed: used(a.troops, st.remaining.troops),
    siegeUsed: used(a.siege, st.remaining.siege),
    heroesUsed: a.heroes.filter((h) => !(st.remaining.heroes[h.id] > 0)).map((h) => h.id),
    reinforcementsUsed: a.reinforcements.some((r) => r.count > 0) && !st.remaining.reinforcements,
    heroHealth,
    hash: stateHash(st),
  };
}

/** FNV-1a over the outcome-relevant parts of the state. */
export function stateHash(st: SimState): string {
  let h = 0x811c9dc5;
  const mix = (v: number) => {
    let x = v | 0;
    for (let i = 0; i < 4; i++) {
      h ^= x & 0xff;
      h = Math.imul(h, 0x01000193);
      x >>>= 8;
    }
  };
  mix(st.tick);
  mix(st.destroyed);
  mix(st.hqDestroyed ? 1 : 0);
  mix(st.rng);
  for (const b of st.buildings) {
    mix(b.hp);
    mix(b.dead ? 1 : 0);
  }
  for (const u of st.units) {
    mix(u.hp);
    mix(u.x);
    mix(u.y);
    mix(u.dead ? 1 : 0);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
