import type { SessionView } from '@sk/shared';
import { useState } from 'react';
import { ApiError } from '../../api/http.ts';
import { useGame } from '../../state/store.ts';
import { controller, finishStudy, setBreak, useStudyUi } from '../../study/controller.ts';
import { friendly } from '../auth/AuthScreen.tsx';
import { Button, Essence, Gold, Modal, useServerNow } from '../common.tsx';
import { fmtClock, fmtDuration, fmtMinutes } from '../format.ts';

/** While a session is running, the kingdom waits: focus first, play on breaks. */
export function FocusOverlay() {
  const session = useGame((s) => s.view?.activeSession ?? null);
  const [wrapUp, setWrapUp] = useState<null | { early: boolean }>(null);
  const [result, setResult] = useState<SessionView | null>(null);
  if (result) return <ResultModal session={result} onClose={() => setResult(null)} />;
  if (!session || session.status !== 'running') return null;
  if (!controller.owns(session)) return <ElsewhereOverlay session={session} />;
  return (
    <div className="focus" role="region" aria-label="Focus session">
      <FocusCard session={session} onFinish={(early) => setWrapUp({ early })} />
      {wrapUp ? (
        <WrapUp
          session={session}
          early={wrapUp.early}
          onCancel={() => setWrapUp(null)}
          onDone={(s) => {
            setWrapUp(null);
            setResult(s);
          }}
        />
      ) : null}
    </div>
  );
}

function FocusCard({ session, onFinish }: { session: SessionView; onFinish(early: boolean): void }) {
  const now = useServerNow(500);
  const ui = useStudyUi();
  const held = useGame((s) => s.held.length);
  const [busy, setBusy] = useState(false);
  const toast = useGame((s) => s.toast);
  const elapsed = session.eligibleSeconds + Math.max(0, (now - session.serverLastAt) / 1000);
  const planned = session.plannedMinutes * 60;
  const remaining = planned - elapsed;
  const focus = ui.focus;
  return (
    <div className="focus-card">
      <p className="focus-mode">{session.mode === 'paper' ? '📚 Paper & books' : '💻 Computer'} session</p>
      <div className={`focus-ring ${focus.state}`}>
        <svg viewBox="0 0 120 120" aria-hidden>
          <circle cx="60" cy="60" r="54" className="track" />
          <circle
            cx="60"
            cy="60"
            r="54"
            className="fill"
            style={{ strokeDashoffset: 339.3 * (1 - Math.min(1, elapsed / planned)) }}
          />
        </svg>
        <div className="focus-time">
          <strong>{remaining > 0 ? fmtClock(remaining) : `+${fmtClock(-remaining)}`}</strong>
          <span className="muted small">{remaining > 0 ? 'remaining' : 'past your plan'}</span>
        </div>
      </div>
      {session.goal ? <p className="focus-goal">🎯 {session.goal}</p> : null}
      <p className={`focus-status ${focus.state}`}>
        {focus.state === 'focused'
          ? 'Earning — stay with it'
          : focus.state === 'grace'
            ? `${focus.detail} · pausing in ${fmtDuration(focus.graceLeftMs / 1000)}`
            : focus.detail}
      </p>
      {focus.state === 'checkin' || focus.state === 'unconfirmed' ? (
        <Button tone="primary" onClick={() => controller.confirmCheckIn()}>
          ✋ Still studying
        </Button>
      ) : null}
      {ui.offline ? <p className="warn small">Offline — time will be checked when you reconnect.</p> : null}
      {session.unreviewedSeconds > 0 ? (
        <p className="muted small">
          {fmtMinutes(session.unreviewedSeconds)} disconnected — you can review it when you finish.
        </p>
      ) : null}
      {held ? (
        <p className="muted small">
          {held} kingdom update{held > 1 ? 's' : ''} waiting for your break.
        </p>
      ) : null}
      <div className="row center">
        <Button
          busy={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await setBreak(true);
            } catch (e) {
              toast(e instanceof ApiError ? friendly(e) : 'Could not start a break', 'bad');
            } finally {
              setBusy(false);
            }
          }}
        >
          ☕ Take a break
        </Button>
        <Button tone="primary" onClick={() => onFinish(remaining > 60)}>
          {remaining > 60 ? 'Finish early' : '✅ Finish session'}
        </Button>
      </div>
      {ui.plannedReached ? (
        <p className="good">You reached your planned time. Finish now or keep going.</p>
      ) : null}
    </div>
  );
}

function ElsewhereOverlay({ session }: { session: SessionView }) {
  const setScreen = useGame((s) => s.setScreen);
  return (
    <div className="focus">
      <div className="focus-card">
        <p className="focus-mode">
          Studying on your {session.platform === 'desktop' ? 'Mac' : 'other browser'}
        </p>
        <p>Your kingdom waits while you focus. Take a break there to play, or continue the session here.</p>
        <Button tone="primary" onClick={() => setScreen('study')}>
          Continue here
        </Button>
      </div>
    </div>
  );
}

