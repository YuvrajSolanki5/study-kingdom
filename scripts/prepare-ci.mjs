// Fresh CI checkout only. Do not overwrite a developer's local configuration.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
if (!process.env.CI) throw new Error('This helper is for a fresh CI checkout');
for (const path of ['apps/server/.dev.vars', 'supabase/functions/.env'])
  if (existsSync(path)) throw new Error(`Refusing to overwrite ${path}`);
const status = spawnSync('npx', ['supabase', 'status', '-o', 'json'], { encoding: 'utf8' });
if (status.status !== 0) throw new Error('Local Supabase is not ready');
const values = JSON.parse(status.stdout),
  key = values.PUBLISHABLE_KEY ?? values.ANON_KEY;
if (!key) throw new Error('Supabase status did not return an API key');
writeFileSync(
  'apps/server/.dev.vars',
  readFileSync('apps/server/.dev.vars.example', 'utf8').replace(
    /^SUPABASE_PUBLISHABLE_KEY=.*$/m,
    `SUPABASE_PUBLISHABLE_KEY=${key}`,
  ),
  { mode: 0o600 },
);
writeFileSync('supabase/functions/.env', `VERIFY_SHARED_SECRET=${randomBytes(32).toString('hex')}\n`, {
  mode: 0o600,
});
console.log('Prepared private local CI configuration');
