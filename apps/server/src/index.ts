import type { Context } from 'hono';
import { createApp } from './app.ts';
import { createGoTrueClient } from './auth/gotrue.ts';
import { createTokenVerifier, type TokenVerifier } from './auth/tokens.ts';
import type { Deps } from './context.ts';
import { runCron } from './cron.ts';
import { createSql } from './db.ts';
import { readConfig, type Env } from './env.ts';
import { chunkedVerifier, edgeVerifier, inlineVerifier } from './verify/verifiers.ts';
import type { BattleVerifier } from './verify/types.ts';

interface ExecCtx {
  waitUntil(p: Promise<unknown>): void;
}

// Built once per isolate and reused across requests.
let cached: { env: Env; verifyToken: TokenVerifier; verifier: BattleVerifier } | null = null;

function depsFor(env: Env, ctx: ExecCtx): Deps {
  const config = readConfig(env);
  if (!cached || cached.env !== env) {
    const chunked = chunkedVerifier(config.chunkBudget);
    const verifier =
      config.verifier === 'inline'
        ? inlineVerifier()
        : config.verifier === 'edge' && config.verifyUrl && config.verifySecret
          ? edgeVerifier({ url: config.verifyUrl, secret: config.verifySecret, fallback: chunked })
          : chunked;
    cached = {
      env,
      verifyToken: createTokenVerifier({ supabaseUrl: config.supabaseUrl, jwtSecret: config.jwtSecret }),
      verifier,
    };
  }
  const url = env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL;
  return {
    config,
    createSql: () => {
      if (!url) throw new Error('No database configured (HYPERDRIVE or DATABASE_URL)');
      return createSql({ url, prepare: env.DB_PREPARE !== 'false' });
    },
    gotrue: (clientIp) =>
      createGoTrueClient({
        url: config.supabaseUrl,
        apiKey: config.publishableKey,
        ...(clientIp ? { clientIp } : {}),
      }),
    verifyToken: cached.verifyToken,
    verifier: cached.verifier,
    now: () => Date.now(),
    randomBytes: (n) => crypto.getRandomValues(new Uint8Array(n)),
    defer: (p) => ctx.waitUntil(p),
  };
}

const app = createApp((c: Context) => depsFor(c.env as Env, c.executionCtx));

export default {
  fetch(request: Request, env: Env, ctx: ExecCtx) {
    return app.fetch(request, env, ctx as never);
  },
  async scheduled(event: { cron: string; scheduledTime: number }, env: Env, ctx: ExecCtx) {
    ctx.waitUntil(runCron(depsFor(env, ctx), event.cron));
  },
};
