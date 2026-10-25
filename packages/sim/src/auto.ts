import { getContent } from '@sk/content';
import type { BuildingInfo } from './stats.ts';
import { MT, TPS, type BattleSetup, type Command } from './types.ts';
import { canDeploy, createRuntime, type Runtime } from './world.ts';

/** Deploy points used on the chosen side: a funnel about this many tiles wide. */
const FUNNEL = 9;

type Pt = { x: number; y: number };

const dist2 = (a: Pt, b: Pt) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

/**
 * A simple attack plan for auto-battles. It picks the side of the map closest
 * to the village, sends tanks and the siege unit first, then heroes, wall
 * breakers, the main force and healers along a funnel on that side. Spells and
 * hero abilities follow behind them.
 *
 * It only produces commands a player could have issued, so the server verifies
 * an auto-battle like any other. It is deterministic for a setup, but nothing
 * depends on that: the recorded commands are what count.
 */
export function autoPlan(setup: BattleSetup): Command[] {
  const rt = createRuntime(setup);
  const content = getContent(setup.contentVersion);
  const targets = rt.infos.filter((b) => b.counts);
  if (!targets.length) return [];
  const centre = {
    x: Math.round(targets.reduce((s, b) => s + b.cx, 0) / targets.length),
    y: Math.round(targets.reduce((s, b) => s + b.cy, 0) / targets.length),
  };
  const front = frontLine(rt, centre);
  if (!front.length) return [];
  const lead = front[0]!;

  const commands: Command[] = [];
  let slot = 0;
  /** Next deploy point, cycling across the funnel from its middle outwards. */
  const nextPoint = () => front[slot++ % front.length]!;
  const deployEvery = (t0: number, ids: { id: string; count: number }[], k: 'troop', gap: number) => {
    let t = t0;
    for (const { id, count } of ids)
      for (let i = 0; i < count; i++) {
        const p = nextPoint();
        commands.push({ t: Math.floor(t), k, id, x: p.x, y: p.y });
        t += gap;
      }
    return t;
  };

  // Waves by what each troop does best.
  const a = setup.attacker;
  const wave = (test: (id: string) => boolean) => a.troops.filter((s) => s.count > 0 && test(s.id));
  const def = (id: string) => content.troops[id]!;
  const tanks = wave((id) => def(id).preference === 'defenses');
  const breakers = wave((id) => !!def(id).suicide || def(id).preference === 'walls');
  const support = wave((id) => def(id).preference === 'support' || def(id).healRadius !== undefined);
  const placed = new Set([...tanks, ...breakers, ...support].map((s) => s.id));
  const main = wave((id) => !placed.has(id));

  for (const s of a.siege)
    if (s.count > 0) commands.push({ t: 0, k: 'siege', id: s.id, x: lead.x, y: lead.y });
  let t = deployEvery(0, tanks, 'troop', 1);
  const heroAt = Math.max(15, Math.floor(t) + 5);
  a.heroes.forEach((h, i) => {
    const p = front[Math.min(i + 1, front.length - 1)]!;
    commands.push({ t: heroAt + i, k: 'hero', id: h.id, x: p.x, y: p.y });
  });
  t = deployEvery(heroAt + 10, breakers, 'troop', 2);
  if (!a.siege.length && a.reinforcements.some((r) => r.count > 0))
    commands.push({ t: Math.floor(t), k: 'reinforce', x: lead.x, y: lead.y });
  t = deployEvery(t + 10, main, 'troop', 0.5);
  deployEvery(t + 20, support, 'troop', 3);

  // Spells: on the defences nearest the attack, or just ahead of the troops.
  const ahead = (k: number) => ({
    x: Math.round(lead.x + (centre.x - lead.x) * k),
    y: Math.round(lead.y + (centre.y - lead.y) * k),
  });
  const nearestFirst = (list: BuildingInfo[]) =>
    [...list].sort(
      (p, q) => dist2(lead, { x: p.cx, y: p.cy }) - dist2(lead, { x: q.cx, y: q.cy }) || p.index - q.index,
    );
  const defences = nearestFirst(rt.infos.filter((b) => b.isDefense && !b.isTrap && !b.off));
  const walls = nearestFirst(rt.infos.filter((b) => b.isWall));
  const spellPlan: Record<string, { at: number; aim: (i: number) => Pt }> = {
    thunder: { at: 6, aim: (i) => centreOf(defences[i % Math.max(1, defences.length)]) ?? ahead(0.3) },
    leap: { at: 7, aim: (i) => centreOf(walls[i]) ?? ahead(0.25) },
    frost: { at: 8, aim: (i) => centreOf(defences[i % Math.max(1, defences.length)]) ?? ahead(0.4) },
    fury: { at: 9, aim: (i) => ahead(0.3 + 0.15 * i) },
    mending: { at: 11, aim: (i) => ahead(0.35 + 0.15 * i) },
    aegis: { at: 12, aim: (i) => ahead(0.3 + 0.15 * i) },
  };
  for (const s of a.spells) {
    const plan = spellPlan[s.id] ?? { at: 10, aim: (i: number) => ahead(0.3 + 0.15 * i) };
    for (let i = 0; i < s.count; i++) {
      const p = clampPoint(rt, plan.aim(i));
      commands.push({ t: plan.at * TPS + i * 4 * TPS, k: 'spell', id: s.id, x: p.x, y: p.y });
    }
  }
  a.heroes.forEach((h, i) => commands.push({ t: heroAt + 20 * TPS + i, k: 'ability', id: h.id }));

  const last = rt.durationTicks - 1;
  return commands
    .map((c, i) => ({ c: { ...c, t: Math.min(c.t, last) }, i }))
    .sort((p, q) => p.c.t - q.c.t || p.i - q.i)
    .map(({ c }) => c);
}

