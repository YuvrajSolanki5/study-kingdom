import type { SessionView, StudyHistory } from '@sk/shared';
import { useEffect, useState } from 'react';
import { study } from '../../api/endpoints.ts';
import { ApiError } from '../../api/http.ts';
import { IS_DESKTOP } from '../../platform/env.ts';
import { contentOf, useGame } from '../../state/store.ts';
import { controller, startStudy } from '../../study/controller.ts';
import { friendly } from '../auth/AuthScreen.tsx';
import { Button, Essence, Gold, Panel, Progress } from '../common.tsx';
import { fmtMinutes } from '../format.ts';

const PRESETS = [25, 50, 90];

export function StudyPanel() {
  const view = useGame((s) => s.view)!;
  const setScreen = useGame((s) => s.setScreen);
  const session = view.activeSession;
  const [history, setHistory] = useState<StudyHistory | null>(null);
  useEffect(() => {
    void study
      .history()
      .then(setHistory)
      .catch(() => undefined);
  }, [session?.status]);
  return (
    <Panel title="Study" onClose={() => setScreen('village')} wide>
      {session && !controller.owns(session) ? <ElsewhereCard session={session} /> : null}
      {session && controller.owns(session) && session.status === 'paused' ? (
        <p className="notice">You're on a break. Resume from the banner at the top when you're ready.</p>
      ) : null}
      {!session && history ? <RecallWarmup history={history} /> : null}
      {!session ? <StartForm /> : null}
      {history ? <Goals history={history} /> : null}
    </Panel>
  );
}

function ElsewhereCard({ session }: { session: SessionView }) {
  const [busy, setBusy] = useState(false);
  const toast = useGame((s) => s.toast);
  return (
    <div className="card">
      <p>
        A {session.mode} session is running on your {session.platform === 'desktop' ? 'Mac' : 'browser'}. Only
        one session can earn at a time.
      </p>
      <Button
        tone="primary"
        busy={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await startStudy({
              mode: session.mode,
              plannedMinutes: session.plannedMinutes,
              goal: session.goal,
              subjects: session.subjects,
              takeOver: true,
            });
          } catch (e) {
            toast(e instanceof ApiError ? friendly(e) : 'Could not continue here', 'bad');
          } finally {
            setBusy(false);
          }
        }}
      >
        Continue on this device
      </Button>
    </div>
  );
}

