/**
 * `.sealed` container format, version 1.
 *
 * Layout (little-endian):
 *   off  len  field
 *    0    6   magic "SEALED"
 *    6    1   format version
 *    7    1   flags (bit0 cascade, bit1 own-password)
 *    8    1   kdf id
 *    9    1   argon2 time cost
 *   10    1   argon2 lanes
 *   11    1   reserved, must be 0
 *   12    4   argon2 memory (KiB) or pbkdf2 iterations
 *   16    4   chunk size (KiB)
 *   20   16   salt
 *   36    4   nonce prefix
 *   40    4   metadata ciphertext length
 *   44    4   reserved, must be 0
 *   48    N   metadata ciphertext
 *  ...        chunk[1..M] ciphertext
 *
 * Every field above is fed into the AAD of every block, so editing any of them
 * — including the reserved bytes — makes decryption fail instead of silently
 * changing how the file is read.
 */

import { timingSafeEqual } from "./bytes.ts";
import { t } from "../i18n/index.ts";

export const MAGIC = new Uint8Array([0x53, 0x45, 0x41, 0x4c, 0x45, 0x44]); // "SEALED"
export const HEADER_SIZE = 48;
export const FORMAT_VERSION = 1;

export const FLAG_CASCADE = 1 << 0;
export const FLAG_OWN_PASSWORD = 1 << 1;
const KNOWN_FLAGS = FLAG_CASCADE | FLAG_OWN_PASSWORD;

export const KDF_NONE = 0;
export const KDF_ARGON2ID = 1;
export const KDF_PBKDF2_SHA512 = 2;

export const SALT_SIZE = 16;
export const NONCE_PREFIX_SIZE = 4;
export const GCM_TAG_SIZE = 16;
export const POLY1305_TAG_SIZE = 16;

export const MIN_CHUNK_KIB = 16;
export const MAX_CHUNK_KIB = 8192;
export const DEFAULT_CHUNK_KIB = 1024;
export const MAX_META_LEN = 64 * 1024;

/** Highest chunk index we allow, keeping the nonce counter far from wrapping. */
export const MAX_CHUNKS = 0xffffffff;

/**
 * Hard ceiling on the Argon2id memory cost we will honour from a file header.
 * A container asking for more than this is hostile or corrupt: obeying it would
 * be an out-of-memory crash, not a decryption. 1 GiB is already far above any
 * parameter set this plugin writes.
 */
export const MAX_ARGON2_MEMORY_KIB = 1024 * 1024;

export interface SealedHeader {
  version: number;
  cascade: boolean;
  ownPassword: boolean;
  kdfId: number;
  /** Argon2id time cost, or 0 when the kdf does not use it. */
  argonTime: number;
  /** Argon2id lanes, or 0. */
  argonLanes: number;
  /** Argon2id memory in KiB, or PBKDF2 iteration count, or 0. */
  kdfParam: number;
  chunkKiB: number;
  salt: Uint8Array;
  noncePrefix: Uint8Array;
  metaLen: number;
}

export class SealedFormatError extends Error {}
export class SealedAuthError extends Error {}

export function packHeader(h: SealedHeader): Uint8Array {
  if (h.salt.length !== SALT_SIZE) throw new SealedFormatError("bad salt size");
  if (h.noncePrefix.length !== NONCE_PREFIX_SIZE) {
    throw new SealedFormatError("bad nonce prefix size");
  }
  const out = new Uint8Array(HEADER_SIZE);
  const view = new DataView(out.buffer);
  out.set(MAGIC, 0);
  out[6] = h.version;
  out[7] = (h.cascade ? FLAG_CASCADE : 0) | (h.ownPassword ? FLAG_OWN_PASSWORD : 0);
  out[8] = h.kdfId;
  out[9] = h.argonTime;
  out[10] = h.argonLanes;
  out[11] = 0;
  view.setUint32(12, h.kdfParam, true);
  view.setUint32(16, h.chunkKiB, true);
  out.set(h.salt, 20);
  out.set(h.noncePrefix, 36);
  view.setUint32(40, h.metaLen, true);
  view.setUint32(44, 0, true);
  return out;
}

/**
 * Parse and fully validate a header. Anything unexpected throws rather than
 * being tolerated: a container we do not understand must never be guessed at.
 */
