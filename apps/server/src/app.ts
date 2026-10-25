import { ClientErrorBody } from '@sk/shared';
import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { csrfGuard, optionalAuth, requireAuth } from './auth/session.ts';
import type { AppEnv, Deps } from './context.ts';
import { toHttpError } from './errors.ts';
import { authRoutes } from './routes/auth.ts';
import { battleRoutes } from './routes/battles.ts';
import { playerRoutes } from './routes/player.ts';
import { clanRoutes } from './routes/clans.ts';
import { registerWars } from './services/wars.ts';
import { socialRoutes } from './routes/social.ts';
import { registerRivalry } from './services/rivalry.ts';
import { studyRoutes } from './routes/study.ts';

/**
 * Builds the API. `getDeps` is called once per request with the raw context
 * (Workers bindings in production, fakes in tests).
 */
export function createApp(getDeps: (c: Context) => Deps) {
  registerRivalry();
  registerWars();
  const app = new Hono<AppEnv>();

  app.use('*', async (c, next) => {
    const deps = getDeps(c);
    c.set('deps', deps);
    c.set('requestId', crypto.randomUUID());
    await next();
  });

  app.use(
    '/api/*',
    cors({
      origin: (origin, c) =>
        (c as Context<AppEnv>).var.deps.config.allowedOrigins.has(origin) ? origin : null,
      allowHeaders: ['content-type', 'authorization', 'x-client', 'x-timezone', 'x-app-version'],
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      maxAge: 600,
    }),
  );

  app.use('/api/*', async (c, next) => {
    c.header('cache-control', 'no-store');
    c.header('x-content-type-options', 'nosniff');
    await next();
  });

  app.use('/api/*', csrfGuard);

  // One database client per request, closed after the response is sent.
  app.use('/api/*', async (c, next) => {
    const sql = c.var.deps.createSql();
    c.set('sql', sql);
    try {
      await next();
    } finally {
      c.var.deps.defer(sql.end({ timeout: 2 }).catch(() => undefined));
    }
  });

  app.get('/api/health', async (c) => {
    const [row] = await c.var.sql<{ ok: number }[]>`select 1 as ok`;
    return c.json({ ok: row?.ok === 1, version: c.var.deps.config.appVersion, time: c.var.deps.now() });
  });

  app.route('/api/auth', authRoutes);

  app.use('/api/player/*', requireAuth);
  app.use('/api/player', requireAuth);
  app.route('/api/player', playerRoutes);
  app.use('/api/study/*', requireAuth);
  app.route('/api/study', studyRoutes);
  app.use('/api/battles/*', requireAuth);
  app.use('/api/battles', requireAuth);
  app.route('/api/battles', battleRoutes);

  app.use('/api/social/*', requireAuth);
  app.use('/api/social', requireAuth);
  app.route('/api/social', socialRoutes);

  app.use('/api/clans/*', requireAuth);
  app.use('/api/clans', requireAuth);
  app.route('/api/clans', clanRoutes);

  app.post('/api/errors', optionalAuth, async (c) => {
    const body = ClientErrorBody.parse(await c.req.json());
    const user = c.get('user');
    await c.var.sql`insert into game.client_errors (user_id, platform, app_version, message, stack, url)
      values (${user?.sub ?? null}, ${body.platform ?? null}, ${body.appVersion ?? null}, ${body.message},
        ${body.stack ?? null}, ${body.url ?? null})`;
    return c.json({ ok: true });
  });

  app.notFound((c) => c.json({ error: { code: 'not_found', message: 'Not found' } }, 404));

  app.onError((err, c) => {
    const http = toHttpError(err);
    if (http) {
      return c.json(
        {
          error: {
            code: http.code,
            message: http.message,
            ...(http.details ? { details: http.details } : {}),
          },
        },
        http.status,
      );
    }
    console.error(`[${c.get('requestId')}]`, err);
    return c.json({ error: { code: 'internal', message: 'Something went wrong. Please try again.' } }, 500);
  });

  return app;
}
