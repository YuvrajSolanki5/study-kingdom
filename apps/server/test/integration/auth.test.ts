import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, createHarness, type Harness } from './harness.ts';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => h?.close());
const PASSWORD = 'correct-horse-battery';

async function registeredUser(username: string) {
  const c = new Client(h);
  const result = await c.post('/api/auth/register', { username, password: PASSWORD, displayName: 'User' });
  expect(result.status).toBe(200);
  return c;
}

describe('username registration', () => {
  it('signs in immediately, normalizes capitals, and never sends email', async () => {
    const c = new Client(h);
    const reg = await c.post('/api/auth/register', {
      username: ' Ada_123 ',
      password: PASSWORD,
      displayName: 'Ada',
    });
    expect(reg.status).toBe(200);
    expect(reg.body.user).toEqual({ id: expect.any(String), username: 'ada_123' });
    expect(c.cookies.has('sk_at')).toBe(true);
    expect(c.cookies.has('sk_rt')).toBe(true);
    expect(h.gotrue.outbox).toHaveLength(0);
    const me = await c.get('/api/player');
    expect(me.body.profile.displayName).toBe('Ada');
    expect(me.body.wallet.gold).toBe(750);
    const login = await new Client(h).post('/api/auth/login', { username: 'ADA_123', password: PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body.user.username).toBe('ada_123');
  });

  it('reserves normalized usernames and rejects wrong passwords', async () => {
    await registeredUser('unique_name');
    const duplicate = await new Client(h).post('/api/auth/register', {
      username: 'UNIQUE_NAME',
      password: PASSWORD,
      displayName: 'Dup',
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.message).toContain('username');
    const bad = await new Client(h).post('/api/auth/login', {
      username: 'unique_name',
      password: 'incorrect',
    });
    const unknown = await new Client(h).post('/api/auth/login', {
      username: 'unknown_name',
      password: 'incorrect',
    });
    expect(bad.status).toBe(401);
    expect(bad.body).toEqual(unknown.body);
  });

  it('rejects invalid usernames, weak passwords and the old email payload', async () => {
    for (const username of [
      'ab',
      'has spaces',
      'email@example.com',
      'a'.repeat(25),
      '_starts_with_underscore',
      'name+alias',
    ]) {
      expect(
        (
          await new Client(h).post('/api/auth/register', {
            username,
            password: PASSWORD,
            displayName: 'User',
          })
        ).status,
      ).toBe(400);
    }
    expect(
      (
        await new Client(h).post('/api/auth/register', {
          username: 'valid_user',
          password: 'short',
          displayName: 'User',
        })
      ).status,
    ).toBe(400);
    expect(
      (await new Client(h).post('/api/auth/login', { email: 'person@example.com', password: PASSWORD }))
        .status,
    ).toBe(400);
    for (const path of ['recover', 'resend', 'verify', 'reset-password'])
      expect((await new Client(h).post('/api/auth/' + path, {})).status).toBe(404);
  });

  it('does not accept a token for an arbitrary email account', async () => {
    const session = await h.deps.gotrue().signUp('other@example.com', PASSWORD, {});
    const c = new Client(h);
    c.bearer = session!.access_token;
    expect((await c.get('/api/player')).status).toBe(401);
  });
});

describe('sessions', () => {
  it('logs in, persists via refresh, and logs out', async () => {
    await registeredUser('bob');
    const c = new Client(h);
    const login = await c.post('/api/auth/login', {
      username: 'bob',
      password: PASSWORD,
      remember: true,
    });
    expect(login.status).toBe(200);
    expect(login.body.tokens).toBeUndefined();

    // Access token gone (expired): the refresh cookie silently renews the session.
    c.cookies.delete('sk_at');
    const me = await c.get('/api/auth/session');
    expect(me.status).toBe(200);
    expect(c.cookies.has('sk_at')).toBe(true);

    const out = await c.post('/api/auth/logout');
    expect(out.status).toBe(200);
    expect(c.cookies.size).toBe(0);
    expect((await c.get('/api/player')).status).toBe(401);
  });

  it('marks session cookies httpOnly and SameSite=Lax', async () => {
    await registeredUser('cookies');
    const res = await h.app.request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost' },
      body: JSON.stringify({ username: 'cookies', password: PASSWORD, remember: false }),
    });
    const cookies = res.headers.getSetCookie();
    const rt = cookies.find((s) => s.startsWith('sk_rt='))!;
    expect(rt).toMatch(/HttpOnly/i);
    expect(rt).toMatch(/SameSite=Lax/i);
    expect(rt).not.toMatch(/Max-Age/i); // session cookie when not remembered
  });

  it('rejects cross-site cookie requests (CSRF)', async () => {
    const c = await registeredUser('csrf');
    const evil = await c.post('/api/player/actions', {}, { origin: 'https://evil.example' });
    expect(evil.status).toBe(403);
    const noOrigin = await c.req('POST', '/api/player/actions', {}, { origin: '' });
    expect(noOrigin.status).toBe(403);
  });

  it('desktop clients receive tokens and use bearer auth with refresh rotation', async () => {
    await registeredUser('desk');
    const c = new Client(h);
    c.desktop = true;
    const login = await c.post('/api/auth/login', { username: 'desk', password: PASSWORD });
    expect(login.status).toBe(200);
    expect(c.cookies.size).toBe(0);
    const { accessToken, refreshToken } = login.body.tokens;
    c.bearer = accessToken;
    expect((await c.get('/api/player')).status).toBe(200);
    c.bearer = null;
    const refreshed = await c.post('/api/auth/refresh', { refreshToken });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.tokens.refreshToken).not.toBe(refreshToken);
    const reuse = await c.post('/api/auth/refresh', { refreshToken });
    expect(reuse.status).toBe(401);
  });

  it('rejects forged or garbage tokens', async () => {
    const c = new Client(h);
    c.bearer = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.bad';
    expect((await c.get('/api/player')).status).toBe(401);
  });
});

describe('password changes', () => {
  it('requires the current password and authenticates with the new password', async () => {
    const c = await registeredUser('password_change');
    expect(
      (
        await new Client(h).post('/api/auth/password', {
          currentPassword: PASSWORD,
          newPassword: 'a-brand-new-password',
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await c.post('/api/auth/password', {
          currentPassword: 'incorrect',
          newPassword: 'a-brand-new-password',
        })
      ).status,
    ).toBe(401);
    expect(
      (await c.post('/api/auth/password', { currentPassword: PASSWORD, newPassword: 'a-brand-new-password' }))
        .status,
    ).toBe(200);
    expect(
      (await new Client(h).post('/api/auth/login', { username: 'password_change', password: PASSWORD }))
        .status,
    ).toBe(401);
    expect(
      (
        await new Client(h).post('/api/auth/login', {
          username: 'password_change',
          password: 'a-brand-new-password',
        })
      ).status,
    ).toBe(200);
    expect(h.gotrue.outbox).toHaveLength(0);
  });
});
