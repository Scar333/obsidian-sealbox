#!/usr/bin/env node
/**
 * Standalone Sealbox decryptor — the escape hatch.
 *
 * This file depends on nothing but Node itself. If the plugin ever stops
 * building against a new Obsidian release, or you want to read a `.sealed` file
 * on a machine without Obsidian, this still opens it. Keep a copy with your
 * backups alongside the recovery key.
 *
 * It implements the format documented in README.md from scratch, which also makes
 * it an independent check on the plugin: if both agree, the format description is
 * right.
 *
 * Usage:
 *   node sealbox-decrypt.mjs <file.sealed> --keyring <keyring.json> [--out <path>]
 *   node sealbox-decrypt.mjs <file.sealed> --password-file <file> [--out <path>]
 *
 * The master password is read from stdin (or from --password-file) so it never
 * appears in your shell history or in the process list.
 */

import { readFile, writeFile } from "node:fs/promises";
import { webcrypto as crypto } from "node:crypto";
import { createInterface } from "node:readline";
import process from "node:process";

const HEADER_SIZE = 48;
const MAGIC = "SEALED";
const KDF_NONE = 0;
const KDF_ARGON2ID = 1;
const KDF_PBKDF2_SHA512 = 2;

function fail(message) {
  process.stderr.write(`sealbox-decrypt: ${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { file: null, keyring: null, passwordFile: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--keyring") args.keyring = argv[++i];
    else if (a === "--password-file") args.passwordFile = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (!a.startsWith("-")) args.file = a;
    else fail(`unknown option ${a}`);
  }
  if (!args.file) fail("no input file given");
  return args;
}

function parseHeader(buf) {
  if (buf.length < HEADER_SIZE) fail("file is too short to be a container");
  if (buf.subarray(0, 6).toString("latin1") !== MAGIC) fail("not a Sealbox container");
  const version = buf[6];
  if (version !== 1) fail(`container format v${version} is not supported by this tool`);
  const flags = buf[7];
  return {
    version,
    cascade: (flags & 1) !== 0,
    ownPassword: (flags & 2) !== 0,
    kdfId: buf[8],
    argonTime: buf[9],
    argonLanes: buf[10],
    kdfParam: buf.readUInt32LE(12),
    chunkKiB: buf.readUInt32LE(16),
    salt: buf.subarray(20, 36),
    noncePrefix: buf.subarray(36, 40),
    metaLen: buf.readUInt32LE(40),
  };
}

function u64le(value) {
  const b = Buffer.alloc(8);
  b.writeUInt32LE(value >>> 0, 0);
  b.writeUInt32LE(Math.floor(value / 0x100000000), 4);
  return b;
}

function blockAad(headerBytes, counter, isLast) {
  return Buffer.concat([
    headerBytes.subarray(0, HEADER_SIZE),
    u64le(counter),
    Buffer.from([isLast ? 1 : 0]),
  ]);
}

function blockNonce(prefix, counter) {
  return Buffer.concat([prefix, u64le(counter)]);
}

async function hkdf(ikm, salt, info, length) {
  const base = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info: Buffer.from(info, "utf8") },
    base,
    length * 8,
  );
  return Buffer.from(bits);
}

async function pbkdf2(password, salt, iterations) {
  const base = await crypto.subtle.importKey("raw", password, "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-512", salt, iterations },
    base,
    256,
  );
  return Buffer.from(bits);
}

async function readPassword(passwordFile) {
  if (passwordFile) {
    const raw = await readFile(passwordFile);
    // Strip a single trailing newline, which every editor adds.
    return raw[raw.length - 1] === 0x0a ? raw.subarray(0, raw.length - 1) : raw;
  }
  if (process.stdin.isTTY) process.stderr.write("Master password: ");
  const rl = createInterface({ input: process.stdin, terminal: false });
  for await (const line of rl) {
    rl.close();
    return Buffer.from(line, "utf8");
  }
  fail("no password given on stdin");
}

/** Unwrap the master key from a keyring.json. */
async function masterKeyFromKeyring(keyringPath, password) {
  const file = JSON.parse(await readFile(keyringPath, "utf8"));
  if (file.sealbox !== 1) fail(`keyring version ${file.sealbox} is not supported`);
  const salt = Buffer.from(file.kdf.salt, "base64");

  let kek;
  if (file.kdf.id === KDF_PBKDF2_SHA512) {
    kek = await pbkdf2(password, salt, file.kdf.iter);
  } else if (file.kdf.id === KDF_ARGON2ID) {
    fail(
      "this keyring uses Argon2id, which Node cannot do on its own.\n" +
        "  Install a helper first:  npm i hash-wasm\n" +
        "  then re-run; or change the master password to a PBKDF2 profile in Sealbox settings first.",
    );
  } else {
    fail(`unknown keyring kdf id ${file.kdf.id}`);
  }

  const aesKek = await crypto.subtle.importKey("raw", kek, "AES-GCM", false, ["decrypt"]);
  const verify = async (box, aad) =>
    Buffer.from(
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: Buffer.from(box.n, "base64"),
          additionalData: Buffer.from(aad, "utf8"),
          tagLength: 128,
        },
        aesKek,
        Buffer.from(box.c, "base64"),
      ),
    );

  try {
    await verify(file.verifier, "sealbox-keyring-v1/verifier");
  } catch {
    fail("wrong master password");
  }
  return verify(file.mk, "sealbox-keyring-v1/master-key");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const container = await readFile(args.file);
  const header = parseHeader(container);
  if (header.cascade) {
    fail(
      "this container uses the optional XChaCha20 cascade layer, which this minimal tool does not implement.\n" +
        "  Turn off paranoid mode in Sealbox and re-seal the file, or use the plugin to open it.",
    );
  }

  const password = await readPassword(args.passwordFile);
  let ikm;
  if (header.ownPassword) {
    if (header.kdfId === KDF_PBKDF2_SHA512) {
      ikm = await pbkdf2(password, header.salt, header.kdfParam);
    } else {
      fail("this file uses Argon2id; see the note above about hash-wasm");
    }
  } else {
    if (header.kdfId !== KDF_NONE) fail("malformed header: vault-keyed file carries a kdf");
    if (!args.keyring) fail("this file is keyed to the vault — pass --keyring <keyring.json>");
    const mk = await masterKeyFromKeyring(args.keyring, password);
    ikm = await hkdf(mk, header.salt, "sealbox-file-v1", 32);
  }

  const aesRaw = await hkdf(ikm, Buffer.alloc(0), "sealbox-aes-v1", 32);
  const key = await crypto.subtle.importKey("raw", aesRaw, "AES-GCM", false, ["decrypt"]);
  const headerBytes = container.subarray(0, HEADER_SIZE);

  const open = async (cipher, counter, isLast) =>
    Buffer.from(
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: blockNonce(header.noncePrefix, counter),
          additionalData: blockAad(headerBytes, counter, isLast),
          tagLength: 128,
        },
        key,
        cipher,
      ),
    );

  let meta;
  try {
    meta = JSON.parse(
      (await open(container.subarray(HEADER_SIZE, HEADER_SIZE + header.metaLen), 0, false)).toString(
        "utf8",
      ),
    );
  } catch {
    fail("wrong password, or this file was tampered with");
  }

  const body = container.subarray(HEADER_SIZE + header.metaLen);
  const overhead = 16;
  const full = header.chunkKiB * 1024 + overhead;
  const chunks = body.length % full === 0 ? body.length / full : Math.floor(body.length / full) + 1;

  const parts = [];
  for (let i = 0; i < chunks; i++) {
    const start = i * full;
    const end = Math.min(start + full, body.length);
    try {
      parts.push(await open(body.subarray(start, end), i + 1, i === chunks - 1));
    } catch {
      fail(`block ${i + 1} of ${chunks} failed its integrity check — the file is damaged`);
    }
  }
  const plain = Buffer.concat(parts);
  if (plain.length !== meta.size) fail("decrypted size does not match the metadata");

  const out = args.out ?? meta.name;
  if (out === "-") {
    process.stdout.write(plain);
  } else {
    await writeFile(out, plain);
    process.stderr.write(
      `decrypted ${meta.name} (${meta.mime}, ${plain.length} bytes) -> ${out}\n`,
    );
  }
}

main().catch((e) => fail(e instanceof Error ? e.message : "unknown error"));
