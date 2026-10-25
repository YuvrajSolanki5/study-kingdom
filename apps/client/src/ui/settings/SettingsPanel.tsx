import { useEffect, useState } from 'react';
import { auth, game } from '../../api/endpoints.ts';
import { ApiError, storeDesktopTokens } from '../../api/http.ts';
import { desktop, type RunningApp } from '../../platform/desktop.ts';
import { APP_VERSION, IS_DESKTOP } from '../../platform/env.ts';
import { useGame } from '../../state/store.ts';
import { friendly } from '../auth/AuthScreen.tsx';
import { Button, Panel } from '../common.tsx';
import { checkForUpdates } from '../desktop/UpdatePrompt.tsx';
import { UNOFFICIAL_NOTICE } from '../format.ts';

export function SettingsPanel() {
  const view = useGame((s) => s.view)!;
  const setScreen = useGame((s) => s.setScreen);
  const setView = useGame((s) => s.setView);
  const signOut = useGame((s) => s.signOut);
  const muted = useGame((s) => s.muted);
  const setMuted = useGame((s) => s.setMuted);
  const toast = useGame((s) => s.toast);
  const username = useGame((s) => s.username);
  const settings = view.profile.settings;
  const [name, setName] = useState(view.profile.displayName);
  const [daily, setDaily] = useState(settings.dailyGoalMinutes);
  const [weekly, setWeekly] = useState(settings.weeklyGoalMinutes);
  const [subjects, setSubjects] = useState(settings.subjects.join(', '));
  const [grace, setGrace] = useState(settings.graceSeconds);
  const [busy, setBusy] = useState(false);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  async function save() {
    setBusy(true);
    try {
      if (name.trim() !== view.profile.displayName) setView(await game.profile({ displayName: name.trim() }));
      const next = await game.settings({
        dailyGoalMinutes: daily,
        weeklyGoalMinutes: weekly,
        subjects: subjects
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 20),
        graceSeconds: grace,
        timezone: tz,
      });
      setView(next);
      toast('Saved', 'good');
    } catch (e) {
      toast(e instanceof ApiError ? friendly(e) : 'Could not save', 'bad');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Settings" onClose={() => setScreen('village')} wide>
      <section className="stack">
        <h3>Profile</h3>
        <label>
          Kingdom name
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={24} />
        </label>
        <p className="muted small">
          Signed in as {username} · Friend code <code>{view.profile.friendCode}</code> · Time zone {tz}
        </p>
      </section>
      <section className="stack">
        <h3>Study goals</h3>
        <div className="row wrap">
          <label>
            Daily goal (minutes)
            <input
              type="number"
              min={0}
              max={600}
              value={daily}
              onChange={(e) => setDaily(Number(e.target.value))}
            />
          </label>
          <label>
            Weekly goal (minutes)
            <input
              type="number"
              min={0}
              max={4200}
              value={weekly}
              onChange={(e) => setWeekly(Number(e.target.value))}
            />
          </label>
        </div>
        <label>
          Subjects (comma separated)
          <input
            value={subjects}
            onChange={(e) => setSubjects(e.target.value)}
            placeholder="Maths, Biology, French"
          />
        </label>
      </section>
      {IS_DESKTOP ? <AllowList grace={grace} setGrace={setGrace} /> : null}
      <Button tone="primary" onClick={save} busy={busy}>
        Save settings
      </Button>
      <PasswordSettings />
      <section className="stack">
        <h3>App</h3>
        <label className="check">
          <input type="checkbox" checked={!muted} onChange={(e) => setMuted(!e.target.checked)} />
          Sound effects
        </label>
        <p className="muted small">
          Version {APP_VERSION} · {IS_DESKTOP ? 'Mac app' : 'Web'}
        </p>
        <p className="muted small">{UNOFFICIAL_NOTICE}</p>
        {IS_DESKTOP ? <Button onClick={() => void checkForUpdates(true)}>Check for updates</Button> : null}
        <div className="row">
          <Button onClick={() => void signOut(false)}>Sign out</Button>
          <Button tone="danger" onClick={() => void signOut(true)}>
            Sign out everywhere
          </Button>
        </div>
      </section>
    </Panel>
  );
}

function PasswordSettings() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useGame((s) => s.toast);
  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          const result = await auth.changePassword(current, next);
          if (result.tokens) await storeDesktopTokens(result.tokens);
          setCurrent('');
          setNext('');
          toast('Password changed', 'good');
        } catch (error) {
          toast(error instanceof ApiError ? friendly(error) : 'Could not change password', 'bad');
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3>Password</h3>
      <label>
        Current password
        <input
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          required
        />
      </label>
      <label>
        New password
        <input
          type="password"
          autoComplete="new-password"
          minLength={10}
          maxLength={128}
          value={next}
          onChange={(e) => setNext(e.target.value)}
          required
        />
      </label>
      <Button type="submit" busy={busy}>
        Change password
      </Button>
    </form>
  );
}

function AllowList({ grace, setGrace }: { grace: number; setGrace(n: number): void }) {
  const view = useGame((s) => s.view)!;
  const setView = useGame((s) => s.setView);
  const toast = useGame((s) => s.toast);
  const [running, setRunning] = useState<RunningApp[]>([]);
  const allowed = view.profile.settings.allowedApps;
  useEffect(() => {
    void desktop
      .runningApps()
      .then(setRunning)
      .catch(() => setRunning([]));
  }, []);
  const update = async (apps: { bundleId: string; name: string }[]) => {
    try {
      setView(await game.settings({ allowedApps: apps }));
    } catch (e) {
      toast(e instanceof ApiError ? friendly(e) : 'Could not update the list', 'bad');
    }
  };
  const candidates = running.filter((r) => !allowed.some((a) => a.bundleId === r.bundleId));
  return (
    <section className="stack">
      <h3>Study apps (computer mode)</h3>
      <p className="muted small">
        Earnings continue while one of these apps is in front. A browser on this list counts whatever site it
        shows — Study Kingdom cannot see websites.
      </p>
      <ul className="list">
        {allowed.map((a) => (
          <li key={a.bundleId} className="row between">
            <span>{a.name}</span>
            <Button
              tone="ghost"
              onClick={() => void update(allowed.filter((x) => x.bundleId !== a.bundleId))}
            >
              Remove
            </Button>
          </li>
        ))}
        {!allowed.length ? (
          <li className="muted small">No apps yet — add your notes, PDF reader or IDE.</li>
        ) : null}
      </ul>
      {candidates.length ? (
        <div className="row wrap">
          {candidates.slice(0, 24).map((r) => (
            <button key={r.bundleId} className="chip" onClick={() => void update([...allowed, r])}>
              + {r.name}
            </button>
          ))}
        </div>
      ) : null}
      <label>
        Grace period before pausing (seconds)
        <input
          type="number"
          min={15}
          max={600}
          value={grace}
          onChange={(e) => setGrace(Number(e.target.value))}
        />
      </label>
    </section>
  );
}
