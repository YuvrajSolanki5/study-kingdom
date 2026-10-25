import { IS_DESKTOP } from './env.ts';

/** localStorage that never throws (private mode, blocked storage). */
export const local = {
  get(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* storage unavailable */
    }
  },
  remove(key: string) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* storage unavailable */
    }
  },
};

/** Stable random id for this browser or Mac, used to own a study session. */
export function deviceId(): string {
  const existing = local.get('sk.device');
  if (existing && /^[A-Za-z0-9_-]{8,64}$/.test(existing)) return existing;
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const id = `${IS_DESKTOP ? 'mac' : 'web'}-${[...bytes].map((b) => b.toString(36).padStart(2, '0')).join('')}`;
  local.set('sk.device', id);
  return id;
}

/**
 * Secrets (the desktop refresh token) go to the macOS Keychain through a Tauri
 * command. The web build never stores tokens in JavaScript-visible storage.
 */
export const secure = {
  async get(key: string): Promise<string | null> {
    if (!IS_DESKTOP) return null;
    const { invoke } = await import('@tauri-apps/api/core');
    return (await invoke<string | null>('secure_get', { key })) ?? null;
  },
  async set(key: string, value: string): Promise<void> {
    if (!IS_DESKTOP) return;
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('secure_set', { key, value });
  },
  async remove(key: string): Promise<void> {
    if (!IS_DESKTOP) return;
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('secure_delete', { key });
  },
};
