import type { SpellDef, TroopDef } from '@sk/content';
import {
  buildingLevelMax,
  campCapacity,
  housingOf,
  spellCapacity,
  spellHousing,
  spellLevel,
  troopLevel,
  unlockedSpells,
  unlockedTroops,
  type ArmyKind,
  type QueueItem,
} from '@sk/rules';
import { contentOf, useGame } from '../../state/store.ts';
import { Button, CostView, Countdown, Icon, Panel, Progress } from '../common.tsx';
import { fmtDuration } from '../format.ts';

export function ArmyPanel() {
  const view = useGame((s) => s.view)!;
  const setScreen = useGame((s) => s.setScreen);
  const content = contentOf(view);
  const s = view.state;
  const cap = campCapacity(content, s);
  const queuedTroops: Record<string, number> = {};
  for (const q of s.training.troops) queuedTroops[q.id] = (queuedTroops[q.id] ?? 0) + 1;
  const used = housingOf(content, s.army.troops);
  const queuedHousing = housingOf(content, queuedTroops);
  const spellCap = spellCapacity(content, s);
  const queuedSpells: Record<string, number> = {};
  for (const q of s.training.spells) queuedSpells[q.id] = (queuedSpells[q.id] ?? 0) + 1;
  const spellsUsed = spellHousing(content, s.army.spells) + spellHousing(content, queuedSpells);
  const unlocked = new Set<string>(unlockedTroops(content, s));
  const spells = new Set<string>(unlockedSpells(content, s));
  return (
    <Panel title="Army" onClose={() => setScreen('village')} wide>
      <section>
        <div className="row between">
          <h3>Troops</h3>
          <span className="muted">
            {used} ready{queuedHousing ? ` + ${queuedHousing} training` : ''} / {cap} housing
          </span>
        </div>
        <Progress value={(used + queuedHousing) / Math.max(1, cap)} />
        <div className="unit-grid">
          {Object.values(content.troops)
            .filter((t) => t.barracksLevel > 0)
            .map((t) => (
              <TroopCard
                key={t.id}
                def={t}
                level={troopLevel(s, t.id)}
                ready={(s.army.troops as Record<string, number>)[t.id] ?? 0}
                locked={!unlocked.has(t.id)}
                room={cap - used - queuedHousing}
              />
            ))}
        </div>
        <Queue kind="troops" items={s.training.troops} />
      </section>
      {spellCap > 0 || Object.keys(content.spells).length ? (
        <section>
          <div className="row between">
            <h3>Spells</h3>
            <span className="muted">
              {spellsUsed} / {spellCap} capacity
            </span>
          </div>
          <div className="unit-grid">
            {Object.values(content.spells).map((sp) => (
              <SpellCard
                key={sp.id}
                def={sp}
                level={spellLevel(s, sp.id)}
                ready={(s.army.spells as Record<string, number>)[sp.id] ?? 0}
                locked={!spells.has(sp.id)}
                room={spellCap - spellsUsed}
              />
            ))}
          </div>
          <Queue kind="spells" items={s.training.spells} />
        </section>
      ) : null}
      <Research />
    </Panel>
  );
}

