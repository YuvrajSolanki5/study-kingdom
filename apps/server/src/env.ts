/** Worker bindings and configuration. Secrets are set with `wrangler secret put`. */
export interface Env {
  ASSETS?: { fetch(req: Request): Promise<Response> };
  HYPERDRIVE?: { connectionString: string };
  /** Postgres connection string when Hyperdrive is not configured (Supabase pooler). */
  DATABASE_URL?: string;
  /** "false" when connecting through a transaction-mode pooler. */
  DB_PREPARE?: string;
  SUPABASE_URL: string;
  /** Publishable (formerly anon) key, sent as `apikey` to Supabase Auth. */
  SUPABASE_PUBLISHABLE_KEY: string;
  /** Only for projects still on the legacy shared HS256 JWT secret. */
  SUPABASE_JWT_SECRET?: string;
  /** Public web origin, used for email links and CSRF checks. */
  SITE_URL: string;
  /** Extra allowed origins, comma separated (Tauri webview, local dev). */
  ALLOWED_ORIGINS?: string;
  ENVIRONMENT?: 'development' | 'production' | 'test';
  /** Battle verification strategy: edge (Supabase Edge Function), inline, or chunked. */
  VERIFIER?: 'edge' | 'inline' | 'chunked';
  VERIFY_FUNCTION_URL?: string;
  VERIFY_SHARED_SECRET?: string;
  /** Deterministic work units per chunk when verifying inside the Worker. */
  VERIFY_CHUNK_BUDGET?: string;
  APP_VERSION?: string;
}

export interface Config {
  supabaseUrl: string;
  publishableKey: string;
  jwtSecret: string | null;
  siteUrl: string;
  allowedOrigins: Set<string>;
  production: boolean;
  verifier: 'edge' | 'inline' | 'chunked';
  verifyUrl: string | null;
  verifySecret: string | null;
  chunkBudget: number;
  appVersion: string;
}

export function readConfig(env: Env): Config {
  const siteUrl = (env.SITE_URL || 'http://localhost:8787').replace(/\/$/, '');
  const origins = new Set<string>([new URL(siteUrl).origin]);
  for (const o of (env.ALLOWED_ORIGINS ?? '').split(',')) if (o.trim()) origins.add(o.trim());
  const production = env.ENVIRONMENT === 'production';
  return {
    supabaseUrl: (env.SUPABASE_URL || '').replace(/\/$/, ''),
    publishableKey: env.SUPABASE_PUBLISHABLE_KEY || '',
    jwtSecret: env.SUPABASE_JWT_SECRET || null,
    siteUrl,
    allowedOrigins: origins,
    production,
    verifier: env.VERIFIER ?? (production ? 'edge' : 'inline'),
    verifyUrl: env.VERIFY_FUNCTION_URL || null,
    verifySecret: env.VERIFY_SHARED_SECRET || null,
    chunkBudget: Number(env.VERIFY_CHUNK_BUDGET) || 2500,
    appVersion: env.APP_VERSION || 'dev',
  };
}