function centreOf(b: BuildingInfo | undefined): Pt | null {
  return b ? { x: b.cx, y: b.cy } : null;
}

function clampPoint(rt: Runtime, p: Pt): Pt {
  const lim = rt.n * MT - 1;
  return { x: Math.min(lim, Math.max(0, p.x)), y: Math.min(lim, Math.max(0, p.y)) };
}

/**
 * Deployable tiles hugging the no-deploy zone on the side nearest the
 * village's centre, ordered from the one closest to the centre outwards.
 */
function frontLine(rt: Runtime, centre: Pt): Pt[] {
  const n = rt.n;
  const at = (x: number, y: number): Pt => ({ x: x * MT + MT / 2, y: y * MT + MT / 2 });
  const ok = (p: Pt) => canDeploy(rt, p.x, p.y);
  const blocked = (x: number, y: number) => rt.noDeploy[y * n + x] === 1;
  // Each side scans inward from one map edge and keeps the last free tile before the zone.
  const sides: ((i: number) => Pt | null)[] = [
    (y) =>
      edge(
        n,
        (x) => blocked(x, y),
        (x) => at(x, y),
      ),
    (y) =>
      edge(
        n,
        (x) => blocked(n - 1 - x, y),
        (x) => at(n - 1 - x, y),
      ),
    (x) =>
      edge(
        n,
        (y) => blocked(x, y),
        (y) => at(x, y),
      ),
    (x) =>
      edge(
        n,
        (y) => blocked(x, n - 1 - y),
        (y) => at(x, n - 1 - y),
      ),
  ];
  let best: Pt[] = [];
  let bestScore = Infinity;
  for (const side of sides) {
    const line: Pt[] = [];
    for (let i = 0; i < n; i++) {
      const p = side(i);
      if (p && ok(p)) line.push(p);
    }
    if (!line.length) continue;
    line.sort((p, q) => dist2(p, centre) - dist2(q, centre) || p.x - q.x || p.y - q.y);
    const score = dist2(line[0]!, centre);
    if (score < bestScore) {
      bestScore = score;
      best = line.slice(0, FUNNEL);
    }
  }
  return best;
}

/** The tile just before the first blocked one along a scan, or null if the scan never meets the zone. */
function edge(n: number, isBlocked: (i: number) => boolean, toPoint: (i: number) => Pt): Pt | null {
  for (let i = 0; i < n; i++) if (isBlocked(i)) return i > 0 ? toPoint(i - 1) : null;
  return null;
}
