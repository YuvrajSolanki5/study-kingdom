import type { StructureLevel } from '@sk/content';
import { buildingUpgrading, canAfford, freeBuilder, hqLevel } from '@sk/rules';
import { contentOf, useGame } from '../../state/store.ts';
import { Button, CostView, Countdown, Panel, Progress, useServerNow } from '../common.tsx';
import { fmtDuration, fmtNumber } from '../format.ts';

function statLines(l: StructureLevel): [string, string][] {
  const out: [string, string][] = [['Hitpoints', fmtNumber(l.hp)]];
  if (l.storage)
    out.push(['Stores', `${fmtNumber(l.storage.gold)} Gold · ${fmtNumber(l.storage.essence)} Essence`]);
  if (l.housing) out.push(['Troop housing', String(l.housing)]);
  if (l.reinforcement) out.push(['Reinforcements', String(l.reinforcement)]);
  if (l.defense) {
    const d = l.defense;
    out.push(['Damage per second', (d.damage / d.attackSeconds).toFixed(1)]);
    out.push(['Range', `${d.minRange ? `${d.minRange}–` : ''}${d.range} tiles`]);
    out.push([
      'Targets',
      d.targets === 'both' ? 'Ground & air' : d.targets === 'air' ? 'Air only' : 'Ground only',
    ]);
    if (d.splash) out.push(['Splash', `${d.splash} tiles`]);
  }
  if (l.trap) out.push(['Damage', String(l.trap.damage)]);
  return out;
}

export function BuildingPanel() {
  const view = useGame((s) => s.view)!;
  const selected = useGame((s) => s.selected);
  const select = useGame((s) => s.select);
  const act = useGame((s) => s.act);
  const now = useServerNow();
  const content = contentOf(view);
  const b = view.state.buildings.find((x) => x.id === selected);
  if (!b) return null;
  const def = content.structures[b.defId];
  if (!def) return null;
  const job = buildingUpgrading(view.state, b.id);
  const current = def.levels[Math.max(0, b.level - 1)]!;
  const next = def.levels[b.level];
  const hq = hqLevel(view.state);
  const wallet = { gold: view.wallet.gold, essence: view.wallet.essence };
  const agg = { state: view.state, ...wallet };
  const blocked = !next
    ? 'Max level'
    : next.hq > hq
      ? `Requires Headquarters ${next.hq}`
      : !canAfford(agg, next.cost)
        ? 'Not enough resources — study to earn more'
        : next.seconds > 0 && freeBuilder(view.state) < 0
          ? 'All builders are busy'
          : null;
  const builderIndex = view.state.builders.findIndex((j) => j === job);
  return (
    <Panel
      title={`${def.name} ${b.level > 0 ? `· Level ${b.level}` : '· Under construction'}`}
      onClose={() => select(null)}
    >
      <p className="muted">{def.description}</p>
      {b.level > 0 ? (
        <dl className="stats">
          {statLines(current).map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {job ? (
        <div className="stack">
          <p>
            {job.toLevel === 1 ? 'Building' : `Upgrading to level ${job.toLevel}`} ·{' '}
            <Countdown until={job.endsAt} /> left
          </p>
          <Progress value={(now - job.startedAt) / Math.max(1, job.endsAt - job.startedAt)} />
          <Button tone="ghost" onClick={() => void act({ type: 'cancel_upgrade', builder: builderIndex })}>
            Cancel (refund {content.economy.upgradeCancelRefundPercent}%)
          </Button>
        </div>
      ) : next && b.level > 0 ? (
        <div className="stack">
          <h3>Level {next.level}</h3>
          <dl className="stats compact">
            {statLines(next).map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          <div className="row">
            <CostView cost={next.cost} wallet={wallet} />
            {next.seconds ? (
              <span className="muted">⏱ {fmtDuration(next.seconds)}</span>
            ) : (
              <span className="muted">Instant</span>
            )}
          </div>
          <Button
            tone="gold"
            disabled={!!blocked}
            onClick={() => void act({ type: 'upgrade', buildingId: b.id })}
          >
            Upgrade
          </Button>
          {blocked ? <p className="small warn">{blocked}</p> : null}
        </div>
      ) : !next ? (
        <p className="small muted">Max level for this release.</p>
      ) : null}
      {b.defId === 'wall' ? <WallBulk /> : null}
    </Panel>
  );
}

function WallBulk() {
  const view = useGame((s) => s.view)!;
  const act = useGame((s) => s.act);
  const content = contentOf(view);
  const walls = view.state.buildings.filter((b) => b.defId === 'wall');
  const minLevel = Math.min(...walls.map((w) => w.level));
  const lowest = walls.filter((w) => w.level === minLevel);
  const next = content.structures['wall']?.levels[minLevel];
  if (!next || next.hq > hqLevel(view.state)) return null;
  const affordable = Math.min(
    lowest.length,
    Math.floor(view.wallet.gold / Math.max(1, next.cost.gold ?? 1)),
    100,
  );
  if (affordable < 2) return null;
  return (
    <Button
      onClick={() =>
        void act({ type: 'upgrade_walls', buildingIds: lowest.slice(0, affordable).map((w) => w.id) })
      }
    >
      Upgrade {affordable} level-{minLevel} walls
    </Button>
  );
}
