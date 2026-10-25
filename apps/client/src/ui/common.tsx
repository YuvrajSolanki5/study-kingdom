import type { Cost } from '@sk/content';
import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import sprites from '../game/sprite-index.json';
import { serverNow, useGame } from '../state/store.ts';
import { fmtDuration, fmtNumber } from './format.ts';

// Interface art from the Supercell fan kit (docs/licensing.md), built by
// scripts/assets/build-sprites.mjs. Callers pass a fallback for missing art.
const ART = `${import.meta.env.BASE_URL}sprites/`;
const INDEX = sprites as {
  ui: Record<string, string>;
  buildings: Record<string, ({ file: string } | null)[]>;
};

export function artUrl(name: string): string | null {
  const f = INDEX.ui[name];
  return f ? ART + f : null;
}

/** Thumbnail of a building at a level (its in-game sprite). */
export function buildingArtUrl(defId: string, level = 1): string | null {
  const list = INDEX.buildings[defId];
  const e = list?.[Math.min(level, list.length) - 1];
  return e ? ART + e.file : null;
}

export function Icon({
  name,
  size = 20,
  fallback = null,
  className = '',
}: {
  name: string;
  size?: number;
  fallback?: ReactNode;
  className?: string;
}) {
  const url = artUrl(name);
  if (!url) return <>{fallback}</>;
  return (
    <img
      className={`art ${className}`}
      src={url}
      width={size}
      height={size}
      alt=""
      aria-hidden
      draggable={false}
    />
  );
}

/** League badge for a trophy count. */
export function leagueOf(trophies: number): string {
  const steps: [number, string][] = [
    [4000, 'legend'],
    [3200, 'titan'],
    [2600, 'champion'],
    [2000, 'master'],
    [1400, 'crystal'],
    [800, 'gold'],
    [400, 'silver'],
  ];
  return `league_${steps.find(([t]) => trophies >= t)?.[1] ?? 'bronze'}`;
}

export function useServerNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => serverNow());
  useEffect(() => {
    const t = setInterval(() => setNow(serverNow()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function Button({
  tone = 'default',
  busy,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: 'default' | 'primary' | 'gold' | 'danger' | 'ghost';
  busy?: boolean;
}) {
  return (
    <button
      {...rest}
      className={`btn btn-${tone} ${rest.className ?? ''}`}
      disabled={rest.disabled || busy}
      aria-busy={busy || undefined}
    >
      {busy ? <span className="spinner" aria-hidden /> : null}
      {children}
    </button>
  );
}

export function Panel({
  title,
  onClose,
  children,
  wide,
}: {
  title: ReactNode;
  onClose?: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <section
      className={`panel ${wide ? 'panel-wide' : ''}`}
      role="dialog"
      aria-label={typeof title === 'string' ? title : undefined}
    >
      <header className="panel-head">
        <h2>{title}</h2>
        {onClose ? (
          <button className="close-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        ) : null}
      </header>
      <div className="panel-body">{children}</div>
    </section>
  );
}

export function Modal({
  children,
  onClose,
  label,
}: {
  children: ReactNode;
  onClose?: () => void;
  label: string;
}) {
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </div>
    </div>
  );
}

export function Gold({ n }: { n: number }) {
  return (
    <span className="res res-gold">
      <Icon name="gold" size={18} fallback={<i className="coin" aria-hidden />} />
      {fmtNumber(n)}
    </span>
  );
}

export function Essence({ n }: { n: number }) {
  return (
    <span className="res res-essence">
      <Icon name="essence" size={18} fallback={<i className="drop" aria-hidden />} />
      {fmtNumber(n)}
    </span>
  );
}

export function CostView({ cost, wallet }: { cost: Cost; wallet?: { gold: number; essence: number } }) {
  const g = cost.gold ?? 0;
  const e = cost.essence ?? 0;
  if (!g && !e) return <span className="muted">Free</span>;
  return (
    <span className="cost">
      {g ? (
        <span className={wallet && wallet.gold < g ? 'short' : ''}>
          <Gold n={g} />
        </span>
      ) : null}
      {e ? (
        <span className={wallet && wallet.essence < e ? 'short' : ''}>
          <Essence n={e} />
        </span>
      ) : null}
    </span>
  );
}

export function Countdown({ until, prefix }: { until: number; prefix?: string }) {
  const now = useServerNow();
  return (
    <span className="countdown">
      {prefix}
      {fmtDuration((until - now) / 1000)}
    </span>
  );
}

export function Progress({
  value,
  tone = 'green',
}: {
  value: number;
  tone?: 'green' | 'gold' | 'purple' | 'blue';
}) {
  return (
    <div
      className={`bar bar-${tone}`}
      role="progressbar"
      aria-valuenow={Math.round(value * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </div>
  );
}

export function Toasts() {
  const toasts = useGame((s) => s.toasts);
  const dismiss = useGame((s) => s.dismissToast);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <button key={t.id} className={`toast toast-${t.tone}`} onClick={() => dismiss(t.id)}>
          {t.text}
        </button>
      ))}
    </div>
  );
}

export function Stars({ n, size = 18 }: { n: number; size?: number }) {
  return (
    <span className="stars" aria-label={`${n} of 3 stars`}>
      {[0, 1, 2].map((i) => (
        <span key={i} className={i < n ? 'star on' : 'star'} style={{ fontSize: size }}>
          ★
        </span>
      ))}
    </span>
  );
}
