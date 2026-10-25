import type { BattleSummary } from '@sk/shared';
import { useEffect, useState } from 'react';
import { battles, social, type CampaignBaseInfo } from '../../api/endpoints.ts';
import { ApiError } from '../../api/http.ts';
import { contentOf, useGame } from '../../state/store.ts';
import { friendly } from '../auth/AuthScreen.tsx';
import { Button, CostView, Panel, Stars } from '../common.tsx';

export function AttackPanel() {
  const setScreen = useGame((s) => s.setScreen);
  const view = useGame((s) => s.view)!;
  const [bases, setBases] = useState<CampaignBaseInfo[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useGame((s) => s.toast);
  const setBattle = useGame((s) => s.setBattle);
  useEffect(() => {
    void battles.campaign().then((r) => setBases(r.bases));
  }, [view.state.campaign]);
  const army = view.state.army;
  const hasArmy = Object.values(army.troops).some((n) => (n ?? 0) > 0);

  async function attack(base: CampaignBaseInfo) {
    setBusy(base.id);
    try {
      const res = await battles.start('campaign', base.id);
      setBattle({
        id: res.battle.id,
        kind: 'campaign',
        title: base.name,
        setup: res.setup,
        phase: 'scouting',
        replay: false,
        commands: [],
        localResult: null,
        summary: null,
        error: null,
      });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'battle_active') {
        toast('Settling your previous battle…');
        await useGame.getState().refresh();
      } else toast(e instanceof ApiError ? friendly(e) : 'Could not start the battle', 'bad');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Panel title="Attack" onClose={() => setScreen('village')} wide>
      <h3>Campaign</h3>
      {!hasArmy ? (
        <p className="notice">Train troops in the Army tab first — they train while you study.</p>
      ) : null}
      <div className="campaign">
        {(bases ?? []).map((b) => (
          <div key={b.id} className={`campaign-base ${b.unlocked ? '' : 'locked'}`}>
            <div className="row between">
              <strong>
                {b.order}. {b.name}
              </strong>
              <Stars n={b.stars} />
            </div>
            <span className="small muted">{b.description}</span>
            <span className="small">
              Rewards:{' '}
              {b.starRewards.map((r, i) => (
                <span key={i} className={i < b.stars ? 'claimed' : ''}>
                  {i + 1}★ <CostView cost={r} />{' '}
                </span>
              ))}
            </span>
            <Button
              tone="primary"
              disabled={!b.unlocked || !hasArmy || !!view.activeBattleId}
              busy={busy === b.id}
              onClick={() => attack(b)}
            >
              {b.unlocked ? (b.stars ? 'Attack again' : 'Attack') : 'Locked'}
            </Button>
          </div>
        ))}
      </div>
      <p className="muted small">
        Battles award stars, trophies and one-time campaign prizes. Your main income is always studying.
      </p>
      <RecentBattles />
    </Panel>
  );
}

export function RecentBattles() {
  const [list, setList] = useState<BattleSummary[] | null>(null);
  const setBattle = useGame((s) => s.setBattle);
  const view = useGame((s) => s.view)!;
  const content = contentOf(view);
  useEffect(() => {
    void battles.list().then((r) => setList(r.battles));
  }, []);
  if (!list?.length) return null;
  async function replay(b: BattleSummary) {
    const full = await battles.get(b.id, true);
    if (!full.setup) return;
    setBattle({
      id: b.id,
      kind: b.kind,
      title: `Replay · ${content.campaign.find((c) => c.id === b.targetRef)?.name ?? b.defenderName ?? 'Battle'}`,
      setup: full.setup,
      phase: 'fighting',
      replay: true,
      commands: full.commands ?? [],
      localResult: null,
      summary: full.battle,
      error: null,
    });
  }
  return (
    <>
      <h3>Recent battles</h3>
      <ul className="list">
        {list.map((b) => (
          <li key={b.id} className="row between">
            <span>
              {content.campaign.find((c) => c.id === b.targetRef)?.name ?? b.defenderName ?? b.kind}{' '}
              <span className="muted small">{new Date(b.startedAt).toLocaleString()}</span>
            </span>
            <span className="row">
              {b.result ? (
                <Stars n={b.result.stars} size={14} />
              ) : (
                <span className="muted small">{b.status}</span>
              )}
              {b.result ? <span className="small">{b.result.destructionPercent}%</span> : null}
              {b.status === 'settled' ? (
                <Button
                  tone="ghost"
                  onClick={() =>
                    void social
                      .share(b.id)
                      .then((r) => {
                        useGame.getState().toast(`Replay token: ${r.token}`);
                        return navigator.clipboard?.writeText(r.token);
                      })
                      .catch(() => useGame.getState().toast('Could not share replay', 'bad'))
                  }
                >
                  Share
                </Button>
              ) : null}
              {b.status === 'settled' ? (
                <Button tone="ghost" onClick={() => void replay(b)}>
                  ▶ Replay
                </Button>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