export function parseHeader(bytes: Uint8Array): SealedHeader {
  if (bytes.length < HEADER_SIZE) {
    throw new SealedFormatError(t("container.tooShort"));
  }
  if (!timingSafeEqual(bytes.subarray(0, 6), MAGIC)) {
    throw new SealedFormatError(t("container.notContainer"));
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = bytes[6];
  if (version !== FORMAT_VERSION) {
    throw new SealedFormatError(t("container.futureVersion", { version }));
  }
  const flags = bytes[7];
  if ((flags & ~KNOWN_FLAGS) !== 0) {
    throw new SealedFormatError(t("container.unknownFlags"));
  }
  if (bytes[11] !== 0 || view.getUint32(44, true) !== 0) {
    throw new SealedFormatError(t("container.reservedNotEmpty"));
  }

  const ownPassword = (flags & FLAG_OWN_PASSWORD) !== 0;
  const kdfId = bytes[8];
  if (ownPassword) {
    if (kdfId !== KDF_ARGON2ID && kdfId !== KDF_PBKDF2_SHA512) {
      throw new SealedFormatError(t("container.unknownKdf"));
    }
  } else if (kdfId !== KDF_NONE) {
    throw new SealedFormatError(t("container.vaultWithKdf"));
  }

  const chunkKiB = view.getUint32(16, true);
  if (chunkKiB < MIN_CHUNK_KIB || chunkKiB > MAX_CHUNK_KIB) {
    throw new SealedFormatError(t("container.chunkRange"));
  }
  const metaLen = view.getUint32(40, true);
  if (metaLen <= GCM_TAG_SIZE || metaLen > MAX_META_LEN) {
    throw new SealedFormatError(t("container.metaRange"));
  }
  const kdfParam = view.getUint32(12, true);
  const argonTime = bytes[9];
  const argonLanes = bytes[10];
  if (kdfId === KDF_ARGON2ID) {
    if (argonTime < 1 || argonLanes < 1 || kdfParam < 8) {
      throw new SealedFormatError(t("container.implausibleArgon"));
    }
    // Refuse to honour an absurd memory cost planted by an attacker: it would
    // be a denial of service (or an OOM crash) rather than a decryption.
    if (kdfParam > MAX_ARGON2_MEMORY_KIB) {
      throw new SealedFormatError(t("container.argonTooLarge"));
    }
  } else if (kdfId === KDF_PBKDF2_SHA512) {
    if (argonTime !== 0 || argonLanes !== 0) {
      throw new SealedFormatError(t("container.pbkdf2WithArgon"));
    }
    if (kdfParam < 10000 || kdfParam > 20000000) {
      throw new SealedFormatError(t("container.implausiblePbkdf2"));
    }
  } else if (kdfParam !== 0 || argonTime !== 0 || argonLanes !== 0) {
    throw new SealedFormatError(t("container.kdfWithoutKdf"));
  }

  return {
    version,
    cascade: (flags & FLAG_CASCADE) !== 0,
    ownPassword,
    kdfId,
    argonTime,
    argonLanes,
    kdfParam,
    chunkKiB,
    // Copy, so later mutation of the source buffer cannot change a parsed header.
    salt: bytes.slice(20, 20 + SALT_SIZE),
    noncePrefix: bytes.slice(36, 36 + NONCE_PREFIX_SIZE),
    metaLen,
  };
}

/**
 * Validate a whole container, not just its header fields.
 *
 * Kept separate from `parseHeader` because a writer validates the header it is
 * about to emit before any body exists yet.
 */
export function parseContainer(bytes: Uint8Array): SealedHeader {
  const header = parseHeader(bytes);
  if (bytes.length < HEADER_SIZE + header.metaLen) {
    throw new SealedFormatError(t("container.truncatedMeta"));
  }
  return header;
}

export function looksSealed(bytes: Uint8Array): boolean {
  return (
    bytes.length >= HEADER_SIZE && timingSafeEqual(bytes.subarray(0, 6), MAGIC)
  );
}

/** Bytes added to each block by the AEAD layer(s). */
export function tagOverhead(cascade: boolean): number {
  return cascade ? GCM_TAG_SIZE + POLY1305_TAG_SIZE : GCM_TAG_SIZE;
}

/**
 * Additional authenticated data for one block.
 *
 * Binding the whole header plus the block's own position and end-of-file flag
 * is what makes chunk reordering, duplication and truncation detectable.
 */
export function blockAad(
  headerBytes: Uint8Array,
  counter: number,
  isLast: boolean,
): Uint8Array {
  const aad = new Uint8Array(HEADER_SIZE + 9);
  aad.set(headerBytes.subarray(0, HEADER_SIZE), 0);
  const view = new DataView(aad.buffer);
  view.setUint32(HEADER_SIZE, counter >>> 0, true);
  view.setUint32(HEADER_SIZE + 4, Math.floor(counter / 0x100000000), true);
  aad[HEADER_SIZE + 8] = isLast ? 1 : 0;
  return aad;
}

/** 12-byte AES-GCM nonce: random per-file prefix plus the block counter. */
export function blockNonce(
  noncePrefix: Uint8Array,
  counter: number,
): Uint8Array {
  const nonce = new Uint8Array(12);
  nonce.set(noncePrefix, 0);
  const view = new DataView(nonce.buffer);
  view.setUint32(4, counter >>> 0, true);
  view.setUint32(8, Math.floor(counter / 0x100000000), true);
  return nonce;
}

/** 24-byte XChaCha20 nonce for the optional outer cascade layer. */
export function cascadeNonce(
  base: Uint8Array,
  counter: number,
): Uint8Array {
  if (base.length !== 16) throw new SealedFormatError("bad cascade nonce base");
  const nonce = new Uint8Array(24);
  nonce.set(base, 0);
  const view = new DataView(nonce.buffer);
  view.setUint32(16, counter >>> 0, true);
  view.setUint32(20, Math.floor(counter / 0x100000000), true);
  return nonce;
}

/**
 * How many chunks a container body holds, given its on-disk size.
 * Writers always emit at least one chunk, so an empty payload is still one
 * block and therefore still authenticated.
 */
export function chunkCount(
  bodyLength: number,
  chunkKiB: number,
  cascade: boolean,
): number {
  const ov = tagOverhead(cascade);
  if (bodyLength < ov) {
    throw new SealedFormatError(t("container.bodyTruncated"));
  }
  const full = chunkKiB * 1024 + ov;
  const n = Math.floor(bodyLength / full);
  const rem = bodyLength % full;
  const count = rem === 0 ? n : n + 1;
  if (count < 1 || count > MAX_CHUNKS) {
    throw new SealedFormatError(t("container.implausibleChunks"));
  }
  if (rem !== 0 && rem < ov) {
    throw new SealedFormatError(t("container.bodyTruncated"));
  }
  return count;
}
