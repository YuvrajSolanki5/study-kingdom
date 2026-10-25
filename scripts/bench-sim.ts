// Benchmarks battle verification CPU cost in Node (same V8 engine family as
// Cloudflare Workers). Reports cold (first run in a fresh isolate) and warm
// timings plus the deterministic work units used to budget Worker chunks.
//   node scripts/bench-sim.ts [--json]
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { campaignBase, getContent } from '../packages/content/src/index.ts';
import {
  MT,
  SIM_VERSION,
  createRuntime,
  runBattle,
  runBattleChunk,
  stepTick,
  type BattleSetup,
  type Command,
  type SimState,
} from '../packages/sim/src/index.ts';

import { replayCases } from '../packages/sim/test/replays.ts';

const content = getContent();

function cpuMs(fn: () => void): number {
  const start = process.cpuUsage();
  fn();
  const d = process.cpuUsage(start);
  return (d.user + d.system) / 1000;
}

interface Scenario {
  name: string;
  setup: BattleSetup;
  commands: Command[];
}

function scenario(
  name: string,
  baseId: string,
  troops: { id: string; level: number; count: number }[],
  extra: Command[] = [],
): Scenario {
  const base = campaignBase(content, baseId);
  const setup: BattleSetup = {
    simVersion: SIM_VERSION,
    contentVersion: content.version,
    seed: 4242,
    defender: {
      hqLevel: base.hqLevel,
      buildings: base.buildings.map((b, id) => ({ id, ...b })),
      reinforcements: [],
    },
    attacker: {
      troops,
      spells: [{ id: 'thunder', level: 1, count: 1 }],
      heroes: [],
      siege: [],
      reinforcements: [],
    },
  };
  const commands: Command[] = [];
  const t = 0;
  const edges = [
    (i: number) => [8000 + i * 350, 500],
    (i: number) => [500, 8000 + i * 350],
    (i: number) => [43500, 8000 + i * 350],
    (i: number) => [8000 + i * 350, 43500],
  ];
  let k = 0;
  for (const slot of troops) {
    for (let i = 0; i < slot.count; i++) {
      const [x, y] = edges[k % 4]!(Math.floor(k / 4) % 80);
      commands.push({ t: t + Math.floor(k / 8), k: 'troop', id: slot.id, x: x!, y: y! });
      k++;
    }
  }
  commands.push(...extra);
  commands.sort((a, b) => a.t - b.t);
  return { name, setup, commands };
}

const scenarios: Scenario[] = [
  ...replayCases(SIM_VERSION).filter((s) => s.name.startsWith('hq10')),
  scenario('HQ1 campaign, 20 swordsmen', 'c01_bandit_camp', [{ id: 'swordsman', level: 1, count: 20 }]),
  scenario('HQ2 campaign, mixed 50 housing', 'c02_riverside_watch', [
    { id: 'swordsman', level: 2, count: 20 },
    { id: 'archer', level: 2, count: 20 },
    { id: 'bulwark', level: 1, count: 2 },
  ]),
  scenario(
    'HQ3 walled base, 60 housing + thunder',
    'c03_stone_ford',
    [
      { id: 'bulwark', level: 2, count: 4 },
      { id: 'swordsman', level: 3, count: 20 },
      { id: 'archer', level: 3, count: 20 },
    ],
    [{ t: 150, k: 'spell', id: 'thunder', x: 21 * MT, y: 21 * MT }],
  ),
];

const large = structuredClone(replayCases(SIM_VERSION).find((s) => s.name === 'hq10_combined_arms')!);
large.name = 'hq10_max_village';
large.setup.defender.buildings = [];
const occupied = new Set<number>();
for (const def of Object.values(content.structures).sort((a, b) => b.size - a.size)) {
  const level = def.levels[def.levels.length - 1]!.level;
  for (let n = 0; n < (def.maxCount[9] ?? 0); n++) {
    let placed = false;
    for (let y = 2; y + def.size <= 42 && !placed; y++)
      for (let x = 2; x + def.size <= 42 && !placed; x++) {
        let free = true;
        for (let dy = 0; dy < def.size; dy++)
          for (let dx = 0; dx < def.size; dx++) if (occupied.has((y + dy) * 44 + x + dx)) free = false;
        if (!free) continue;
        for (let dy = 0; dy < def.size; dy++)
          for (let dx = 0; dx < def.size; dx++) occupied.add((y + dy) * 44 + x + dx);
        large.setup.defender.buildings.push({
          id: large.setup.defender.buildings.length,
          defId: def.id,
          level,
          x,
          y,
        });
        placed = true;
      }
    if (!placed) throw new Error('Maximum village does not fit');
  }
}
scenarios.push(large);

const coldIndex = process.argv.indexOf('--cold');
if (coldIndex >= 0) {
  const s = scenarios.find((s) => s.name === process.argv[coldIndex + 1])!;
  let result;
  const ms = cpuMs(() => {
    result = runBattle(s.setup, s.commands);
  });
  console.log(JSON.stringify({ ms, result }));
  process.exit(0);
}
const json = process.argv.includes('--json');
const rows: Record<string, unknown>[] = [];
for (const s of scenarios) {
  const child = spawnSync(
    process.execPath,
    ['--experimental-strip-types', fileURLToPath(import.meta.url), '--cold', s.name],
    { encoding: 'utf8' },
  );
  if (child.status !== 0) throw new Error(child.stderr);
  const { ms: cold, result: coldResult } = JSON.parse(child.stdout) as {
    ms: number;
    result: ReturnType<typeof runBattle>;
  };
  const warmRuns: number[] = [];
  for (let i = 0; i < 20; i++) warmRuns.push(cpuMs(() => runBattle(s.setup, s.commands)));
  warmRuns.sort((a, b) => a - b);
  const rt = createRuntime(s.setup);
  while (!rt.state.ended) stepTick(rt, s.commands);
  const work = rt.unitWork + rt.grid.work + rt.state.tick * 4;
  let state: SimState | null = null,
    chunk;
  let chunks = 0,
    maxChunkMs = 0;
  do {
    const ms = cpuMs(() => {
      chunk = runBattleChunk(s.setup, s.commands, state, 2500);
    });
    maxChunkMs = Math.max(maxChunkMs, ms);
    chunks++;
    state = JSON.parse(JSON.stringify(chunk!.state)) as SimState;
    if (chunks > 2000) throw new Error('Checkpoint verification stalled');
  } while (!chunk!.done);
  rows.push({
    scenario: s.name,
    ticks: rt.state.tick,
    units: rt.state.units.length,
    stars: (coldResult as unknown as { stars: number }).stars,
    coldMs: +cold.toFixed(2),
    warmMedianMs: +warmRuns[10]!.toFixed(2),
    warmMaxMs: +warmRuns[19]!.toFixed(2),
    workUnits: work,
    usPerWorkUnit: +((warmRuns[10]! * 1000) / work).toFixed(3),
    chunks,
    warmMaxChunkMs: +maxChunkMs.toFixed(2),
    sameResultChunked: chunk!.result?.hash === (coldResult as unknown as { hash: string }).hash,
  });
}
if (json) console.log(JSON.stringify(rows, null, 2));
else console.table(rows);
