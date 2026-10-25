import type { Context, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { AppEnv, AuthUser } from '../context.ts';
import { forbidden, unauthorized } from '../errors.ts';
import type { GoTrueSession } from './gotrue.ts';

/** Refresh tokens last 30 days when "keep me signed in" is chosen; otherwise until the browser closes. */
const REFRESH_MAX_AGE = 30 * 24 * 3600;

function cookieNames(c: Context<AppEnv>) {
  const secure = c.var.deps.config.production;
  // __Host- cookies must be Secure, Path=/ and host-only: the strongest scoping browsers offer.
  return secure
    ? { at: '__Host-sk_at', rt: '__Host-sk_rt', rm: '__Host-sk_rm' }
    : { at: 'sk_at', rt: 'sk_rt', rm: 'sk_rm' };
}

export function isDesktop(c: Context<AppEnv>): boolean {
  return c.req.header('x-client') === 'desktop';
}

export function setSessionCookies(c: Context<AppEnv>, session: GoTrueSession, remember: boolean) {
  const names = cookieNames(c);
  const secure = c.var.deps.config.production;
  const base = { path: '/', httpOnly: true, secure, sameSite: 'Lax' as const };
  setCookie(c, names.at, session.access_token, { ...base, maxAge: Math.max(60, session.expires_in) });
  setCookie(c, names.rt, session.refresh_token, remember ? { ...base, maxAge: REFRESH_MAX_AGE } : base);
  setCookie(c, names.rm, remember ? '1' : '0', remember ? { ...base, maxAge: REFRESH_MAX_AGE } : base);
}

export function clearSessionCookies(c: Context<AppEnv>) {
  const names = cookieNames(c);
  const secure = c.var.deps.config.production;
  for (const name of [names.at, names.rt, names.rm]) deleteCookie(c, name, { path: '/', secure });
}

export function readRefreshCookie(c: Context<AppEnv>): { token: string | undefined; remember: boolean } {
  const names = cookieNames(c);
  return { token: getCookie(c, names.rt), remember: getCookie(c, names.rm) !== '0' };
}

export function tokensBody(session: GoTrueSession) {
  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresAt: session.expires_at ?? Math.floor(Date.now() / 1000) + session.expires_in,
  };
}

function clientIp(c: Context<AppEnv>) {
  return c.req.header('cf-connecting-ip') ?? undefined;
}

export function gotrueFor(c: Context<AppEnv>) {
  return c.var.deps.gotrue(clientIp(c));
}

/**
 * Rejects cross-site state-changing requests that rely on cookies. Bearer
 * requests (desktop app) carry no ambient credentials and are exempt.
 */
export const csrfGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  const method = c.req.method;
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();
  if (c.req.header('authorization')?.startsWith('Bearer ')) return next();
  const origin = c.req.header('origin');
  const self = new URL(c.req.url).origin;
  if (!origin || (origin !== self && !c.var.deps.config.allowedOrigins.has(origin)))
    throw forbidden('Bad origin');
  return next();
};

async function authenticate(c: Context<AppEnv>): Promise<AuthUser | null> {
  const { verifyToken } = c.var.deps;
  const header = c.req.header('authorization');
  if (header?.startsWith('Bearer ')) {
    const token = header.slice(7);
    return { ...(await verifyToken(token)), via: 'bearer', accessToken: token };
  }
  const names = cookieNames(c);
  const access = getCookie(c, names.at);
  if (access) {
    try {
      return { ...(await verifyToken(access)), via: 'cookie', accessToken: access };
    } catch {
      // Fall through to refresh.
    }
  }
  const { token: refresh, remember } = readRefreshCookie(c);
  if (!refresh) return null;
  try {
    const session = await gotrueFor(c).refresh(refresh);
    setSessionCookies(c, session, remember);
    return { ...(await verifyToken(session.access_token)), via: 'cookie', accessToken: session.access_token };
  } catch {
    clearSessionCookies(c);
    return null;
  }
}

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = await authenticate(c);
  if (!user) throw unauthorized();
  c.set('user', user);
  return next();
};

export const optionalAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = await authenticate(c).catch(() => null);
  if (user) c.set('user', user);
  return next();
};
