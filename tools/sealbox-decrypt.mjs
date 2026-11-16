#!/usr/bin/env node
/** Independent format-v1 reader. Bundle with build-recovery.mjs for offline use.
 * No imports from src/: interoperability tests check the two implementations.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { webcrypto as crypto } from 'node:crypto';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { basename } from 'node:path';
import process from 'node:process';

const HEADER_SIZE = 48;
const HELP = `SealBox local recovery (Node 22.18+ or 24+)
Usage: node sealbox-decrypt.mjs FILE.sealed [options]
  --keyring PATH           Keyring from the same vault
  --out PATH               Output file (never overwrites); default: original name
  --recovery               Read a recovery key instead of a master password
  --password-file PATH     Read password from a UTF-8 file (or pipe via stdin)
  --recovery-key-file PATH Read recovery key from a UTF-8 file; implies --recovery
  --help                   Show this help
Use --out - to send authenticated plaintext to stdout.
Interactive passwords and recovery keys are hidden. Originals are never modified.
Argon2id and cascade need bundled helpers; use the offline recovery release pack.
`;
function fail(message) { throw new Error(message); }
function parseArgs(argv) {
  const args = { file: null, keyring: null, passwordFile: null, recoveryFile: null, recovery: false, out: null };
  const options = { '--keyring': 'keyring', '--password-file': 'passwordFile', '--recovery-key-file': 'recoveryFile', '--out': 'out' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { process.stdout.write(HELP); return null; }
    if (a === '--recovery') { args.recovery = true; continue; }
    if (a in options) {
      if (!argv[i + 1] || argv[i + 1].startsWith('--')) fail(`missing value for ${a}`);
      if (args[options[a]] !== null) fail(`duplicate option ${a}`);
      args[options[a]] = argv[++i];
    } else if (a.startsWith('-')) fail(`unknown option ${a}`);
    else if (args.file) fail('only one input file is accepted');
    else args.file = a;
  }
  if (!args.file) fail('no input file given; use --help');
  args.recovery ||= Boolean(args.recoveryFile);
  if (args.recovery && args.passwordFile) fail('--recovery cannot be combined with --password-file');
  if (args.recovery && !args.keyring) fail('recovery requires --keyring from the original vault');
  return args;
}
function validateKdf(id, memory, time, lanes, iterations) {
  if (id === 1) {
    if (!Number.isInteger(memory) || memory < 8 || memory > 1048576 || !Number.isInteger(time) || time < 1 || time > 255 || !Number.isInteger(lanes) || lanes < 1 || lanes > 255 || memory < 8 * lanes) fail('invalid Argon2id parameters');
  } else if (id === 2) {
    if (!Number.isInteger(iterations) || iterations < 10000 || iterations > 20000000) fail('invalid PBKDF2 iteration count');
  } else fail(`unknown KDF id ${id}`);
}
function parseHeader(buf) {
  if (buf.length < HEADER_SIZE) fail('file is too short to be a container');
  if (buf.subarray(0, 6).toString('latin1') !== 'SEALED') fail('not a SealBox container');
  if (buf[6] !== 1) fail(`container format v${buf[6]} is not supported`);
  if ((buf[7] & ~3) || buf[11] || buf.readUInt32LE(44)) fail('unknown flags or nonzero reserved bytes');
  const h = { cascade: Boolean(buf[7] & 1), ownPassword: Boolean(buf[7] & 2), kdfId: buf[8], argonTime: buf[9], argonLanes: buf[10], kdfParam: buf.readUInt32LE(12), chunkKiB: buf.readUInt32LE(16), salt: buf.subarray(20, 36), noncePrefix: buf.subarray(36, 40), metaLen: buf.readUInt32LE(40) };
  if (h.chunkKiB < 16 || h.chunkKiB > 8192) fail('invalid chunk size');
  if (h.metaLen <= 16 || h.metaLen > 65536 || HEADER_SIZE + h.metaLen > buf.length) fail('invalid or truncated metadata');
  if (h.ownPassword) {
    validateKdf(h.kdfId, h.kdfParam, h.argonTime, h.argonLanes, h.kdfParam);
    if (h.kdfId === 2 && (h.argonTime || h.argonLanes)) fail('PBKDF2 header carries Argon2 parameters');
  } else if (h.kdfId || h.argonTime || h.argonLanes || h.kdfParam) fail('malformed header: vault-keyed file carries a KDF');
  return h;
}
function u64le(value) { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(value)); return b; }
async function hkdf(ikm, salt, info, length) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return Buffer.from(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: Buffer.from(info) }, key, length * 8));
}
async function derive(password, salt, id, memory, time, lanes, iterations) {
  validateKdf(id, memory, time, lanes, iterations);
  if (salt.length < 16) fail('KDF salt is too short');
  if (id === 1) {
    let argon2id;
    try { ({ argon2id } = await import('hash-wasm')); }
    catch { fail('Argon2id helper is missing. Use the bundled offline recovery pack, or run npm ci in the source repository.'); }
    return Buffer.from(await argon2id({ password, salt, memorySize: memory, iterations: time, parallelism: lanes, hashLength: 32, outputType: 'binary' }));
  }
  const key = await crypto.subtle.importKey('raw', password, 'PBKDF2', false, ['deriveBits']);
  return Buffer.from(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-512', salt, iterations }, key, 256));
}
async function readSecret(path, prompt) {
  if (path) {
    const raw = await readFile(path, 'utf8');
    return Buffer.from(raw.replace(/^\uFEFF/, '').replace(/\r?\n$/, ''), 'utf8');
  }
  const tty = Boolean(process.stdin.isTTY);
  // Readline handles editing and Ctrl-C; its output is discarded, so no secret
  // is echoed even when pasted into an interactive terminal.
  const muted = new Writable({ write(_chunk, _encoding, cb) { cb(); } });
  const rl = createInterface({ input: process.stdin, output: muted, terminal: tty });
  if (tty) process.stderr.write(prompt);
  rl.on('SIGINT', () => { rl.close(); process.exitCode = 130; });
  try {
    for await (const line of rl) return Buffer.from(line, 'utf8');
  } finally {
    rl.close();
    if (tty) process.stderr.write('\n');
  }
  fail('no password or recovery key given on stdin');
}
async function aesOpen(key, nonce, aad, cipher) {
  return Buffer.from(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce, additionalData: aad, tagLength: 128 }, key, cipher));
}
async function openBox(raw, box, label) {
  if (!box || typeof box.n !== 'string' || typeof box.c !== 'string') fail('damaged keyring box');
  const nonce = Buffer.from(box.n, 'base64');
  if (nonce.length !== 12) fail('damaged keyring nonce');
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
  return aesOpen(key, nonce, Buffer.from(label), Buffer.from(box.c, 'base64'));
}
async function recoveryBytes(secret) {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const clean = secret.toString('utf8').toUpperCase().replace(/[\s-]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');
  if (clean.length !== 55) fail('recovery key must contain 55 base32 characters');
  let acc = 0, bits = 0;
  const bytes = [];
  for (const ch of clean) {
    const v = alphabet.indexOf(ch);
    if (v < 0) fail('invalid character in recovery key');
    acc = (acc << 5) | v; bits += 5;
    if (bits >= 8) { bits -= 8; bytes.push((acc >>> bits) & 255); }
  }
  if ((acc & ((1 << bits) - 1)) !== 0) fail('invalid recovery key padding');
  const payload = Buffer.from(bytes), raw = payload.subarray(0, 32);
  const digest = Buffer.from(await crypto.subtle.digest('SHA-256', raw));
  if (payload[32] !== digest[0] || payload[33] !== digest[1]) { payload.fill(0); fail('recovery key checksum mismatch'); }
  return { raw, payload };
}
async function masterKeyFromKeyring(path, secret, recovery) {
  const file = JSON.parse(await readFile(path, 'utf8'));
  if (file.sealbox !== 1) fail('unsupported keyring version');
  let kek, decoded;
  try {
    if (recovery) {
      if (!file.recovery) fail('this keyring has no recovery slot; find a backup with recovery configured');
      decoded = await recoveryBytes(secret);
      kek = await hkdf(decoded.raw, Buffer.from(file.recovery.salt, 'base64'), 'sealbox-recovery-v1', 32);
    } else {
      if (!file.kdf) fail('keyring has no KDF parameters');
      const k = file.kdf;
      kek = await derive(secret, Buffer.from(k.salt, 'base64'), k.id, k.m, k.t, k.p, k.iter);
      try {
        const verifier = await openBox(kek, file.verifier, 'sealbox-keyring-v1/verifier');
        const ok = verifier.equals(Buffer.from('sealbox-verify-v1')); verifier.fill(0);
        if (!ok) fail('invalid verifier');
      } catch { fail('wrong master password or damaged keyring verifier'); }
    }
    let mk;
    try { mk = await openBox(kek, recovery ? file.recovery.mk : file.mk, recovery ? 'sealbox-keyring-v1/recovery-master-key' : 'sealbox-keyring-v1/master-key'); }
    catch { fail(recovery ? 'recovery key does not match this keyring, or keyring is damaged' : 'keyring master-key box is damaged'); }
    if (mk.length !== 32) { mk.fill(0); fail('invalid master-key length'); }
    return mk;
  } finally { kek?.fill(0); decoded?.payload.fill(0); }
}
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args) return;
  const container = await readFile(args.file), h = parseHeader(container);
  if (h.ownPassword && args.recovery) fail('a vault recovery key cannot open an own-password file');
  if (!h.ownPassword && !args.keyring) fail('this file is keyed to the vault — pass --keyring <keyring.json>');
  const body = container.subarray(HEADER_SIZE + h.metaLen);
  const overhead = h.cascade ? 32 : 16, full = h.chunkKiB * 1024 + overhead;
  if (body.length < overhead || (body.length % full !== 0 && body.length % full < overhead)) fail('container body is truncated');
  const chunks = Math.ceil(body.length / full);
  const secret = await readSecret(args.recoveryFile ?? args.passwordFile, args.recovery ? 'Recovery key: ' : 'Password: ');
  let ikm, aesRaw, chachaKey, nonceBase, plain;
  const parts = [];
  try {
    if (h.ownPassword) ikm = await derive(secret, h.salt, h.kdfId, h.kdfParam, h.argonTime, h.argonLanes, h.kdfParam);
    else {
      const mk = await masterKeyFromKeyring(args.keyring, secret, args.recovery);
      try { ikm = await hkdf(mk, h.salt, 'sealbox-file-v1', 32); }
      finally { mk.fill(0); }
    }
    aesRaw = await hkdf(ikm, Buffer.alloc(0), 'sealbox-aes-v1', 32);
    const aes = await crypto.subtle.importKey('raw', aesRaw, 'AES-GCM', false, ['decrypt']);
    let xchacha20poly1305;
    if (h.cascade) {
      try { ({ xchacha20poly1305 } = await import('@noble/ciphers/chacha')); }
      catch { fail('cascade helper is missing. Use the bundled offline recovery pack, or run npm ci in the source repository.'); }
      chachaKey = await hkdf(ikm, Buffer.alloc(0), 'sealbox-xchacha-v1', 32);
      nonceBase = await hkdf(ikm, Buffer.alloc(0), 'sealbox-xnonce-v1', 16);
    }
    const open = async (cipher, counter, last) => {
      const aad = Buffer.concat([container.subarray(0, HEADER_SIZE), u64le(counter), Buffer.from([last ? 1 : 0])]);
      let inner = cipher;
      try {
        if (h.cascade) inner = xchacha20poly1305(chachaKey, Buffer.concat([nonceBase, u64le(counter)]), aad).decrypt(cipher);
        return await aesOpen(aes, Buffer.concat([h.noncePrefix, u64le(counter)]), aad, inner);
      } finally { if (inner !== cipher) inner.fill(0); }
    };
    let meta;
    const metaBytes = await open(container.subarray(HEADER_SIZE, HEADER_SIZE + h.metaLen), 0, false).catch(() => fail('wrong password or damaged file metadata'));
    try { meta = JSON.parse(metaBytes.toString('utf8')); } finally { metaBytes.fill(0); }
    if (meta.v !== 1 || typeof meta.name !== 'string' || !meta.name || /[\\/\x00-\x1f]/.test(meta.name) || ['.', '..'].includes(meta.name) || !Number.isSafeInteger(meta.size) || meta.size < 0 || typeof meta.mime !== 'string') fail('invalid file metadata or unsafe original name');
    for (let i = 0; i < chunks; i++) {
      try { parts.push(await open(body.subarray(i * full, Math.min((i + 1) * full, body.length)), i + 1, i === chunks - 1)); }
      catch { fail(`block ${i + 1} of ${chunks} failed its integrity check — the file is damaged`); }
    }
    plain = Buffer.concat(parts);
    if (plain.length !== meta.size) fail('decrypted size does not match the metadata');
    if (!args.out && process.platform === 'win32' && (/[<>:"|?*]/.test(meta.name) || /[. ]$/.test(meta.name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(meta.name))) fail('original name is unsafe on Windows; choose an explicit --out path');
    const out = args.out ?? basename(meta.name);
    if (out === '-') {
      await new Promise((resolve, reject) => process.stdout.write(plain, e => e ? reject(e) : resolve()));
    } else {
      try { await writeFile(out, plain, { flag: 'wx', mode: 0o600 }); }
      catch (e) { if (e.code === 'EEXIST') fail('output already exists; choose another --out path'); throw e; }
      process.stderr.write(`decrypted ${meta.name} (${meta.mime}, ${plain.length} bytes) -> ${out}\n`);
    }
  } finally {
    for (const buf of [secret, ikm, aesRaw, chachaKey, nonceBase, plain, ...parts]) buf?.fill(0);
  }
}
main().catch(e => { process.stderr.write(`sealbox-decrypt: ${e instanceof Error ? e.message : 'unknown error'}\n`); process.exitCode = 1; });
