// Writes apps/desktop/src-tauri/tauri.release.conf.json, merged over
// tauri.conf.json at build time (`tauri build --config`). It injects the
// updater public key, the HTTPS manifest endpoint and the API origin.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '../..');
const cfg = JSON.parse(readFileSync(join(root, 'release.config.json'), 'utf8'));
const repo = process.env.GITHUB_REPOSITORY || cfg.githubRepo;
const apiUrl = (process.env.SK_API_URL || cfg.apiUrl).replace(/\/$/, '');
const pubkey = process.env.TAURI_UPDATER_PUBKEY || cfg.updaterPubkey;
if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || repo === 'OWNER/REPO')
  throw new Error('Set githubRepo in release.config.json');
if (!apiUrl.startsWith('https://')) throw new Error('apiUrl must be https:// for release builds');
if (!pubkey || pubkey.includes('REPLACE'))
  throw new Error('Run scripts/release/updater-key.sh and set updaterPubkey');

const base = JSON.parse(readFileSync(join(root, 'apps/desktop/src-tauri/tauri.conf.json'), 'utf8'));
const csp = base.app.security.csp.replace(
  /connect-src [^;]*/,
  `connect-src 'self' ipc: http://ipc.localhost ${new URL(apiUrl).origin}`,
);
const overlay = {
  identifier: cfg.bundleIdentifier,
  app: { security: { csp } },
  plugins: {
    updater: {
      pubkey,
      // Static manifest attached to the newest GitHub Release, served over HTTPS.
      endpoints: [`https://github.com/${repo}/releases/latest/download/latest.json`],
    },
  },
};
const out = join(root, 'apps/desktop/src-tauri/tauri.release.conf.json');
writeFileSync(out, `${JSON.stringify(overlay, null, 2)}\n`);
console.log(out);