export function BreakBanner() {
  const session = useGame((s) => s.view?.activeSession ?? null);
  const now = useServerNow();
  const [busy, setBusy] = useState(false);
  if (!session || session.status !== 'paused' || !controller.owns(session)) return null;
  const breakFor = Math.max(0, (now - session.serverLastAt) / 1000);
  return (
    <div className="break-banner" role="status">
      <span>
        ☕ Break · {fmtClock(breakFor)} · {fmtMinutes(session.eligibleSeconds)} studied so far
      </span>
      <Button
        tone="primary"
        busy={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await setBreak(false);
          } finally {
            setBusy(false);
          }
        }}
      >
        Back to studying
      </Button>
    </div>
  );
}

function WrapUp({
  session,
  early,
  onCancel,
  onDone,
}: {
  session: SessionView;
  early: boolean;
  onCancel(): void;
  onDone(s: SessionView): void;
}) {
  const [summary, setSummary] = useState('');
  const [cards, setCards] = useState<{ q: string; a: string }[]>([]);
  const [confidence, setConfidence] = useState<number | undefined>();
  const [claim, setClaim] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reviewable = session.unreviewedSeconds;
  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const recall =
        summary.trim() || cards.length
          ? {
              summary: summary.trim(),
              cards: cards.filter((c) => c.q.trim() && c.a.trim()),
              ...(confidence ? { confidence } : {}),
            }
          : undefined;
      const s = await finishStudy({
        ...(recall ? { recall } : {}),
        reviewSeconds: claim ? reviewable : 0,
        early,
      });
      onDone(s);
    } catch (e) {
      setError(
        e instanceof ApiError ? friendly(e) : 'Could not finish — check your connection and try again.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal label="Finish session" onClose={onCancel}>
      <h2>{early ? 'Finish early?' : 'Session complete'}</h2>
      <p className="muted">
        {early
          ? 'You keep credit for the time you studied; the completion bonus needs the planned time.'
          : 'A short recap earns a 10% bonus and helps it stick.'}
      </p>
      <label>
        What did you learn? (optional)
        <textarea
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          rows={4}
          maxLength={2000}
          placeholder="Key points in your own words…"
        />
      </label>
      <div className="stack">
        {cards.map((c, i) => (
          <div key={i} className="row">
            <input
              value={c.q}
              onChange={(e) => setCards(cards.map((x, j) => (j === i ? { ...x, q: e.target.value } : x)))}
              placeholder="Question"
              maxLength={300}
            />
            <input
              value={c.a}
              onChange={(e) => setCards(cards.map((x, j) => (j === i ? { ...x, a: e.target.value } : x)))}
              placeholder="Answer"
              maxLength={500}
            />
          </div>
        ))}
        {cards.length < 5 ? (
          <button className="link" onClick={() => setCards([...cards, { q: '', a: '' }])}>
            + Add a recall question for next time
          </button>
        ) : null}
      </div>
      <div className="row">
        <span className="small">How confident do you feel?</span>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} className={`chip ${confidence === n ? 'on' : ''}`} onClick={() => setConfidence(n)}>
            {n}
          </button>
        ))}
      </div>
      {reviewable > 0 ? (
        <label className="check card">
          <input type="checkbox" checked={claim} onChange={(e) => setClaim(e.target.checked)} />
          <span>
            We lost contact for {fmtMinutes(reviewable)} (sleep, lock or offline). I was studying during that
            time.
            <span className="muted small">
              {' '}
              Reviewed time earns resources but never counts in leagues or clan scores.
            </span>
          </span>
        </label>
      ) : null}
      {error ? <p className="error">{error}</p> : null}
      <div className="row end">
        <Button tone="ghost" onClick={onCancel}>
          Keep studying
        </Button>
        <Button tone="primary" onClick={submit} busy={busy}>
          Collect rewards
        </Button>
      </div>
    </Modal>
  );
}

function ResultModal({ session, onClose }: { session: SessionView; onClose(): void }) {
  const setScreen = useGame((s) => s.setScreen);
  const r = session.reward;
  return (
    <Modal label="Session results" onClose={onClose}>
      <h2>Well studied!</h2>
      <p>
        {fmtMinutes(session.eligibleSeconds + session.reviewedSeconds)} credited
        {r?.bonusPercent ? ` · +${r.bonusPercent}% bonus` : ''}
      </p>
      {r ? (
        <p className="big-reward">
          <Gold n={r.gold} /> <Essence n={r.essence} />
        </p>
      ) : null}
      {r && (r.overflowGold > 0 || r.overflowEssence > 0) ? (
        <p className="warn small">
          Storage was full: {r.overflowGold} Gold and {r.overflowEssence} Essence did not fit. Upgrade your
          Treasury to keep more.
        </p>
      ) : null}
      {session.distractedSeconds > 0 ? (
        <p className="muted small">
          {fmtMinutes(session.distractedSeconds)} away from study apps was not counted.
        </p>
      ) : null}
      <div className="row end">
        <Button
          tone="gold"
          onClick={() => {
            onClose();
            setScreen('village');
          }}
        >
          Spend it in my kingdom
        </Button>
      </div>
    </Modal>
  );
}
