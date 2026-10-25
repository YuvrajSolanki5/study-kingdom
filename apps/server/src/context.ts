import type { GoTrueClient } from './auth/gotrue.ts';
import type { AuthClaims, TokenVerifier } from './auth/tokens.ts';
import type { Sql } from './db.ts';
import type { Config } from './env.ts';
import type { BattleVerifier } from './verify/types.ts';

/** Everything the app needs from the outside world; replaced with fakes in tests. */
export interface Deps {
  config: Config;
  createSql: () => Sql;
  gotrue: (clientIp: string | undefined) => GoTrueClient;
  verifyToken: TokenVerifier;
  verifier: BattleVerifier;
  now: () => number;
  randomBytes: (n: number) => Uint8Array;
  /** Background work that must finish after the response (ctx.waitUntil in Workers). */
  defer: (p: Promise<unknown>) => void;
}

export interface AuthUser extends AuthClaims {
  /** How the token arrived: cookie (web) or bearer (desktop). */
  via: 'cookie' | 'bearer';
  accessToken: string;
}

export type AppEnv = {
  Variables: {
    deps: Deps;
    sql: Sql;
    user: AuthUser;
    requestId: string;
  };
};
