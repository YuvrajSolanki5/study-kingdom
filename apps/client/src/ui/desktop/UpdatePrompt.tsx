import { useEffect } from 'react';
import { create } from 'zustand';
import { IS_DESKTOP } from '../../platform/env.ts';
import { useGame } from '../../state/store.ts';
import { Button, Modal, Progress } from '../common.tsx';

interface PendingUpdate {
  version: string;
  notes: string;
  install(onProgress: (done: number, total: number) => void): Promise<void>;
}

interface UpdateUi {
  pending: PendingUpdate | null;
  dismissed: string | null;
  phase: 'idle' | 'downloading' | 'restarting' | 'error';
  progress: number;
  error: string | null;
  set(p: Partial<UpdateUi>): void;
}

const useUpdate = create<UpdateUi>((set) => ({
  pending: null,
  dismissed: null,
  phase: 'idle',
  progress: 0,
  error: null,
  set: (p) => set(p),
}));

/**
 * Checks the signed update manifest (HTTPS, GitHub Releases). The Tauri
 * updater verifies each bundle's signature against the public key embedded in
 * the app before installing; this is separate from Apple code signing.
 */
export async function checkForUpdates(manual = false) {
  if (!IS_DESKTOP) return;
  try {
    const { check } = await import('@tauri-apps/plugin-updater');
    const update = await check({ timeout: 20_000 });
    if (!update) {
      if (manual) useGame.getState().toast('You have the latest version.', 'good');
      return;
    }
    useUpdate.getState().set({
      pending: {
        version: update.version,
        notes: update.body ?? '',
        async install(onProgress) {
          let total = 0;
          let done = 0;
          await update.downloadAndInstall((ev) => {
            if (ev.event === 'Started') total = ev.data.contentLength ?? 0;
            else if (ev.event === 'Progress') {
              done += ev.data.chunkLength;
              onProgress(done, total);
            }
          });
        },
      },
      ...(manual ? { dismissed: null } : {}),
    });
  } catch (e) {
    if (manual) useGame.getState().toast(`Update check failed: ${String(e)}`, 'bad');
  }
}

export function UpdatePrompt() {
  const u = useUpdate();
  const session = useGame((s) => s.view?.activeSession ?? null);
  const battle = useGame((s) => s.battle);
  useEffect(() => {
    if (!IS_DESKTOP) return;
    const first = setTimeout(() => void checkForUpdates(false), 5000);
    const every = setInterval(() => void checkForUpdates(false), 6 * 3600_000);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }, []);
  if (!u.pending || u.dismissed === u.pending.version) return null;
  // Never restart in the middle of focus time or a battle.
  const busy = session?.status === 'running' || !!battle;
  const install = async () => {
    u.set({ phase: 'downloading', progress: 0, error: null });
    try {
      await u.pending!.install((done, total) => u.set({ progress: total ? done / total : 0 }));
      u.set({ phase: 'restarting' });
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    } catch (e) {
      u.set({ phase: 'error', error: String(e) });
    }
  };
  return (
    <Modal
      label="Update available"
      onClose={u.phase === 'idle' ? () => u.set({ dismissed: u.pending!.version }) : undefined}
    >
      <h2>Study Kingdom {u.pending.version} is ready</h2>
      {u.pending.notes ? <pre className="notes">{u.pending.notes}</pre> : null}
      {u.phase === 'downloading' ? <Progress value={u.progress} /> : null}
      {u.phase === 'restarting' ? <p>Restarting…</p> : null}
      {u.error ? (
        <p className="error">Update failed: {u.error}. Your current version keeps working.</p>
      ) : null}
      {busy ? (
        <p className="muted small">The update will wait until your study session or battle is finished.</p>
      ) : null}
      <div className="row end">
        <Button
          tone="ghost"
          onClick={() => u.set({ dismissed: u.pending!.version })}
          disabled={u.phase === 'downloading'}
        >
          Later
        </Button>
        <Button
          tone="primary"
          onClick={install}
          disabled={busy || u.phase === 'downloading' || u.phase === 'restarting'}
        >
          Update and restart
        </Button>
      </div>
    </Modal>
  );
}