function TroopCard({
  def,
  level,
  ready,
  locked,
  room,
}: {
  def: TroopDef;
  level: number;
  ready: number;
  locked: boolean;
  room: number;
}) {
  const act = useGame((s) => s.act);
  const lvl = def.levels[level - 1]!;
  return (
    <div className={`unit-card ${locked ? 'locked' : ''}`}>
      <div className="row between">
        <Icon name={def.id} size={44} className="unit-art" />
        <strong className="grow">{def.name}</strong>
        <span className="tag">Lv {level}</span>
      </div>
      <span className="muted small">{def.role}</span>
      <span className="small">
        ❤ {lvl.hp} · ⚔ {(lvl.damage / def.attackSeconds).toFixed(0)}/s · 🏠 {def.housing}
      </span>
      {locked ? (
        <span className="small warn">Muster Hall level {def.barracksLevel}</span>
      ) : (
        <>
          <span className="small">
            Ready: {ready} · ⏱ {fmtDuration(def.trainSeconds)} each
          </span>
          <div className="row">
            <Button
              disabled={room < def.housing}
              onClick={() => void act({ type: 'train', kind: 'troops', id: def.id, count: 1 })}
            >
              +1
            </Button>
            <Button
              disabled={room < def.housing * 5}
              onClick={() => void act({ type: 'train', kind: 'troops', id: def.id, count: 5 })}
            >
              +5
            </Button>
            <Button
              tone="ghost"
              disabled={room < def.housing}
              onClick={() =>
                void act({ type: 'train', kind: 'troops', id: def.id, count: Math.floor(room / def.housing) })
              }
            >
              Fill
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function SpellCard({
  def,
  level,
  ready,
  locked,
  room,
}: {
  def: SpellDef;
  level: number;
  ready: number;
  locked: boolean;
  room: number;
}) {
  const act = useGame((s) => s.act);
  return (
    <div className={`unit-card ${locked ? 'locked' : ''}`}>
      <div className="row between">
        <Icon name={def.id} size={44} className="unit-art" />
        <strong className="grow">{def.name}</strong>
        <span className="tag">Lv {level}</span>
      </div>
      <span className="muted small">{def.description}</span>
      {locked ? (
        <span className="small warn">Lorehouse {def.libraryLevel}</span>
      ) : (
        <>
          <span className="small">
            Ready: {ready} · ⏱ {fmtDuration(def.brewSeconds)}
          </span>
          <Button
            disabled={room < def.housing}
            onClick={() => void act({ type: 'train', kind: 'spells', id: def.id, count: 1 })}
          >
            Prepare
          </Button>
        </>
      )}
    </div>
  );
}

function Queue({ kind, items }: { kind: ArmyKind; items: QueueItem[] }) {
  const act = useGame((s) => s.act);
  const view = useGame((s) => s.view)!;
  const content = contentOf(view);
  if (!items.length) return null;
  const name = (id: string) =>
    content.troops[id]?.name ?? content.spells[id]?.name ?? content.siege[id]?.name ?? id;
  const groups: { id: string; count: number; first: number }[] = [];
  items.forEach((q, i) => {
    const last = groups[groups.length - 1];
    if (last && last.id === q.id) last.count++;
    else groups.push({ id: q.id, count: 1, first: i });
  });
  return (
    <div className="queue">
      <span className="muted small">
        Training · all done in <Countdown until={items[items.length - 1]!.endsAt} />
      </span>
      <div className="row wrap">
        {groups.map((g) => (
          <button
            key={`${g.id}-${g.first}`}
            className="chip"
            title="Remove one"
            onClick={() => void act({ type: 'cancel_training', kind, index: g.first + g.count - 1 })}
          >
            {g.count}× {name(g.id)} ✕
          </button>
        ))}
      </div>
    </div>
  );
}

function Research() {
  const view = useGame((s) => s.view)!;
  const act = useGame((s) => s.act);
  const content = contentOf(view);
  const s = view.state;
  const library = buildingLevelMax(s, 'research_library');
  const wallet = { gold: view.wallet.gold, essence: view.wallet.essence };
  const troops = new Set<string>(unlockedTroops(content, s));
  const spells = new Set<string>(unlockedSpells(content, s));
  if (!content.structures['research_library']) return null;
  if (library < 1)
    return (
      <section>
        <h3>Research</h3>
        <p className="muted">
          Build a Research Library to make your troops and spells stronger with Essence.
        </p>
      </section>
    );
  const items = [
    ...Object.values(content.troops)
      .filter((t) => t.barracksLevel > 0 && troops.has(t.id))
      .map((t) => ({
        kind: 'troop' as const,
        id: t.id,
        name: t.name,
        levels: t.levels,
        level: troopLevel(s, t.id),
      })),
    ...Object.values(content.spells)
      .filter((sp) => spells.has(sp.id))
      .map((sp) => ({
        kind: 'spell' as const,
        id: sp.id,
        name: sp.name,
        levels: sp.levels,
        level: spellLevel(s, sp.id),
      })),
  ];
  return (
    <section>
      <div className="row between">
        <h3>Research</h3>
        <span className="muted">Library level {library}</span>
      </div>
      {s.research ? (
        <p className="notice">
          Researching {content.troops[s.research.id]?.name ?? content.spells[s.research.id]?.name} level{' '}
          {s.research.toLevel} · <Countdown until={s.research.endsAt} /> left{' '}
          <button className="link" onClick={() => void act({ type: 'cancel_research' })}>
            cancel
          </button>
        </p>
      ) : null}
      <div className="unit-grid">
        {items.map((it) => {
          const next = it.levels[it.level];
          const blocked = !next
            ? 'Max level'
            : next.libraryLevel > library
              ? `Needs Library ${next.libraryLevel}`
              : null;
          return (
            <div key={`${it.kind}:${it.id}`} className="unit-card">
              <div className="row between">
                <Icon name={it.id} size={44} className="unit-art" />
                <strong className="grow">{it.name}</strong>
                <span className="tag">Lv {it.level}</span>
              </div>
              {next ? (
                <>
                  <span className="small">
                    → Lv {next.level} · <CostView cost={next.researchCost} wallet={wallet} /> · ⏱{' '}
                    {fmtDuration(next.researchSeconds)}
                  </span>
                  <Button
                    tone="gold"
                    disabled={!!blocked || !!s.research || (next.researchCost.essence ?? 0) > wallet.essence}
                    onClick={() => void act({ type: 'research', kind: it.kind, id: it.id })}
                  >
                    Research
                  </Button>
                </>
              ) : null}
              {blocked ? <span className="small muted">{blocked}</span> : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