function StartForm() {
  const view = useGame((s) => s.view)!;
  const toast = useGame((s) => s.toast);
  const content = contentOf(view);
  const settings = view.profile.settings;
  const [mode, setMode] = useState<'computer' | 'paper'>('computer');
  const [minutes, setMinutes] = useState(25);
  const [custom, setCustom] = useState('');
  const [goal, setGoal] = useState('');
  const [subjects, setSubjects] = useState<string[]>([]);
  const [newSubject, setNewSubject] = useState('');
  const [busy, setBusy] = useState(false);
  const tier = content.hqTiers[view.profile.hqLevel - 1]!;
  const planned = custom ? Math.max(5, Math.min(240, Number(custom) || 25)) : minutes;
  const estGold = Math.floor(tier.studyGoldPerMinute * planned * 1.1);
  const estEssence = Math.floor(tier.studyEssencePerMinute * planned * 1.1);
  const roomGold = view.wallet.capacity.gold - view.wallet.gold;
  const knownSubjects = [...new Set([...settings.subjects, ...subjects])];

  async function begin() {
    setBusy(true);
    try {
      await startStudy({ mode, plannedMinutes: planned, goal: goal.trim(), subjects });
    } catch (e) {
      toast(e instanceof ApiError ? friendly(e) : 'Could not start the session', 'bad');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="mode-pick" role="radiogroup" aria-label="Study mode">
        <button
          role="radio"
          aria-checked={mode === 'computer'}
          className={mode === 'computer' ? 'on' : ''}
          onClick={() => setMode('computer')}
        >
          <strong>💻 Computer</strong>
          <span className="small">
            {IS_DESKTOP
              ? 'Earn while your study apps are in front. A short grace period covers quick switches.'
              : 'Switch tabs to your materials freely. A gentle check-in appears now and then.'}
          </span>
        </button>
        <button
          role="radio"
          aria-checked={mode === 'paper'}
          className={mode === 'paper' ? 'on' : ''}
          onClick={() => setMode('paper')}
        >
          <strong>📚 Paper & books</strong>
          <span className="small">
            Elapsed time with a goal and an optional recap. No keyboard or mouse needed.
          </span>
        </button>
      </div>
      <div>
        <h3>How long?</h3>
        <div className="row wrap">
          {PRESETS.map((m) => (
            <button
              key={m}
              className={`chip ${!custom && minutes === m ? 'on' : ''}`}
              onClick={() => (setMinutes(m), setCustom(''))}
            >
              {m} min
            </button>
          ))}
          <input
            className="chip-input"
            inputMode="numeric"
            placeholder="Custom"
            value={custom}
            onChange={(e) => setCustom(e.target.value.replace(/\D/g, '').slice(0, 3))}
            aria-label="Custom minutes"
          />
        </div>
      </div>
      <label>
        Goal for this session
        <input
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          maxLength={200}
          placeholder="e.g. Finish chapter 4 practice questions"
        />
      </label>
      <div>
        <h3>Subjects</h3>
        <div className="row wrap">
          {knownSubjects.map((s) => (
            <button
              key={s}
              className={`chip ${subjects.includes(s) ? 'on' : ''}`}
              onClick={() =>
                setSubjects(
                  subjects.includes(s) ? subjects.filter((x) => x !== s) : [...subjects, s].slice(0, 5),
                )
              }
            >
              {s}
            </button>
          ))}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const s = newSubject.trim().slice(0, 32);
              if (s && !subjects.includes(s)) setSubjects([...subjects, s].slice(0, 5));
              setNewSubject('');
            }}
          >
            <input
              className="chip-input"
              value={newSubject}
              onChange={(e) => setNewSubject(e.target.value)}
              placeholder="+ subject"
              aria-label="Add subject"
            />
          </form>
        </div>
      </div>
      <div className="estimate">
        <span>
          A full {planned}-minute session earns about <Gold n={estGold} /> and <Essence n={estEssence} />.
        </span>
        {roomGold < estGold ? (
          <span className="warn small">
            Your Gilded Vault only has room for {roomGold} more Gold — spend some or upgrade storage so
            nothing is wasted.
          </span>
        ) : null}
      </div>
      <Button tone="primary" className="big" onClick={begin} busy={busy}>
        Start studying
      </Button>
      <p className="muted small">
        Study Kingdom counts time, not learning. Paper mode trusts you; computer mode only sees which app is
        in front, never which website.
      </p>
    </div>
  );
}

/** Optional retrieval practice: questions you wrote at the end of earlier sessions. */
function RecallWarmup({ history }: { history: StudyHistory }) {
  const cards = history.sessions
    .flatMap((s) => (s.recall as { cards?: { q: string; a: string }[] } | null)?.cards ?? [])
    .slice(0, 12);
  const [picked] = useState(() => [...cards].sort(() => Math.random() - 0.5).slice(0, 3));
  const [shown, setShown] = useState<Set<number>>(new Set());
  if (!picked.length) return null;
  return (
    <details className="card warmup">
      <summary>
        <strong>Warm-up:</strong> {picked.length} recall question{picked.length > 1 ? 's' : ''} from earlier
        sessions
      </summary>
      <ul className="list">
        {picked.map((c, i) => (
          <li key={i}>
            <p>{c.q}</p>
            {shown.has(i) ? (
              <p className="good">{c.a}</p>
            ) : (
              <button className="link" onClick={() => setShown(new Set([...shown, i]))}>
                Show answer
              </button>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}

function Goals({ history }: { history: StudyHistory }) {
  const today = history.today;
  const week = history.week;
  return (
    <div className="goals">
      <div>
        <h3>Today</h3>
        <p>
          {fmtMinutes(today.seconds)} of {today.goalMinutes} min goal
        </p>
        <Progress value={today.seconds / 60 / Math.max(1, today.goalMinutes)} tone="blue" />
        <p className="muted small">
          Competitive minutes today: {Math.floor(today.competitiveSeconds / 60)} / 120
        </p>
      </div>
      <div>
        <h3>This week</h3>
        <p>
          {fmtMinutes(week.seconds)} of {week.goalMinutes} min goal
        </p>
        <Progress value={week.seconds / 60 / Math.max(1, week.goalMinutes)} tone="blue" />
      </div>
    </div>
  );
}
