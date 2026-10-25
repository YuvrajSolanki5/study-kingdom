import { LoginBody, ChangePasswordBody, RefreshBody, RegisterBody, type AuthResponse } from '@sk/shared';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../context.ts';
import { HttpError, unauthorized } from '../errors.ts';
import { accountAddress, usernameFromAddress } from '../auth/username.ts';
import type { GoTrueSession } from '../auth/gotrue.ts';
import {
  clearSessionCookies,
  gotrueFor,
  isDesktop,
  readRefreshCookie,
  requireAuth,
  setSessionCookies,
  tokensBody,
} from '../auth/session.ts';

const LoginWithRemember = LoginBody.extend({ remember: z.boolean().default(true) });

function respondWithSession(c: Context<AppEnv>, session: GoTrueSession, remember = true) {
  const body: AuthResponse = {
    user: {
      id: session.user.id,
      username: usernameFromAddress(session.user.email) ?? '',
    },
  };
  if (isDesktop(c)) body.tokens = tokensBody(session);
  else setSessionCookies(c, session, remember);
  return c.json(body);
}

export const authRoutes = new Hono<AppEnv>()
  .post('/register', async (c) => {
    const body = RegisterBody.parse(await c.req.json());
    const session = await gotrueFor(c).signUp(accountAddress(body.username), body.password, {
      display_name: body.displayName,
      username: body.username,
    });
    if (!session)
      throw new HttpError(
        503,
        'auth_configuration',
        'Account creation is unavailable. Please contact the host.',
      );
    return respondWithSession(c, session);
  })
  .post('/login', async (c) => {
    const body = LoginWithRemember.parse(await c.req.json());
    const session = await gotrueFor(c).signIn(accountAddress(body.username), body.password);
    return respondWithSession(c, session, body.remember);
  })
  .post('/refresh', async (c) => {
    const body = RefreshBody.parse(await c.req.json().catch(() => ({})));
    const fromCookie = readRefreshCookie(c);
    const token = body.refreshToken ?? fromCookie.token;
    if (!token) throw unauthorized();
    try {
      const session = await gotrueFor(c).refresh(token);
      return respondWithSession(c, session, fromCookie.remember);
    } catch (e) {
      if (!isDesktop(c)) clearSessionCookies(c);
      throw e;
    }
  })
  .post('/logout', async (c) => {
    const body = z
      .object({ scope: z.enum(['local', 'global']).default('local') })
      .parse(await c.req.json().catch(() => ({})));
    const header = c.req.header('authorization');
    let access = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!access) {
      // Web: revoke the server-side session behind the refresh token.
      const { token } = readRefreshCookie(c);
      if (token) {
        const session = await gotrueFor(c)
          .refresh(token)
          .catch(() => null);
        access = session?.access_token;
      }
    }
    if (access)
      await gotrueFor(c)
        .logout(access, body.scope)
        .catch(() => undefined);
    clearSessionCookies(c);
    return c.json({ ok: true });
  })
  .post('/password', requireAuth, async (c) => {
    const body = ChangePasswordBody.parse(await c.req.json());
    const address = accountAddress(c.var.user.username);
    const client = gotrueFor(c);
    const fresh = await client.signIn(address, body.currentPassword);
    await client.updatePassword(fresh.access_token, body.newPassword);
    return respondWithSession(c, await client.signIn(address, body.newPassword));
  })
  .get('/session', requireAuth, (c) => {
    const u = c.var.user;
    return c.json({ user: { id: u.sub, username: u.username } });
  });
