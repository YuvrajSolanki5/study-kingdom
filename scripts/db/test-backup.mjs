// Real encrypted pg_dump / pg_restore drill in two disposable databases.
import postgres from 'postgres';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { initialAggregate } from '../../packages/rules/src/initial.ts';
import { getContent } from '../../packages/content/src/index.ts';
const url = process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:54329/postgres';
const admin = postgres(url, { onnotice: () => undefined });
const prefix = `sk_restore_${Date.now()}`,
  names = [`${prefix}_source`, `${prefix}_target`];
const temp = mkdtempSync(join(tmpdir(), 'sk-backup-'));
const key = join(temp, 'key'),
  archive = join(temp, 'backup.skbak');
writeFileSync(key, randomBytes(32), { mode: 0o600 });
const dbs = [];
function script(name, env, file = archive) {
  return spawnSync('bash', [`scripts/db/${name}.sh`, file], {
    encoding: 'utf8',
    env: { ...process.env, ...env, BACKUP_KEY_FILE: key },
  });
}
function connection(name) {
  const u = new URL(url);
  u.pathname = `/${name}`;
  if (process.env.PGTOOLS_CONTAINER) {
    u.hostname = '127.0.0.1';
    u.port = '5432';
  }
  return u.toString();
}
try {
  for (const name of names) {
    await admin.unsafe(`create database ${name}`);
    const u = new URL(url);
    u.pathname = `/${name}`;
    const db = postgres(u.toString(), { onnotice: () => undefined });
    dbs.push(db);
    await db.unsafe(readFileSync('supabase/tests/plain-postgres-shim.sql', 'utf8'));
    for (const file of readdirSync('supabase/migrations')
      .filter((f) => f.endsWith('.sql'))
      .sort())
      await db.unsafe(readFileSync(`supabase/migrations/${file}`, 'utf8'));
  }
  const [source, target] = dbs,
    uid = randomUUID(),
    agg = initialAggregate(getContent());
  await source`insert into auth.users(id,email) values (${uid},'restore-test@example.com')`;
  await source`insert into game.players(user_id,display_name,friend_code,gold,essence,state,content_version) values (${uid},'Restore Test','TESTBACK',${agg.gold},${agg.essence},${source.json(agg.state)},'1')`;
  await source`insert into game.ledger(user_id,resource,amount,balance_after,reason,idempotency_key) values (${uid},'gold',750,750,'initial','initial:gold'),(${uid},'essence',250,250,'initial','initial:essence')`;
  await source`insert into game.clans(name) values ('Recovery clan')`;
  const backup = script('backup', { DATABASE_URL: connection(names[0]) });
  if (backup.status !== 0) throw new Error(backup.stderr);
  // Tampered archives are rejected before any target rows are written.
  const bytes = readFileSync(archive);
  bytes[bytes.length - 1] ^= 1;
  const tampered = join(temp, 'tampered.skbak');
  writeFileSync(tampered, bytes);
  if (script('restore', { RESTORE_DATABASE_URL: connection(names[1]) }, tampered).status === 0)
    throw new Error('Tampered backup was accepted');
  if ((await target`select * from game.players`).length) throw new Error('Failed decryption changed target');
  const restored = script('restore', { RESTORE_DATABASE_URL: connection(names[1]) });
  if (restored.status !== 0) throw new Error(restored.stderr);
  const rows = await source`select tablename from pg_tables where schemaname='game' order by tablename`;
  for (const { tablename } of rows) {
    const a = await source.unsafe(
        `select to_jsonb(t) as row from game."${tablename}" t order by to_jsonb(t)::text`,
      ),
      b = await target.unsafe(
        `select to_jsonb(t) as row from game."${tablename}" t order by to_jsonb(t)::text`,
      );
    if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`Restore differs: ${tablename}`);
  }
  if ((await target`select * from auth.users where id=${uid}`).length !== 1)
    throw new Error('Account missing');
  if ((await target`select * from game.ledger_mismatches`).length) throw new Error('Ledger mismatch');
  if (script('restore', { RESTORE_DATABASE_URL: connection(names[1]) }).status === 0)
    throw new Error('Populated target accepted');
  console.log(
    'PASS: encrypted backup, authenticated restore, account/game equality, ledger reconciliation, tamper and overwrite protection',
  );
} finally {
  for (const db of dbs) await db.end();
  for (const name of names) await admin.unsafe(`drop database if exists ${name} with (force)`);
  await admin.end();
  rmSync(temp, { recursive: true, force: true });
}
