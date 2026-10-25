import { builderCount } from '@sk/rules';
import { contentOf, useGame, type Screen } from '../state/store.ts';
import { Essence, Gold, Progress, useServerNow } from './common.tsx';
import { fmtClock } from './format.ts';

export function Hud() {
  const view = useGame((s) => s.view)!;
  const setScreen = useGame((s) => s.setScreen);
  const content = contentOf(view);
  const { wallet, profile, state } = view;
  const busy = state.builders.filter(Boolean).length;
  const total = builderCount(content, state);
  return (
    <header className="hud">
      <button className="hud-profile" onClick={() => setScreen('settings')} aria-label="Profile and settings">
        <span className="hq-badge" title="Headquarters level">
          {profile.hqLevel}
        </span>
        <span className="hud-name">{profile.displayName}</span>
        <span className="trophies" title="Trophies">
          🏆 {profile.trophies}
        </span>
      </button>
      <div className="hud-res">
        <div className="res-box" title={`Gold ${wallet.gold} / ${wallet.capacity.gold}`}>
          <Gold n={wallet.gold} />
          <Progress value={wallet.gold / Math.max(1, wallet.capacity.gold)} tone="gold" />
        </div>
        <div className="res-box" title={`Essence ${wallet.essence} / ${wallet.capacity.essence}`}>
          <Essence n={wallet.essence} />
          <Progress value={wallet.essence / Math.max(1, wallet.capacity.essence)} tone="purple" />
        </div>
        <div className="res-box builders" title="Builders busy / total">
          <span aria-hidden>🔨</span> {total - busy}/{total}
        </div>
      </div>
      <StudyChip onOpen={() => setScreen('study')} />
    </header>
  );
}

function StudyChip({ onOpen }: { onOpen: () => void }) {
  const session = useGame((s) => s.view?.activeSession ?? null);
  const now = useServerNow();
  if (!session) {
    return (
      <button className="study-chip idle" onClick={onOpen}>
        📖 Study
      </button>
    );
  }
  const live = session.status === 'running' ? Math.max(0, (now - session.serverLastAt) / 1000) : 0;
  return (
    <button className={`study-chip ${session.status}`} onClick={onOpen}>
      {session.status === 'paused' ? '☕ Break' : '📖'} {fmtClock(session.eligibleSeconds + live)}
    </button>
  );
}

const NAV: { id: Screen; label: string; icon: string }[] = [
  { id: 'village', label: 'Village', icon: '🏰' },
  { id: 'army', label: 'Army', icon: '⚔️' },
  { id: 'study', label: 'Study', icon: '📖' },
  { id: 'attack', label: 'Attack', icon: '🗡️' },
  { id: 'social', label: 'Friends', icon: '🤝' },
  { id: 'clan', label: 'Clan', icon: '🛡️' },
  { id: 'history', label: 'History', icon: '📜' },
];

export function Nav() {
  const screen = useGame((s) => s.screen);
  const setScreen = useGame((s) => s.setScreen);
  return (
    <nav className="nav" aria-label="Main">
      {NAV.map((n) => (
        <button
          key={n.id}
          className={`nav-btn ${screen === n.id ? 'on' : ''} ${n.id === 'study' ? 'nav-study' : ''}`}
          onClick={() => setScreen(screen === n.id && n.id !== 'village' ? 'village' : n.id)}
          aria-current={screen === n.id ? 'page' : undefined}
        >
          <span className="nav-icon" aria-hidden>
            {n.icon}
          </span>
          <span>{n.label}</span>
        </button>
      ))}
    </nav>
  );
}
