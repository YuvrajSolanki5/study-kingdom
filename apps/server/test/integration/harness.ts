import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';
import { createApp } from '../../src/app.ts';
import { createGoTrueClient } from '../../src/auth/gotrue.ts';
import { createTokenVerifier } from '../../src/auth/tokens.ts';
import type { Deps } from '../../src/context.ts';
import { createSql } from '../../src/db.ts';
import { readConfig } from '../../src/env.ts';
import type { BattleVerifier } from '../../src/verify/types.ts';
import { inlineVerifier } from '../../src/verify/verifiers.ts';
import { createFakeGoTrue, type FakeGoTrue } from './fake-gotrue.ts';

const ROOT = join(import.meta.dirname, '../../../..');
const ADMIN_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:54329/postgres';
export const SITE = 'http://localhost:5173';
const SUPABASE = 'http://supabase.test';

export interface Harness {
  app: ReturnType<typeof createApp>;
  deps: Deps;
  gotrue: FakeGoTrue;
  admin: postgres.Sql;
  db: postgres.Sql;
  clock: { now: number; advance(ms: number): void };
  pending: Promise<unknown>[];
  setVerifier(v: BattleVerifier): void;
  close(): Promise<void>;
}

/** Fresh database with all migrations applied, plus the app wired to fakes. */
export async function createHarness(opts: { confirmEmail?: boolean } = {}): Promise<Harness> {
  const dbName = `sk_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const root = postgres(ADMIN_URL, { max: 1, onnotice: () => undefined });
  await root.unsafe(`create database ${dbName}`);
  await root.end();
  const adminUrl = ADMIN_URL.replace(/\/[^/]*$/, `/${dbName}`);
  const admin = postgres(adminUrl, { max: 2, onnotice: () => undefined });
  await admin.unsafe(readFileSync(join(ROOT, 'supabase/tests/plain-postgres-shim.sql'), 'utf8'));
  const migrations = readdirSync(join(ROOT, 'supabase/migrations'))
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const m of migrations) await admin.unsafe(readFileSync(join(ROOT, 'supabase/migrations', m), 'utf8'));
  await admin.unsafe(`alter role game_api with password 'test-password'`);
  const u = new URL(adminUrl);
  u.username = 'game_api';
  u.password = 'test-password';
  const apiUrl = u.toString();

  const gotrue = await createFakeGoTrue(SUPABASE, {
    ...opts,
    onUser: async (user) => {
      await admin`insert into auth.users (id, email) values (${user.id}, ${user.email})`;
    },
  });
  const clock = {
    now: Date.UTC(2026, 9, 5, 9, 0, 0),
    advance(ms: number) {
      this.now += ms;
    },
  };
  const pending: Promise<unknown>[] = [];
  let verifier: BattleVerifier = inlineVerifier();
  const config = readConfig({
    SUPABASE_URL: SUPABASE,
    SUPABASE_PUBLISHABLE_KEY: 'test-publishable-key',
    SITE_URL: SITE,
    ALLOWED_ORIGINS: 'tauri://localhost',
    ENVIRONMENT: 'test',
  });
  const verifyToken = createTokenVerifier({ supabaseUrl: SUPABASE, jwks: gotrue.jwks });
  const deps: Deps = {
    config,
    createSql: () => createSql({ url: apiUrl }),
    gotrue: () => createGoTrueClient({ url: SUPABASE, apiKey: 'test-publishable-key', fetch: gotrue.fetch }),
    verifyToken,
    get verifier() {
      return verifier;
    },
    now: () => clock.now,
    randomBytes: (n) => crypto.getRandomValues(new Uint8Array(n)),
    defer: (p) => pending.push(p),
  };
  const app = createApp(() => deps);
  const db = createSql({ url: apiUrl });
  return {
    app,
    deps,
    gotrue,
    admin,
    db,
    clock,
    pending,
    setVerifier(v) {
      verifier = v;
    },
    async close() {
      await Promise.allSettled(pending);
      await db.end();
      await admin.end();
      const r = postgres(ADMIN_URL, { max: 1, onnotice: () => undefined });
      await r.unsafe(`drop database if exists ${dbName} with (force)`);
      await r.end();
    },
  };
}

/** A browser-like client: cookie jar, same-origin Origin header. */
export class Client {
  cookies = new Map<string, string>();
  bearer: string | null = null;
  desktop = false;
  constructor(private h: Harness) {}

  async req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const h: Record<string, string> = { ...headers };
    if (body !== undefined) h['content-type'] = 'application/json';
    if (!('origin' in h) && method !== 'GET')
      h.origin = this.desktop ? 'tauri://localhost' : 'http://localhost';
    if (this.cookies.size) h.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    if (this.bearer) h.authorization = `Bearer ${this.bearer}`;
    if (this.desktop) h['x-client'] = 'desktop';
    const res = await this.h.app.request(`http://localhost${path}`, {
      method,
      headers: h,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    for (const sc of res.headers.getSetCookie()) {
      const [pair, ...attrs] = sc.split(';');
      const [k, v] = pair!.split('=');
      const expired = attrs.some(
        (a) => /max-age=0/i.test(a.trim()) || /expires=thu, 01 jan 1970/i.test(a.trim()),
      );
      if (expired || !v) this.cookies.delete(k!.trim());
      else this.cookies.set(k!.trim(), v.trim());
    }
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
  }
  get = (p: string, headers?: Record<string, string>) => this.req('GET', p, undefined, headers);
  post = (p: string, b: unknown = {}, headers?: Record<string, string>) => this.req('POST', p, b, headers);
  put = (p: string, b: unknown = {}) => this.req('PUT', p, b);
}

let counter = 0;
/** Registers a fresh username account and returns a signed-in client. */
export async function signedInClient(h: Harness, name = 'Tester'): Promise<Client> {
  const c = new Client(h);
  const username = `user${++counter}_${Date.now()}`;
  const reg = await c.post('/api/auth/register', {
    username,
    password: 'correct-horse-battery',
    displayName: name,
  });
  if (reg.status !== 200) throw new Error(`register failed: ${JSON.stringify(reg.body)}`);
  const me = await c.get('/api/player');
  if (me.status !== 200) throw new Error(`player failed: ${JSON.stringify(me.body)}`);
  return c;
}

export const rid = () => crypto.randomUUID();
