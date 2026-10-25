import { IS_DESKTOP } from './env.ts';

/** Native Mac integrations exposed by the Tauri shell (apps/desktop/src-tauri). */

export interface FrontApp {
  bundleId: string;
  name: string;
  /** Screen locked or screensaver active. */
  locked: boolean;
  /** Seconds since the last keyboard or mouse input (informational only). */
  idleSeconds: number;
  /** This app's own bundle id, which always counts as allowed. */
  selfBundleId: string;
}

export interface RunningApp {
  bundleId: string;
  name: string;
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const core = await import('@tauri-apps/api/core');
  return core.invoke<T>(cmd, args);
}

export const desktop = {
  available: IS_DESKTOP,
  frontApp: () => invoke<FrontApp>('front_app'),
  runningApps: () => invoke<RunningApp[]>('running_apps'),
  /** Keeps the Mac awake (display may still sleep) so paper-mode heartbeats continue. */
  preventSleep: (enable: boolean, reason = 'Study session in progress') =>
    invoke<void>('prevent_sleep', { enable, reason }),
};
