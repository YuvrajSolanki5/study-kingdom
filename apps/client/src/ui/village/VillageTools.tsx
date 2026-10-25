import { maxCountAt, type StructureDef } from '@sk/content';
import { canAfford, countBuildings, freeBuilder, hqLevel } from '@sk/rules';
import { useEffect, useState } from 'react';
import { contentOf, useGame } from '../../state/store.ts';
import { Button, CostView, Panel } from '../common.tsx';
import { fmtDuration } from '../format.ts';

export function VillageTools() {
  const [shop, setShop] = useState(false);
  const editMode = useGame((s) => s.editMode);
  const placing = useGame((s) => s.placing);
  const setEditMode = useGame((s) => s.setEditMode);
  const setPlacing = useGame((s) => s.setPlacing);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPlacing(null);
        setShop(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setPlacing]);

  return (
    <>
      <div className="village-tools">
        {placing ? (
          <div className="tool-hint">
            {placing === 'wall' ? 'Drag across free tiles to place walls.' : 'Tap a free spot to place it.'}
            <Button tone="ghost" onClick={() => setPlacing(null)}>
              {placing === 'wall' ? 'Done' : 'Cancel'}
            </Button>
          </div>
        ) : editMode ? (
          <LayoutBar onDone={() => setEditMode(false)} />
        ) : (
          <>
            <Button tone="gold" onClick={() => setShop(true)}>
              🛠️ Build
            </Button>
            <Button onClick={() => setEditMode(true)}>✋ Edit layout</Button>
          </>
        )}
      </div>
      {shop ? (
        <ShopPanel onClose={() => setShop(false)} onPick={(id) => (setShop(false), setPlacing(id))} />
      ) : null}
    </>
  );
}

function LayoutBar({ onDone }: { onDone: () => void }) {
  const view = useGame((s) => s.view)!;
  const act = useGame((s) => s.act);
  const layouts = view.state.layouts;
  const slots = contentOf(view).economy.savedLayoutSlots;
  return (
    <div className="tool-hint layout-bar">
      <span>Drag buildings to move them.</span>
      {Array.from({ length: slots }, (_, i) => {
        const l = layouts[i];
        return (
          <span key={i} className="layout-slot">
            <Button
              tone="ghost"
              onClick={() => void act({ type: 'save_layout', slot: i, name: `Layout ${i + 1}` })}
              title="Save current layout here"
            >
              💾 {i + 1}
            </Button>
            {l ? (
              <Button
                tone="ghost"
                onClick={() => void act({ type: 'load_layout', slot: i })}
                title={`Load ${l.name}`}
              >
                ↺
              </Button>
            ) : null}
          </span>
        );
      })}
      <Button tone="primary" onClick={onDone}>
        Done
      </Button>
    </div>
  );
}

function ShopPanel({ onClose, onPick }: { onClose: () => void; onPick: (id: string) => void }) {
  const view = useGame((s) => s.view)!;
  const content = contentOf(view);
  const hq = hqLevel(view.state);
  const wallet = { gold: view.wallet.gold, essence: view.wallet.essence };
  const groups: { title: string; cats: StructureDef['category'][] }[] = [
    { title: 'Defences', cats: ['defense', 'wall', 'trap'] },
    { title: 'Economy & army', cats: ['storage', 'army', 'utility', 'core'] },
  ];
  const noBuilder = freeBuilder(view.state) < 0;
  return (
    <Panel title="Build" onClose={onClose} wide>
      {groups.map((g) => (
        <div key={g.title}>
          <h3>{g.title}</h3>
          <div className="shop-grid">
            {Object.values(content.structures)
              .filter((d) => g.cats.includes(d.category))
              .map((d) => {
                const have = countBuildings(view.state, d.id);
                const max = maxCountAt(d, hq);
                const first = d.levels[0]!;
                const locked = first.hq > hq || max === 0;
                const full = have >= max;
                const needsBuilder = first.seconds > 0;
                const affordable = canAfford(
                  { ...view, state: view.state, gold: wallet.gold, essence: wallet.essence },
                  first.cost,
                );
                const disabled = locked || full || !affordable || (needsBuilder && noBuilder);
                return (
                  <button key={d.id} className="shop-item" disabled={disabled} onClick={() => onPick(d.id)}>
                    <strong>{d.name}</strong>
                    <span className="muted small">{d.description}</span>
                    <span className="shop-meta">
                      {locked ? (
                        <span className="tag">HQ {first.hq}</span>
                      ) : (
                        <>
                          <span className="tag">
                            {have}/{max}
                          </span>
                          <CostView cost={first.cost} wallet={wallet} />
                          {first.seconds ? (
                            <span className="muted small">⏱ {fmtDuration(first.seconds)}</span>
                          ) : null}
                        </>
                      )}
                    </span>
                    {!locked && !full && needsBuilder && noBuilder ? (
                      <span className="small warn">All builders busy</span>
                    ) : null}
                  </button>
                );
              })}
          </div>
        </div>
      ))}
    </Panel>
  );
}
