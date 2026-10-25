import { API_BASE, APP_VERSION, IS_DESKTOP } from '../platform/env.ts';
import { secure } from '../platform/storage.ts';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const REFRESH_KEY = 'refresh_token';

/** Desktop only: the access token lives in memory, the refresh token in the Keychain. */
const desktopAuth = {
  access: null as string | null,
  expiresAt: 0,
  refreshing: null as Promise<boolean> | null,
};

export async function storeDesktopTokens(t: {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}) {
  desktopAuth.access = t.accessToken;
  desktopAuth.expiresAt = t.expiresAt * 1000;
  await secure.set(REFRESH_KEY, t.refreshToken);
}

export async function clearDesktopTokens() {
  desktopAuth.access = null;
  desktopAuth.expiresAt = 0;
  await secure.remove(REFRESH_KEY).catch(() => undefined);
}

/** Single-flight refresh so parallel requests never race the refresh token rotation. */
export function refreshDesktopSession(): Promise<boolean> {
  if (!IS_DESKTOP) return Promise.resolve(false);
  desktopAuth.refreshing ??= (async () => {
    try {
      const refreshToken = await secure.get(REFRESH_KEY);
      if (!refreshToken) return false;
      const res = await fetch(`${API_BASE}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-client': 'desktop' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) {
        if (res.status === 401) await clearDesktopTokens();
        return false;
      }
      const body = (await res.json()) as {
        tokens: { accessToken: string; refreshToken: string; expiresAt: number };
      };
      await storeDesktopTokens(body.tokens);
      return true;
    } catch {
      return false;
    } finally {
      desktopAuth.refreshing = null;
    }
  })();
  return desktopAuth.refreshing;
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  /** Do not attempt a token refresh on 401 (auth endpoints). */
  noRetry?: boolean;
  keepalive?: boolean;
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { 'x-app-version': APP_VERSION };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  try {
    headers['x-timezone'] = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    /* ignore */
  }
  if (IS_DESKTOP) {
    headers['x-client'] = 'desktop';
    if (desktopAuth.access && Date.now() > desktopAuth.expiresAt - 30_000 && !opts.noRetry)
      await refreshDesktopSession();
    if (desktopAuth.access) headers.authorization = `Bearer ${desktopAuth.access}`;
  }
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api${path}`, {
      method: opts.method ?? (opts.body === undefined ? 'GET' : 'POST'),
      headers,
      credentials: IS_DESKTOP ? 'omit' : 'same-origin',
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
      ...(opts.keepalive ? { keepalive: true } : {}),
    });
  } catch {
    throw new ApiError(0, 'network', 'You appear to be offline. Retrying…');
  }
  if (res.status === 401 && IS_DESKTOP && !opts.noRetry) {
    if (await refreshDesktopSession()) return api<T>(path, { ...opts, noRetry: true });
  }
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new ApiError(res.status, 'bad_response', 'Unexpected server response');
  }
  if (!res.ok) {
    const err = (data as { error?: { code: string; message: string; details?: unknown } } | null)?.error;
    throw new ApiError(
      res.status,
      err?.code ?? 'error',
      err?.message ?? `Request failed (${res.status})`,
      err?.details,
    );
  }
  return data as T;
}

export const isNetworkError = (e: unknown) => e instanceof ApiError && e.status === 0;
