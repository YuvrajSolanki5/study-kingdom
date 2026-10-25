import { exportJWK, generateKeyPair, SignJWT, type JSONWebKeySet } from 'jose';

interface FakeUser {
  id: string;
  email: string;
  password: string;
  confirmed: boolean;
  meta: Record<string, unknown>;
}

/**
 * In-memory stand-in for Supabase Auth's REST API with real ES256-signed
 * tokens, so the BFF and token verification run unmodified in tests.
 * "Sent" emails are captured in `outbox`.
 */
export async function createFakeGoTrue(
  supabaseUrl: string,
  opts: { confirmEmail?: boolean; onUser?: (u: { id: string; email: string }) => Promise<void> } = {},
) {
  const { publicKey, privateKey } = await generateKeyPair('ES256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'ES256', use: 'sig' };
  const jwks: JSONWebKeySet = { keys: [jwk] };
  const users = new Map<string, FakeUser>();
  const refresh = new Map<string, { userId: string; sessionId: string; used: boolean }>();
  const tokenHashes = new Map<string, { userId: string; type: string }>();
  const revokedSessions = new Set<string>();
  const outbox: { to: string; type: string; tokenHash: string; redirectTo: string }[] = [];
  let ttlSeconds = 3600;
  const issuer = `${supabaseUrl}/auth/v1`;

  const rand = () => crypto.randomUUID().replace(/-/g, '');

  async function session(user: FakeUser, sessionId = crypto.randomUUID()) {
    const now = Math.floor(Date.now() / 1000);
    const access = await new SignJWT({
      email: user.email,
      role: 'authenticated',
      session_id: sessionId,
      user_metadata: user.meta,
    })
      .setProtectedHeader({ alg: 'ES256', kid: 'test-key' })
      .setSubject(user.id)
      .setIssuer(issuer)
      .setAudience('authenticated')
      .setIssuedAt(now)
      .setExpirationTime(now + ttlSeconds)
      .sign(privateKey);
    const rt = rand();
    refresh.set(rt, { userId: user.id, sessionId, used: false });
    return {
      access_token: access,
      refresh_token: rt,
      expires_in: ttlSeconds,
      expires_at: now + ttlSeconds,
      token_type: 'bearer',
      user: {
        id: user.id,
        email: user.email,
        email_confirmed_at: user.confirmed ? new Date().toISOString() : null,
        user_metadata: user.meta,
      },
    };
  }

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const err = (status: number, error_code: string, msg = error_code) =>
    json(status, { code: status, error_code, msg });

  async function userFromAuth(req: Request): Promise<{ user: FakeUser; sessionId: string } | null> {
    const token = req.headers.get('authorization')?.slice(7);
    if (!token) return null;
    const [, payload] = token.split('.');
    const claims = JSON.parse(Buffer.from(payload!, 'base64url').toString()) as {
      sub: string;
      session_id: string;
    };
    if (revokedSessions.has(claims.session_id)) return null;
    const user = users.get(claims.sub);
    return user ? { user, sessionId: claims.session_id } : null;
  }

  async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname.replace('/auth/v1', '');
    const body = req.method === 'GET' ? {} : ((await req.json().catch(() => ({}))) as Record<string, string>);
    const redirectTo = url.searchParams.get('redirect_to') ?? '';
    if (req.headers.get('apikey') !== 'test-publishable-key') return err(401, 'no_api_key');
    switch (path) {
      case '/signup': {
        const email = String(body.email).toLowerCase();
        const existing = [...users.values()].find((u) => u.email === email);
        if (existing)
          return opts.confirmEmail
            ? json(200, { id: crypto.randomUUID(), email })
            : err(422, 'user_already_exists');
        const user: FakeUser = {
          id: crypto.randomUUID(),
          email,
          password: String(body.password),
          confirmed: !opts.confirmEmail,
          meta: (body.data as unknown as Record<string, unknown>) ?? {},
        };
        users.set(user.id, user);
        await opts.onUser?.({ id: user.id, email });
        if (opts.confirmEmail) {
          const tokenHash = rand();
          tokenHashes.set(tokenHash, { userId: user.id, type: 'signup' });
          outbox.push({ to: email, type: 'signup', tokenHash, redirectTo });
          return json(200, { id: user.id, email });
        }
        return json(200, await session(user));
      }
      case '/token': {
        const grant = url.searchParams.get('grant_type');
        if (grant === 'password') {
          const user = [...users.values()].find((u) => u.email === String(body.email).toLowerCase());
          if (!user || user.password !== body.password) return err(400, 'invalid_credentials');
          if (!user.confirmed) return err(400, 'email_not_confirmed');
          return json(200, await session(user));
        }
        if (grant === 'refresh_token') {
          const entry = refresh.get(String(body.refresh_token));
          if (!entry || revokedSessions.has(entry.sessionId)) return err(400, 'refresh_token_not_found');
          if (entry.used) return err(400, 'refresh_token_already_used');
          entry.used = true;
          return json(200, await session(users.get(entry.userId)!, entry.sessionId));
        }
        return err(400, 'unsupported_grant_type');
      }
      case '/logout': {
        const who = await userFromAuth(req);
        if (!who) return err(401, 'bad_jwt');
        if (url.searchParams.get('scope') === 'global') {
          for (const r of refresh.values()) if (r.userId === who.user.id) revokedSessions.add(r.sessionId);
        }
        revokedSessions.add(who.sessionId);
        return new Response(null, { status: 204 });
      }
      case '/recover': {
        const user = [...users.values()].find((u) => u.email === String(body.email).toLowerCase());
        if (user) {
          const tokenHash = rand();
          tokenHashes.set(tokenHash, { userId: user.id, type: 'recovery' });
          outbox.push({ to: user.email, type: 'recovery', tokenHash, redirectTo });
        }
        return json(200, {});
      }
      case '/resend': {
        const user = [...users.values()].find((u) => u.email === String(body.email).toLowerCase());
        if (user && !user.confirmed) {
          const tokenHash = rand();
          tokenHashes.set(tokenHash, { userId: user.id, type: 'signup' });
          outbox.push({ to: user.email, type: 'signup', tokenHash, redirectTo });
        }
        return json(200, {});
      }
      case '/verify': {
        const entry = tokenHashes.get(String(body.token_hash));
        if (!entry || entry.type !== body.type) return err(403, 'otp_expired');
        tokenHashes.delete(String(body.token_hash));
        const user = users.get(entry.userId)!;
        user.confirmed = true;
        return json(200, await session(user));
      }
      case '/user': {
        const who = await userFromAuth(req);
        if (!who) return err(401, 'bad_jwt');
        if (req.method === 'PUT') {
          if (body.password === who.user.password) return err(422, 'same_password');
          who.user.password = String(body.password);
        }
        return json(200, { id: who.user.id, email: who.user.email });
      }
      default:
        return err(404, 'not_found');
    }
  }

  return {
    jwks,
    outbox,
    users,
    fetch: (input: string, init?: RequestInit) => handle(new Request(input, init)),
    setTtl(seconds: number) {
      ttlSeconds = seconds;
    },
  };
}

export type FakeGoTrue = Awaited<ReturnType<typeof createFakeGoTrue>>;
