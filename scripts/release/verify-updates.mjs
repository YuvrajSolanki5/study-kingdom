// Verify updater archives with the configured Minisign public key, including tamper rejection.
import { readFileSync } from 'node:fs';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { join } from 'node:path';
const dir = process.argv[2];
if (!dir) throw new Error('Usage: verify-updates.mjs RELEASE_DIRECTORY');
const config = JSON.parse(readFileSync(new URL('../../release.config.json', import.meta.url), 'utf8'));
const pub = Buffer.from(
  Buffer.from(config.updaterPubkey, 'base64').toString().trim().split('\n')[1],
  'base64',
);
if (pub.length !== 42) throw new Error('Invalid Minisign public key');
const key = createPublicKey({
  key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), pub.subarray(10)]),
  format: 'der',
  type: 'spki',
});
const manifest = JSON.parse(readFileSync(join(dir, 'latest.json'), 'utf8'));
for (const [platform, entry] of Object.entries(manifest.platforms)) {
  const url = new URL(entry.url);
  if (
    url.origin !== 'https://github.com' ||
    !url.pathname.startsWith(`/${config.githubRepo}/releases/download/v${manifest.version}/`)
  )
    throw new Error('Unexpected update URL');
  const bytes = readFileSync(join(dir, url.pathname.split('/').at(-1)));
  const lines = Buffer.from(entry.signature, 'base64').toString().trim().split('\n');
  const packet = Buffer.from(lines[1], 'base64'),
    globalSignature = Buffer.from(lines[3], 'base64');
  if (
    packet.length !== 74 ||
    !packet.subarray(2, 10).equals(pub.subarray(2, 10)) ||
    !lines[2].startsWith('trusted comment: ')
  )
    throw new Error('Malformed signature');
  const algorithm = packet.subarray(0, 2).toString();
  if (algorithm !== 'ED') throw new Error('Updater requires prehashed Minisign signatures');
  const payload = (data) => (algorithm === 'ED' ? createHash('blake2b512').update(data).digest() : data);
  const valid = (data) => verify(null, payload(data), key, packet.subarray(10));
  if (
    !valid(bytes) ||
    !verify(null, Buffer.concat([packet.subarray(10), Buffer.from(lines[2].slice(17))]), key, globalSignature)
  )
    throw new Error('Updater signature verification failed');
  const tampered = Buffer.from(bytes);
  tampered[tampered.length - 1] ^= 1;
  if (valid(tampered)) throw new Error('Tampered archive was accepted');
  console.log(`PASS: ${platform} archive signature, trusted comment and tamper rejection.`);
}
