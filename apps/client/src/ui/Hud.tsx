import { builderCount } from '@sk/rules';
import { contentOf, useGame, type Screen } from '../state/store.ts';
import type { ReactNode } from 'react';
import { buildingArtUrl, Icon, leagueOf, useServerNow } from './common.tsx';
import { fmtClock, fmtNumber } from './format.ts';

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
        <span className="hq-badge" title="Keep level">
          <span>{profile.hqLevel}</span>
        </span>
        <span className="hud-id">
          <span className="hud-name">{profile.displayName}</span>
          <span className="trophies" title="Trophies">
            <Icon name={leagueOf(profile.trophies)} size={22} fallback="🏆" /> {profile.trophies}
          </span>
        </span>
      </button>
      <div className="hud-res">
        <div className="res-box builders" title="Free builders / total">
          <Icon name="builder" size={30} fallback="🔨" />
          <span className="game-num">
            {total - busy}/{total}
          </span>
        </div>
        <ResBar
          kind="gold"
          value={wallet.gold}
          max={wallet.capacity.gold}
          fallback={<i className="coin" />}
        />
        <ResBar
          kind="essence"
          value={wallet.essence}
          max={wallet.capacity.essence}
          fallback={<i className="drop" />}
        />
      </div>
      <StudyChip onOpen={() => setScreen('study')} />
    </header>
  );
}

/** Clash-style resource bar: fill, outlined amount, capacity and an overlapping icon. */
function ResBar({
  kind,
  value,
  max,
  fallback,
}: {
  kind: 'gold' | 'essence';
  value: number;
  max: number;
  fallback: ReactNode;
}) {
  const name = kind === 'gold' ? 'Gold' : 'Essence';
  return (
    <div className={`res-box res-bar res-bar-${kind}`} title={`${name} ${value} / ${max}`}>
      <span className="res-max">Max: {fmtNumber(max)}</span>
      <span className="res-track">
        <span className="res-fill" style={{ width: `${Math.min(1, value / Math.max(1, max)) * 100}%` }} />
        <span className={`res res-${kind} game-num`}>{fmtNumber(value)}</span>
      </span>
      <span className="res-icon">
        <Icon name={kind} size={34} fallback={fallback} />
      </span>
    </div>
  );
}

function StudyChip({ onOpen }: { onOpen: () => void }) {
  const session = useGame((s) => s.view?.activeSession ?? null);
  const now = useServerNow();
  if (!session) {
    return (
      <button className="study-chip idle" onClick={onOpen}>
        <BookIcon /> Study
      </button>
    );
  }
  const live = session.status === 'running' ? Math.max(0, (now - session.serverLastAt) / 1000) : 0;
  return (
    <button className={`study-chip ${session.status}`} onClick={onOpen}>
      {session.status === 'paused' ? '☕ Break' : <BookIcon />} {fmtClock(session.eligibleSeconds + live)}
    </button>
  );
}

/** Original study icon (the fan kit has no book), drawn to match its chunky style. */
export function BookIcon({ size = 20 }: { size?: number }) {
  return (
    <svg className="book-icon" width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <path
        d="M3 7c4-2 9-2 13 1v19c-4-3-9-3-13-1z"
        fill="#f4e7c8"
        stroke="#2a1a0e"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M29 7c-4-2-9-2-13 1v19c4-3 9-3 13-1z"
        fill="#fff8e6"
        stroke="#2a1a0e"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M6 11c2.5-.8 5-.6 7 .6M6 15c2.5-.8 5-.6 7 .6M19 11.6c2-1.2 4.5-1.4 7-.6M19 15.6c2-1.2 4.5-1.4 7-.6"
        stroke="#b08a4a"
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M22 4v8l2-1.6 2 1.6V4z"
        fill="#d23b2c"
        stroke="#2a1a0e"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const NAV: { id: Screen; label: string; icon: string; emoji: string }[] = [
  { id: 'village', label: 'Village', icon: '', emoji: '🏰' },
  { id: 'army', label: 'Army', icon: 'swordsman', emoji: '⚔️' },
  { id: 'study', label: 'Study', icon: '', emoji: '📖' },
  { id: 'attack', label: 'Attack', icon: 'sword', emoji: '🗡️' },
  { id: 'social', label: 'Friends', icon: 'social', emoji: '🤝' },
  { id: 'clan', label: 'Clan', icon: 'clan', emoji: '🛡️' },
  { id: 'history', label: 'History', icon: 'magnifier', emoji: '📜' },
];

function NavIcon({ id, icon, emoji }: { id: Screen; icon: string; emoji: string }) {
  const hq = useGame((s) => s.view?.profile.hqLevel ?? 1);
  if (id === 'study') return <BookIcon size={34} />;
  if (id === 'village') {
    const url = buildingArtUrl('headquarters', hq);
    return url ? (
      <img className="art" src={url} width={40} height={40} alt="" aria-hidden draggable={false} />
    ) : (
      <>{emoji}</>
    );
  }
  return <Icon name={icon} size={36} fallback={emoji} />;
}

export function Nav() {
  const screen = useGame((s) => s.screen);
  const setScreen = useGame((s) => s.setScreen);
  return (
    <nav className="nav" aria-label="Main">
      {NAV.map((n) => (
        <button
          key={n.id}
          className={`nav-btn nav-${n.id} ${screen === n.id ? 'on' : ''}`}
          onClick={() => setScreen(screen === n.id && n.id !== 'village' ? 'village' : n.id)}
          aria-current={screen === n.id ? 'page' : undefined}
        >
          <span className="nav-icon" aria-hidden>
            <NavIcon id={n.id} icon={n.icon} emoji={n.emoji} />
          </span>
          <span className="nav-label">{n.label}</span>
        </button>
      ))}
    </nav>
  );
}
