import {
  createLocalJWKSet,
  createRemoteJWKSet,
  jwtVerify,
  type JSONWebKeySet,
  type JWTVerifyGetKey,
} from 'jose';
import { unauthorized } from '../errors.ts';
import { usernameFromAddress } from './username.ts';

export interface AuthClaims {
  sub: string;
  username: string;
  sessionId: string | null;
  exp: number;
  /** Supabase user_metadata (e.g. display_name chosen at sign-up). */
  meta: Record<string, unknown>;
}

export type TokenVerifier = (token: string) => Promise<AuthClaims>;

// Keyed by JWKS URL so a warm isolate reuses fetched signing keys.
const remoteSets = new Map<string, JWTVerifyGetKey>();

/**
 * Verifies Supabase Auth access tokens locally. Asymmetric signing keys
 * (JWKS) are preferred; projects still on the legacy shared secret can supply
 * it instead.
 */
export function createTokenVerifier(opts: {
  supabaseUrl: string;
  jwtSecret?: string | null;
  jwks?: JSONWebKeySet;
}): TokenVerifier {
  const issuer = `${opts.supabaseUrl}/auth/v1`;
  const secret = opts.jwtSecret ? new TextEncoder().encode(opts.jwtSecret) : null;
  let keys: JWTVerifyGetKey | null = null;
  if (opts.jwks) keys = createLocalJWKSet(opts.jwks);
  else if (!secret) {
    const url = `${issuer}/.well-known/jwks.json`;
    keys =
      remoteSets.get(url) ??
      createRemoteJWKSet(new URL(url), { cooldownDuration: 60_000, cacheMaxAge: 600_000 });
    remoteSets.set(url, keys);
  }
  return async (token) => {
    try {
      const options = { issuer, audience: 'authenticated' };
      const { payload } = secret
        ? await jwtVerify(token, secret, { ...options, algorithms: ['HS256'] })
        : await jwtVerify(token, keys!, { ...options, algorithms: ['ES256', 'RS256', 'EdDSA'] });
      if (typeof payload.sub !== 'string' || payload.role !== 'authenticated') throw new Error('bad claims');
      const username = usernameFromAddress(typeof payload.email === 'string' ? payload.email : undefined);
      if (!username) throw new Error('bad account identifier');
      return {
        sub: payload.sub,
        username,
        sessionId: typeof payload.session_id === 'string' ? payload.session_id : null,
        exp: payload.exp ?? 0,
        meta:
          payload.user_metadata && typeof payload.user_metadata === 'object'
            ? (payload.user_metadata as Record<string, unknown>)
            : {},
      };
    } catch {
      throw unauthorized('Your session has expired');
    }
  };
}
