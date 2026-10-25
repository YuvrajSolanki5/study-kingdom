// Run against the local Edge Function without printing the HMAC secret.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const file = readFileSync('supabase/functions/.env', 'utf8');
const secret = file
  .split(/\r?\n/)
  .find((l) => l.startsWith('VERIFY_SHARED_SECRET='))
  ?.slice('VERIFY_SHARED_SECRET='.length);
if (!secret) throw new Error('Set VERIFY_SHARED_SECRET in supabase/functions/.env');
const url = process.env.VERIFY_FUNCTION_URL ?? 'http://127.0.0.1:54321/functions/v1/verify-battle';
let ready = false;
for (let i = 0; i < 20; i++) {
  try {
    const r = await fetch(url, { method: 'POST', body: '{}' });
    if (r.status === 401) {
      ready = true;
      break;
    }
  } catch {
    /* Starting up. */
  }
  await new Promise((r) => setTimeout(r, 1000));
}
if (!ready) throw new Error('Local Edge Function did not become ready');
const result = spawnSync('npm', ['run', 'test:edge'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    VERIFY_SHARED_SECRET: secret,
    VERIFY_FUNCTION_URL:
      process.env.VERIFY_FUNCTION_URL ?? 'http://127.0.0.1:54321/functions/v1/verify-battle',
  },
});
process.exitCode = result.status ?? 1;
