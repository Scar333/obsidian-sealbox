import { test } from "node:test";
import assert from "node:assert/strict";

import { randomBytes, zero } from "../src/crypto/bytes.ts";
import { importHkdfBase } from "../src/crypto/hkdf.ts";
import {
  defaultMeta,
  readMeta,
  seal,
  unseal,
  type KeySource,
} from "../src/crypto/seal.ts";
import {
  HEADER_SIZE,
  parseHeader,
  SealedAuthError,
  SealedFormatError,
  chunkCount,
  looksSealed,
} from "../src/crypto/container.ts";
import { KDF_ARGON2ID, KDF_PBKDF2_SHA512 } from "../src/crypto/container.ts";
import type { KdfParams } from "../src/crypto/kdf.ts";

/** Deliberately weak parameters: these tests exercise the format, not the KDF. */
const CHEAP_ARGON: KdfParams = {
  id: KDF_ARGON2ID,
  memoryKiB: 64,
  time: 1,
  lanes: 1,
  iterations: 0,
};
const CHEAP_PBKDF2: KdfParams = {
  id: KDF_PBKDF2_SHA512,
  memoryKiB: 0,
  time: 0,
  lanes: 0,
  iterations: 10000,
};

async function vaultSource(): Promise<KeySource> {
  const raw = randomBytes(32);
  const masterKey = await importHkdfBase(raw);
  zero(raw);
  return { kind: "vault", masterKey };
}

function passwordSource(pw: string, params = CHEAP_ARGON): KeySource {
  return { kind: "password", password: new TextEncoder().encode(pw), params };
}

const meta = (size: number) => defaultMeta("secret.bin", "application/octet-stream", size);

// Sizes chosen around the chunk boundary: empty, sub-block, exact block,
// one byte either side of it, and several blocks.
const CHUNK_KIB = 16;
const CHUNK = CHUNK_KIB * 1024;
const SIZES = [0, 1, 15, 16, 17, CHUNK - 1, CHUNK, CHUNK + 1, CHUNK * 3, CHUNK * 3 + 7];

test("round-trips every size boundary with a vault key", async () => {
  const source = await vaultSource();
  for (const size of SIZES) {
    const plain = randomBytes(size);
    const container = await seal(plain, meta(size), source, { chunkKiB: CHUNK_KIB });
    assert.ok(looksSealed(container), `size ${size}: magic missing`);
    const out = await unseal(container, source);
    assert.deepEqual(out.data, plain, `size ${size}: payload mismatch`);
    assert.equal(out.meta.size, size);
    assert.equal(out.meta.name, "secret.bin");
  }
});

test("round-trips with a per-file password (argon2id and pbkdf2)", async () => {
  for (const params of [CHEAP_ARGON, CHEAP_PBKDF2]) {
    const plain = randomBytes(5000);
    const container = await seal(plain, meta(5000), passwordSource("correct horse", params));
    const out = await unseal(container, passwordSource("correct horse", params));
    assert.deepEqual(out.data, plain);
  }
});

test("round-trips with the cascade layer enabled", async () => {
  const source = await vaultSource();
  for (const size of [0, 1, CHUNK, CHUNK * 2 + 3]) {
    const plain = randomBytes(size);
    const container = await seal(plain, meta(size), source, {
      chunkKiB: CHUNK_KIB,
      cascade: true,
    });
    assert.equal(parseHeader(container).cascade, true);
    const out = await unseal(container, source);
    assert.deepEqual(out.data, plain, `cascade size ${size}`);
  }
});

test("reads metadata without decrypting the body", async () => {
  const source = await vaultSource();
  const plain = randomBytes(CHUNK * 2);
  const container = await seal(plain, defaultMeta("report.pdf", "application/pdf", plain.length), source, {
    chunkKiB: CHUNK_KIB,
  });
  const m = await readMeta(container, source);
  assert.equal(m.name, "report.pdf");
  assert.equal(m.mime, "application/pdf");
  assert.equal(m.size, CHUNK * 2);
});

test("rejects a wrong password with an auth error, not a format error", async () => {
  const container = await seal(randomBytes(100), meta(100), passwordSource("right"));
  await assert.rejects(
    () => unseal(container, passwordSource("wrong")),
    (e: unknown) => e instanceof SealedAuthError,
  );
});

test("rejects a key from a different vault", async () => {
  const a = await vaultSource();
  const b = await vaultSource();
  const container = await seal(randomBytes(100), meta(100), a);
  await assert.rejects(() => unseal(container, b), (e: unknown) => e instanceof SealedAuthError);
});

test("detects a flipped bit anywhere in the payload", async () => {
  const source = await vaultSource();
  const plain = randomBytes(CHUNK * 2 + 10);
  const container = await seal(plain, meta(plain.length), source, { chunkKiB: CHUNK_KIB });
  // Walk the whole file, not just one spot: header, metadata block and body.
  const probes = [0, 6, 7, 8, 12, 16, 20, 36, 40, 44, HEADER_SIZE + 2, container.length - 1];
  for (const i of probes) {
    const bad = container.slice();
    bad[i] ^= 0x01;
    await assert.rejects(
      () => unseal(bad, source),
      (e: unknown) => e instanceof SealedAuthError || e instanceof SealedFormatError,
      `flipping byte ${i} was not detected`,
    );
  }
});

