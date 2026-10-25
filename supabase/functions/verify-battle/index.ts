// Supabase Edge Function: re-simulates a submitted battle with the shared
// combat simulation. Called only by the Worker API, which signs each request
// with VERIFY_SHARED_SECRET. Deploy with `npm run deploy:edge`.
//
// Why here: Workers Free allows 10 ms of CPU per request, while large battles
// need tens of milliseconds; Edge Functions on the Supabase free plan allow
// 2 s of CPU per request (500k invocations/month).
import { runBattle, SIM_VERSION, validateCommands } from './sim.bundle.js';

const MAX_SKEW_MS = 5 * 60_000;
const encoder = new TextEncoder();

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
  return [...sig].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function equal(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const secret = Deno.env.get('VERIFY_SHARED_SECRET');
  if (!secret) return new Response('Not configured', { status: 500 });
  const ts = req.headers.get('x-sk-timestamp') ?? '';
  const sig = req.headers.get('x-sk-signature') ?? '';
  const body = await req.text();
  if (!ts || Math.abs(Date.now() - Number(ts)) > MAX_SKEW_MS)
    return new Response('Stale request', { status: 401 });
  if (!equal(sig, await hmacHex(secret, `${ts}.${body}`)))
    return new Response('Bad signature', { status: 401 });
  let payload: { setup: Parameters<typeof runBattle>[0]; commands: Parameters<typeof runBattle>[1] };
  try {
    payload = JSON.parse(body);
  } catch {
    return new Response('Bad JSON', { status: 400 });
  }
  const check = validateCommands(payload.setup, payload.commands);
  if (!check.ok) return Response.json({ simVersion: SIM_VERSION, error: check.error }, { status: 422 });
  const started = performance.now();
  const result = runBattle(payload.setup, payload.commands);
  return Response.json({
    simVersion: payload.setup.simVersion,
    result,
    ms: Math.round(performance.now() - started),
  });
});
