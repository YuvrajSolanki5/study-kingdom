import { HttpError } from '../errors.ts';

/** Minimal client for the Supabase Auth (GoTrue) REST API used by the BFF. */

export interface GoTrueUser {
  id: string;
  email?: string;
  email_confirmed_at?: string | null;
  user_metadata?: Record<string, unknown>;
}

export interface GoTrueSession {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  expires_at?: number;
  user: GoTrueUser;
}

export interface GoTrueClient {
  signUp(email: string, password: string, data: Record<string, unknown>): Promise<GoTrueSession | null>;
  signIn(email: string, password: string): Promise<GoTrueSession>;
  refresh(refreshToken: string): Promise<GoTrueSession>;
  logout(accessToken: string, scope: 'local' | 'global'): Promise<void>;
  updatePassword(accessToken: string, password: string): Promise<GoTrueUser>;
}

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

interface GoTrueErrorBody {
  code?: number | string;
  error_code?: string;
  msg?: string;
  message?: string;
  error?: string;
  error_description?: string;
}

function mapError(status: number, body: GoTrueErrorBody): HttpError {
  const code = String(body.error_code ?? body.error ?? '');
  const message = body.msg ?? body.message ?? body.error_description ?? 'Authentication failed';
  if (status === 429 || code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit')
    return new HttpError(429, 'rate_limited', 'Too many attempts. Please wait a few minutes and try again.');
  if (code === 'email_not_confirmed')
    return new HttpError(
      403,
      'email_not_confirmed',
      'Account configuration needs attention. Please contact the host.',
    );
  if (code === 'invalid_credentials' || code === 'invalid_grant')
    return new HttpError(401, 'invalid_credentials', 'Username or password is incorrect.');
  if (code === 'weak_password') return new HttpError(422, 'weak_password', message);
  if (code === 'user_already_exists' || code === 'email_exists')
    return new HttpError(409, 'user_exists', 'That username is already taken.');
  if (code === 'otp_expired' || code === 'flow_state_expired' || code === 'bad_jwt')
    return new HttpError(
      400,
      'link_expired',
      'This link has expired or was already used. Request a new one.',
    );
  if (
    code === 'refresh_token_not_found' ||
    code === 'refresh_token_already_used' ||
    code === 'session_not_found'
  )
    return new HttpError(401, 'session_expired', 'Your session has ended. Please sign in again.');
  if (code === 'same_password')
    return new HttpError(422, 'same_password', 'Choose a password you have not used here.');
  if (status === 401 || status === 403) return new HttpError(401, 'unauthorized', message);
  if (status >= 500) return new HttpError(502, 'auth_unavailable', 'Sign-in is temporarily unavailable.');
  return new HttpError(400, 'auth_error', message);
}

export function createGoTrueClient(opts: {
  url: string;
  apiKey: string;
  fetch?: FetchFn;
  clientIp?: string;
}): GoTrueClient {
  const base = `${opts.url}/auth/v1`;
  const doFetch: FetchFn = opts.fetch ?? ((i, init) => fetch(i, init));

  async function call<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
    const headers: Record<string, string> = {
      apikey: opts.apiKey,
      'content-type': 'application/json',
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
      ...(opts.clientIp ? { 'x-forwarded-for': opts.clientIp } : {}),
    };
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, { ...init, headers });
    } catch {
      throw new HttpError(502, 'auth_unavailable', 'Sign-in is temporarily unavailable.');
    }
    const text = await res.text();
    const body = text ? (JSON.parse(text) as unknown) : {};
    if (!res.ok) throw mapError(res.status, body as GoTrueErrorBody);
    return body as T;
  }

  const post = <T>(path: string, body: unknown, token?: string) =>
    call<T>(path, { method: 'POST', body: JSON.stringify(body), ...(token ? { token } : {}) });

  return {
    async signUp(email, password, data) {
      const res = await post<GoTrueSession | GoTrueUser>('/signup', {
        email,
        password,
        data,
      });
      return 'access_token' in res ? res : null;
    },
    signIn: (email, password) => post<GoTrueSession>('/token?grant_type=password', { email, password }),
    refresh: (refreshToken) =>
      post<GoTrueSession>('/token?grant_type=refresh_token', { refresh_token: refreshToken }),
    async logout(accessToken, scope) {
      await call(`/logout?scope=${scope}`, { method: 'POST', token: accessToken });
    },
    updatePassword: (accessToken, password) =>
      call<GoTrueUser>('/user', { method: 'PUT', body: JSON.stringify({ password }), token: accessToken }),
  };
}
