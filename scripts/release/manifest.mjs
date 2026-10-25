// Writes latest.json — the static update manifest the Tauri updater fetches
// over HTTPS from the newest GitHub Release.
//   node scripts/release/manifest.mjs <artifact-dir> <version>
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [dir, version] = process.argv.slice(2);
if (!dir || !version) throw new Error('usage: manifest.mjs <dir> <version>');
const root = join(import.meta.dirname, '../..');
const cfg = JSON.parse(readFileSync(join(root, 'release.config.json'), 'utf8'));
const repo = process.env.GITHUB_REPOSITORY || cfg.githubRepo;
const notesFile = join(root, 'release-notes.md');
const notes =
  process.env.RELEASE_NOTES ||
  (existsSync(notesFile) ? readFileSync(notesFile, 'utf8').trim() : `Study Kingdom ${version}`);
const platforms = {};
for (const [arch, key] of [
  ['aarch64', 'darwin-aarch64'],
  ['x86_64', 'darwin-x86_64'],
]) {
  const file = `StudyKingdom_${version}_${arch}.app.tar.gz`;
  if (!existsSync(join(dir, file))) continue;
  platforms[key] = {
    signature: readFileSync(join(dir, `${file}.sig`), 'utf8').trim(),
    url: `https://github.com/${repo}/releases/download/v${version}/${file}`,
  };
}
if (!Object.keys(platforms).length) throw new Error(`no updater bundles found in ${dir}`);
const manifest = { version, notes, pub_date: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), platforms };
writeFileSync(join(dir, 'latest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`latest.json: ${Object.keys(platforms).join(', ')}`);
