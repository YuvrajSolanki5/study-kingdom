import type { SessionView, StudyHistory } from '@sk/shared';
import { useEffect, useState } from 'react';
import { study } from '../../api/endpoints.ts';
import { ApiError } from '../../api/http.ts';
import { useGame } from '../../state/store.ts';
import { friendly } from '../auth/AuthScreen.tsx';
import { RecentBattles } from '../battle/AttackPanel.tsx';
import { Button, Essence, Gold, Panel } from '../common.tsx';
import { fmtMinutes } from '../format.ts';

export function HistoryPanel() {
  const setScreen = useGame((s) => s.setScreen);
  const [history, setHistory] = useState<StudyHistory | null>(null);
  const [tab, setTab] = useState<'study' | 'battles'>('study');
  const load = () =>
    void study
      .history()
      .then(setHistory)
      .catch(() => undefined);
  useEffect(load, []);
  return (
    <Panel title="History" onClose={() => setScreen('village')} wide>
      <div className="tabs" role="tablist">
        <button
          role="tab"
          aria-selected={tab === 'study'}
          className={tab === 'study' ? 'on' : ''}
          onClick={() => setTab('study')}
        >
          Study
        </button>
        <button
          role="tab"
          aria-selected={tab === 'battles'}
          className={tab === 'battles' ? 'on' : ''}
          onClick={() => setTab('battles')}
        >
          Battles
        </button>
      </div>
      {tab === 'battles' ? (
        <RecentBattles />
      ) : history ? (
        <StudyHistoryView history={history} onChange={load} />
      ) : (
        <p className="muted">Loading…</p>
      )}
    </Panel>
  );
}

function StudyHistoryView({ history, onChange }: { history: StudyHistory; onChange(): void }) {
  const max = Math.max(60, ...history.days.map((d) => d.seconds));
  const days = [...history.days].reverse().slice(-14);
  return (
    <div className="stack">
      <div className="chart" role="img" aria-label="Minutes studied per day">
        {days.map((d) => (
          <div key={d.date} className="chart-col" title={`${d.date}: ${fmtMinutes(d.seconds)}`}>
            <div className="chart-bar" style={{ height: `${(d.seconds / max) * 100}%` }} />
            <span className="chart-label">{d.date.slice(8)}</span>
          </div>
        ))}
        {!days.length ? <p className="muted">Your study days will appear here.</p> : null}
      </div>
      {history.subjects.length ? (
        <div className="row wrap">
          {history.subjects.map((s) => (
            <span key={s.subject} className="chip">
              {s.subject} · {fmtMinutes(s.seconds)}
            </span>
          ))}
        </div>
      ) : null}
      <ul className="list">
        {history.sessions.map((s) => (
          <SessionRow key={s.id} s={s} onChange={onChange} />
        ))}
      </ul>
    </div>
  );
}

function SessionRow({ s, onChange }: { s: SessionView; onChange(): void }) {
  const [busy, setBusy] = useState(false);
  const toast = useGame((st) => st.toast);
  const setView = useGame((st) => st.setView);
  const canReview = s.reviewDeadline && s.reviewDeadline > Date.now() && s.unreviewedSeconds >= 60;
  const recall = s.recall as { summary?: string; cards?: { q: string; a: string }[] } | null;
  return (
    <li className="session-row">
      <div className="row between">
        <span>
          <strong>{s.goal || (s.mode === 'paper' ? 'Paper study' : 'Computer study')}</strong>{' '}
          <span className="muted small">
            {s.startedAt ? new Date(s.startedAt).toLocaleString() : ''} · {s.subjects.join(', ')}
          </span>
        </span>
        <span className="row">
          <span>{fmtMinutes(s.eligibleSeconds + s.reviewedSeconds)}</span>
          {s.reward ? (
            <>
              <Gold n={s.reward.gold} /> <Essence n={s.reward.essence} />
            </>
          ) : (
            <span className="tag">{s.status}</span>
          )}
        </span>
      </div>
      {s.endReason === 'connection_lost' ? (
        <p className="muted small">Ended automatically after the connection was lost.</p>
      ) : null}
      {recall?.summary ? <p className="small recap">“{recall.summary}”</p> : null}
      {recall?.cards?.length ? (
        <details className="small">
          <summary>Recall questions ({recall.cards.length})</summary>
          <ul>
            {recall.cards.map((c, i) => (
              <li key={i}>
                <details>
                  <summary>{c.q}</summary>
                  {c.a}
                </details>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {canReview ? (
        <div className="row">
          <span className="small">
            {fmtMinutes(s.unreviewedSeconds)} disconnected time can still be reviewed.
          </span>
          <Button
            tone="ghost"
            busy={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const res = await study.review(s.id, s.unreviewedSeconds);
                setView(res.view);
                toast('Reviewed time credited (not counted in leagues).', 'good');
                onChange();
              } catch (e) {
                toast(e instanceof ApiError ? friendly(e) : 'Could not review', 'bad');
              } finally {
                setBusy(false);
              }
            }}
          >
            I was studying
          </Button>
        </div>
      ) : null}
    </li>
  );
}
