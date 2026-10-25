// Consistent game + account export for backup.sh, and its inverse for restore.sh.
// One read-only transaction exports a snapshot; pg_dump and the account COPYs
// all read it, so every account referenced by game rows is present.
//   archive.mjs export              DATABASE_URL → framed stream on stdout
//   archive.mjs extract FILE DIR    → DIR/game.dump, DIR/auth.<table>.csv
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { closeSync, openSync, readSync, writeSync } from 'node:fs';
import { join } from 'node:path';

const magic = Buffer.from('SKARCH1\n');
const accounts = ['users', 'identities'];
const common = join(import.meta.dirname, 'common.sh');
const [mode, ...args] = process.argv.slice(2);

// Same container/host resolution as the shell scripts.
function tool(...argv) {
  const child = spawn(
    'bash',
    ['-c', 'source "$1"; shift; pg_tool "$DATABASE_URL" "$@"', 'bash', common, ...argv],
    {
      stdio: ['pipe', 'pipe', 'inherit'],
    },
  );
  child.closed = new Promise((resolve) => child.on('close', (code) => resolve(code)));
  return child;
}
async function finished(child, what) {
  const code = await child.closed;
  if (code !== 0) throw new Error(`${what} failed (${code})`);
}
async function emit(buf) {
  if (!process.stdout.write(buf)) await once(process.stdout, 'drain');
}
async function section(name, child) {
  const label = Buffer.from(name),
    head = Buffer.alloc(2);
  head.writeUInt16BE(label.length);
  await emit(Buffer.concat([head, label]));
  for await (const chunk of child.stdout) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(chunk.length);
    await emit(Buffer.concat([len, chunk]));
  }
  await emit(Buffer.alloc(4));
  await finished(child, name);
}

async function exportArchive() {
  if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL');
  const holder = tool('psql', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1');
  try {
    holder.stdin.write('begin isolation level repeatable read, read only;\nselect pg_export_snapshot();\n');
    const first = await Promise.race([
      once(holder.stdout, 'data').then(([d]) => d.toString()),
      holder.closed.then(() => ''),
    ]);
    const snapshot = first.trim();
    if (!/^[0-9A-F]+(-[0-9A-F]+)+$/i.test(snapshot)) throw new Error('Could not export a snapshot');
    await emit(magic);
    await section(
      'game.dump',
      tool(
        'pg_dump',
        '--format=custom',
        '--data-only',
        '--no-owner',
        '--no-acl',
        '--enable-row-security',
        `--snapshot=${snapshot}`,
        '--table=game.*',
      ),
    );
    for (const table of accounts) {
      const copy = tool('psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1');
      // Generated columns cannot be restored with COPY; catalog lookups avoid
      // needing usage on the auth schema itself.
      copy.stdin.end(`begin isolation level repeatable read, read only;
set transaction snapshot '${snapshot}';
select string_agg(quote_ident(a.attname), ',' order by a.attnum) as cols
  from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'auth' and c.relname = '${table}' and a.attnum > 0 and not a.attisdropped and a.attgenerated = '' \\gset
copy (select :cols from backup_accounts.${table}()) to stdout with (format csv, header);
commit;
`);
      await section(`auth.${table}.csv`, copy);
    }
    await emit(Buffer.alloc(2));
    holder.stdin.end('commit;\n');
    await finished(holder, 'snapshot transaction');
  } catch (e) {
    holder.kill();
    throw e;
  }
}

function extractArchive(file, dir) {
  const fd = openSync(file, 'r');
  let pos = 0;
  const read = (n) => {
    const buf = Buffer.alloc(n);
    let got = 0;
    while (got < n) {
      const r = readSync(fd, buf, got, n - got, pos + got);
      if (!r) throw new Error('Truncated archive');
      got += r;
    }
    pos += n;
    return buf;
  };
  try {
    if (!read(magic.length).equals(magic)) throw new Error('Not a Study Kingdom archive');
    const expected = ['game.dump', ...accounts.map((t) => `auth.${t}.csv`)],
      seen = [];
    for (;;) {
      const name = read(read(2).readUInt16BE()).toString();
      if (!name) break;
      if (!expected.includes(name) || seen.includes(name)) throw new Error(`Unexpected section ${name}`);
      seen.push(name);
      const out = openSync(join(dir, name), 'wx', 0o600);
      try {
        for (let len; (len = read(4).readUInt32BE());) writeSync(out, read(len));
      } finally {
        closeSync(out);
      }
    }
    if (seen.length !== expected.length) throw new Error('Archive is missing sections');
  } finally {
    closeSync(fd);
  }
}

if (mode === 'export') await exportArchive();
else if (mode === 'extract' && args.length === 2) extractArchive(args[0], args[1]);
else {
  console.error('usage: archive.mjs export | extract FILE DIR');
  process.exit(2);
}
