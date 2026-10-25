// Owner-only reset for a trusted player's forgotten password. No email is sent.
// node --env-file=.env.production scripts/supabase/reset-password.mjs USERNAME /private/path/password.txt
import { randomBytes } from 'node:crypto';
import { openSync, writeFileSync, closeSync, unlinkSync } from 'node:fs';
const [input, output] = process.argv.slice(2);
const username = input?.trim().toLowerCase();
if (!username || !/^[a-z0-9][a-z0-9_]{2,23}$/.test(username) || !output)
  throw new Error('Usage: reset-password.mjs USERNAME PRIVATE_OUTPUT_FILE');
const base = process.env.SUPABASE_URL,
  key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!base?.startsWith('https://') || !key)
  throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY privately');
const headers = { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' };
const address = `${username}@accounts.studykingdom.invalid`;
let user;
for (let page = 1; !user; page++) {
  const res = await fetch(`${base}/auth/v1/admin/users?page=${page}&per_page=200`, { headers });
  if (!res.ok) throw new Error(`Account lookup failed (HTTP ${res.status})`);
  const users = (await res.json()).users;
  user = users.find((u) => u.email === address);
  if (!user && users.length < 200) throw new Error('Username not found');
}
// Refuse to overwrite any existing file before changing the password.
const fd = openSync(output, 'wx', 0o600);
const password = randomBytes(18).toString('base64url');
try {
  const res = await fetch(`${base}/auth/v1/admin/users/${user.id}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ password }),
  });
  if (!res.ok) throw new Error(`Password reset failed (HTTP ${res.status})`);
  writeFileSync(fd, `${password}\n`);
  console.log(
    `Temporary password saved privately to ${output}. Give it directly to the player, who can change it in Settings.`,
  );
} catch (e) {
  unlinkSync(output);
  throw e;
} finally {
  closeSync(fd);
}