test("detects a truncated final chunk", async () => {
  const source = await vaultSource();
  const plain = randomBytes(CHUNK * 3);
  const container = await seal(plain, meta(plain.length), source, { chunkKiB: CHUNK_KIB });
  const ov = 16;
  // Drop the last chunk entirely: the previous chunk was sealed with is_last=0,
  // so re-reading it as the final block must fail.
  const cut = container.subarray(0, container.length - (CHUNK + ov));
  await assert.rejects(
    () => unseal(cut, source),
    (e: unknown) => e instanceof SealedAuthError || e instanceof SealedFormatError,
  );
  // And a partially shaved chunk.
  await assert.rejects(
    () => unseal(container.subarray(0, container.length - 5), source),
    (e: unknown) => e instanceof SealedAuthError || e instanceof SealedFormatError,
  );
});

test("detects reordered and duplicated chunks", async () => {
  const source = await vaultSource();
  const plain = randomBytes(CHUNK * 3);
  const container = await seal(plain, meta(plain.length), source, { chunkKiB: CHUNK_KIB });
  const header = parseHeader(container);
  const bodyStart = HEADER_SIZE + header.metaLen;
  const full = CHUNK + 16;

  const swapped = container.slice();
  const first = swapped.slice(bodyStart, bodyStart + full);
  const second = swapped.slice(bodyStart + full, bodyStart + 2 * full);
  swapped.set(second, bodyStart);
  swapped.set(first, bodyStart + full);
  await assert.rejects(() => unseal(swapped, source), (e: unknown) => e instanceof SealedAuthError);

  const duplicated = container.slice();
  duplicated.set(first, bodyStart + full);
  await assert.rejects(
    () => unseal(duplicated, source),
    (e: unknown) => e instanceof SealedAuthError,
  );
});

test("refuses a header whose kdf parameters were edited", async () => {
  const container = await seal(randomBytes(64), meta(64), passwordSource("pw"));
  const bumped = container.slice();
  const view = new DataView(bumped.buffer);
  view.setUint32(12, CHEAP_ARGON.memoryKiB * 2, true); // memory cost
  await assert.rejects(
    () => unseal(bumped, passwordSource("pw")),
    (e: unknown) => e instanceof SealedAuthError,
  );

  const hostile = container.slice();
  new DataView(hostile.buffer).setUint32(12, 3 * 1024 * 1024 + 1, true);
  await assert.rejects(
    () => unseal(hostile, passwordSource("pw")),
    (e: unknown) => e instanceof SealedFormatError,
    "an absurd memory cost must be refused before it is honoured",
  );
});

test("refuses unknown flags, versions and reserved bytes", async () => {
  const source = await vaultSource();
  const container = await seal(randomBytes(10), meta(10), source);

  const futureVersion = container.slice();
  futureVersion[6] = 2;
  assert.throws(() => parseHeader(futureVersion), SealedFormatError);

  const unknownFlag = container.slice();
  unknownFlag[7] |= 0x80;
  assert.throws(() => parseHeader(unknownFlag), SealedFormatError);

  const dirtyReserved = container.slice();
  dirtyReserved[11] = 1;
  assert.throws(() => parseHeader(dirtyReserved), SealedFormatError);

  const notSealed = new Uint8Array(HEADER_SIZE);
  assert.throws(() => parseHeader(notSealed), SealedFormatError);
  assert.equal(looksSealed(notSealed), false);
});

test("refuses a vault container that claims to carry its own kdf", async () => {
  const source = await vaultSource();
  const container = await seal(randomBytes(10), meta(10), source);
  const lying = container.slice();
  lying[8] = KDF_ARGON2ID; // kdf id without the own-password flag
  assert.throws(() => parseHeader(lying), SealedFormatError);
});

test("chunkCount agrees with what seal actually wrote", async () => {
  const source = await vaultSource();
  for (const size of SIZES) {
    const container = await seal(randomBytes(size), meta(size), source, {
      chunkKiB: CHUNK_KIB,
    });
    const header = parseHeader(container);
    const body = container.length - HEADER_SIZE - header.metaLen;
    const expected = Math.max(1, Math.ceil(size / CHUNK));
    assert.equal(chunkCount(body, CHUNK_KIB, false), expected, `size ${size}`);
  }
});

test("rejects metadata carrying a path separator", async () => {
  const source = await vaultSource();
  for (const name of ["../../etc/passwd", "a\\b", "a\0b"]) {
    const container = await seal(
      randomBytes(8),
      defaultMeta(name, "text/plain", 8),
      source,
    );
    await assert.rejects(
      () => readMeta(container, source),
      (e: unknown) => e instanceof SealedFormatError,
      `name ${JSON.stringify(name)} must not survive`,
    );
  }
});

test("two seals of identical input produce different ciphertext", async () => {
  const source = await vaultSource();
  const plain = new Uint8Array(1000).fill(7);
  const a = await seal(plain, meta(1000), source);
  const b = await seal(plain, meta(1000), source);
  assert.equal(a.length, b.length);
  assert.notDeepEqual(a.subarray(20, 40), b.subarray(20, 40), "salt/nonce must be fresh");
  assert.notDeepEqual(a.subarray(HEADER_SIZE), b.subarray(HEADER_SIZE));
});
