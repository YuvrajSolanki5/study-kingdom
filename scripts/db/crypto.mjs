// Authenticated, streaming AES-256-GCM archives. Key material never enters argv.
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import {
  createReadStream,
  createWriteStream,
  openSync,
  readFileSync,
  readSync,
  closeSync,
  statSync,
  appendFileSync,
  unlinkSync,
} from 'node:fs';
import { pipeline } from 'node:stream/promises';
const [mode, input, output] = process.argv.slice(2);
const keyFile = process.env.BACKUP_KEY_FILE;
if (!keyFile) throw new Error('Set BACKUP_KEY_FILE to a private file containing at least 32 bytes');
const pass = readFileSync(keyFile);
if (pass.length < 32) throw new Error('Backup key must contain at least 32 bytes');
const magic = Buffer.from('SKBAK1');
if (mode === 'encrypt') {
  const salt = randomBytes(16),
    iv = randomBytes(12),
    key = scryptSync(pass, salt, 32);
  const cipher = createCipheriv('aes-256-gcm', key, iv),
    header = Buffer.concat([magic, salt, iv]);
  cipher.setAAD(header);
  const stream = createWriteStream(input, { flags: 'wx', mode: 0o600 });
  let created = false;
  stream.once('open', () => {
    created = true;
  });
  stream.write(header);
  try {
    await pipeline(process.stdin, cipher, stream);
    appendFileSync(input, cipher.getAuthTag());
  } catch (e) {
    try {
      if (created) unlinkSync(input);
    } catch {
      /* File may already be removed. */
    }
    throw e;
  }
} else if (mode === 'decrypt') {
  const size = statSync(input).size;
  if (size < 50) throw new Error('Invalid backup');
  const fd = openSync(input, 'r'),
    header = Buffer.alloc(34),
    tag = Buffer.alloc(16);
  readSync(fd, header, 0, 34, 0);
  readSync(fd, tag, 0, 16, size - 16);
  closeSync(fd);
  if (!header.subarray(0, 6).equals(magic)) throw new Error('Unsupported backup format');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    scryptSync(pass, header.subarray(6, 22), 32),
    header.subarray(22, 34),
  );
  decipher.setAAD(header);
  decipher.setAuthTag(tag);
  let created = false;
  const destination = createWriteStream(output, { flags: 'wx', mode: 0o600 });
  destination.once('open', () => {
    created = true;
  });
  try {
    await pipeline(createReadStream(input, { start: 34, end: size - 17 }), decipher, destination);
  } catch (e) {
    try {
      if (created) unlinkSync(output);
    } catch {
      /* File may already be removed. */
    }
    throw e;
  }
} else throw new Error('Usage: crypto.mjs encrypt OUTPUT | decrypt INPUT OUTPUT');
