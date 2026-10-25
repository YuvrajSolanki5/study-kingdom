// Sets the app version everywhere it appears.  node scripts/release/bump-version.mjs 0.2.0
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) {
  console.error('usage: npm run release:version -- <major.minor.patch>');
  process.exit(2);
}
const root = join(import.meta.dirname, '../..');
const edit = (file, fn) => {
  const p = join(root, file);
  writeFileSync(p, fn(readFileSync(p, 'utf8')));
  console.log(`updated ${file}`);
};
for (const f of ['package.json', 'apps/desktop/package.json'])
  edit(f, (s) => s.replace(/"version": "[^"]+"/, `"version": "${version}"`));
edit('apps/desktop/src-tauri/tauri.conf.json', (s) =>
  s.replace(/"version": "[^"]+"/, `"version": "${version}"`),
);
edit('apps/server/wrangler.jsonc', (s) => s.replace(/"APP_VERSION": "[^"]+"/, `"APP_VERSION": "${version}"`));
edit('apps/desktop/src-tauri/Cargo.toml', (s) => s.replace(/^version = "[^"]+"/m, `version = "${version}"`));
console.log(
  `\nNext: commit, then tag and push:\n  git commit -am "Release v${version}" && git tag v${version} && git push --follow-tags`,
);
console.log(`Or build and publish from this Mac:  npm run release:local`);
