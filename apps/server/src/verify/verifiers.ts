import { runBattle, runBattleChunk, type BattleResult } from '@sk/sim';
import type { BattleVerifier } from './types.ts';

/** Runs the whole battle in-process. For local development and tests (no CPU limit). */
export function inlineVerifier(): BattleVerifier {
  return {
    name: 'inline',
    async verify(setup, commands) {
      return { status: 'done', result: runBattle(setup, commands), via: 'inline' };
    },
  };
}

/**
 * Runs a bounded slice of the battle per invocation and returns a checkpoint
 * when unfinished, keeping each Worker invocation within the free-plan CPU
 * limit. Resuming yields exactly the same outcome as a single run.
 */
export function chunkedVerifier(workBudget: number): BattleVerifier {
  return {
    name: 'chunked',
    async verify(setup, commands, checkpoint) {
      const r = runBattleChunk(setup, commands, checkpoint, workBudget);
      if (r.done && r.result) return { status: 'done', result: r.result, via: 'chunked' };
      return { status: 'pending', checkpoint: r.state, work: r.work, via: 'chunked' };
    },
  };
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)));
  return [...sig].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export { hmacHex };

/**
 * Sends the battle to the Supabase Edge Function (2 s CPU budget on the free
 * plan), signed with a shared secret. Falls back to `fallback` when the
 * function is unreachable or runs a different simulation version.
 */
export function edgeVerifier(opts: {
  url: string;
  secret: string;
  fallback: BattleVerifier;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): BattleVerifier {
  const doFetch = opts.fetch ?? fetch;
  return {
    name: 'edge',
    async verify(setup, commands, checkpoint) {
      if (checkpoint) return opts.fallback.verify(setup, commands, checkpoint);
      const body = JSON.stringify({ setup, commands });
      const ts = String(Date.now());
      try {
        const res = await doFetch(opts.url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-sk-timestamp': ts,
            'x-sk-signature': await hmacHex(opts.secret, `${ts}.${body}`),
          },
          body,
          signal: AbortSignal.timeout(opts.timeoutMs ?? 8000),
        });
        if (!res.ok) throw new Error(`verify function returned ${res.status}`);
        const out = (await res.json()) as { simVersion: number; result: BattleResult };
        if (out.simVersion !== setup.simVersion || typeof out.result?.hash !== 'string')
          throw new Error(`verify function sim version ${out.simVersion} != ${setup.simVersion}`);
        return { status: 'done', result: out.result, via: 'edge' };
      } catch (e) {
        console.warn('edge verification failed; falling back', String(e));
        return opts.fallback.verify(setup, commands, null);
      }
    },
  };
}
