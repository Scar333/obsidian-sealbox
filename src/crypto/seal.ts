/**
 * Sealing and unsealing `.sealed` containers.
 *
 * Payloads are processed in chunks, each one an independent AEAD block whose
 * AAD carries the full header, the block index and an end-of-file flag. That
 * is what makes reordering, duplicating and truncating blocks detectable, and
 * it keeps peak memory bounded instead of handing a 200 MB buffer to a single
 * WebCrypto call — the quickest way to have an Android WebView killed.
 */

import { xchacha20poly1305 } from "@noble/ciphers/chacha";
import {
  bs,
  concat,
  fromUtf8,
  randomBytes,
  utf8,
  zero,
} from "./bytes.ts";
import {
  blockAad,
  blockNonce,
  cascadeNonce,
  chunkCount,
  DEFAULT_CHUNK_KIB,
  GCM_TAG_SIZE,
  HEADER_SIZE,
  KDF_NONE,
  MAX_CHUNKS,
  NONCE_PREFIX_SIZE,
  packHeader,
  parseHeader,
  parseContainer,
  SALT_SIZE,
  SealedAuthError,
  SealedFormatError,
  tagOverhead,
  FORMAT_VERSION,
  type SealedHeader,
} from "./container.ts";
import {
  expandOnce,
  hkdfBytes,
  HKDF_INFO_AES,
  HKDF_INFO_FILE,
  HKDF_INFO_XCHACHA,
  HKDF_INFO_XNONCE,
  importAesKey,
} from "./hkdf.ts";
import { deriveFromPassword, type KdfParams } from "./kdf.ts";
import { t } from "../i18n/index.ts";

/** Plaintext metadata, authenticated and encrypted as block 0. */
export interface SealedMeta {
  v: 1;
  /** Original file name including its extension. */
  name: string;
  mime: string;
  size: number;
  mtime: number;
  ctime: number;
}

export type KeySource =
  /** Normal case: a per-file key derived from the unlocked vault master key. */
  | { kind: "vault"; masterKey: CryptoKey }
  /** A file carrying its own password, independent of the vault keyring. */
  | { kind: "password"; password: Uint8Array; params: KdfParams };

export interface SealOptions {
  cascade?: boolean;
  chunkKiB?: number;
  onProgress?: (bytesDone: number, bytesTotal: number) => void;
  signal?: { aborted: boolean };
}

const META_COUNTER = 0;

/** Give the UI thread a chance to paint between chunks. */
function yieldToHost(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

interface FileKeys {
  aes: CryptoKey;
  chachaKey: Uint8Array | null;
  xnonceBase: Uint8Array | null;
  destroy(): void;
}

async function deriveFileKeys(
  header: SealedHeader,
  source: KeySource,
): Promise<FileKeys> {
  let ikm: Uint8Array;
  if (source.kind === "vault") {
    ikm = await hkdfBytes(source.masterKey, header.salt, HKDF_INFO_FILE, 32);
  } else {
    ikm = await deriveFromPassword(source.password, header.salt, source.params);
  }

  try {
    const aesRaw = await expandOnce(ikm, HKDF_INFO_AES, 32);
    const aes = await importAesKey(aesRaw); // wipes aesRaw
    let chachaKey: Uint8Array | null = null;
    let xnonceBase: Uint8Array | null = null;
    if (header.cascade) {
      chachaKey = await expandOnce(ikm, HKDF_INFO_XCHACHA, 32);
      xnonceBase = await expandOnce(ikm, HKDF_INFO_XNONCE, 16);
    }
    return {
      aes,
      chachaKey,
      xnonceBase,
      destroy() {
        zero(chachaKey, xnonceBase);
      },
    };
  } finally {
    zero(ikm);
  }
}

async function encryptBlock(
  keys: FileKeys,
  header: SealedHeader,
  headerBytes: Uint8Array,
  counter: number,
  isLast: boolean,
  plain: Uint8Array,
): Promise<Uint8Array> {
  const aad = blockAad(headerBytes, counter, isLast);
  const nonce = blockNonce(header.noncePrefix, counter);
  const inner = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: bs(nonce), additionalData: bs(aad), tagLength: 128 },
      keys.aes,
      bs(plain),
    ),
  );
  if (!keys.chachaKey || !keys.xnonceBase) return inner;

  const outer = xchacha20poly1305(
    keys.chachaKey,
    cascadeNonce(keys.xnonceBase, counter),
    aad,
  ).encrypt(inner);
  zero(inner);
  return outer;
}

async function decryptBlock(
  keys: FileKeys,
  header: SealedHeader,
  headerBytes: Uint8Array,
  counter: number,
  isLast: boolean,
  cipher: Uint8Array,
): Promise<Uint8Array> {
  const aad = blockAad(headerBytes, counter, isLast);
  let inner = cipher;
  let innerOwned = false;
  if (keys.chachaKey && keys.xnonceBase) {
    inner = xchacha20poly1305(
      keys.chachaKey,
      cascadeNonce(keys.xnonceBase, counter),
      aad,
    ).decrypt(cipher);
    innerOwned = true;
  }
  try {
    const nonce = blockNonce(header.noncePrefix, counter);
    return new Uint8Array(
      await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: bs(nonce), additionalData: bs(aad), tagLength: 128 },
        keys.aes,
        bs(inner),
      ),
    );
  } finally {
    if (innerOwned) zero(inner);
  }
}

export function defaultMeta(
  name: string,
  mime: string,
  size: number,
): SealedMeta {
  const now = Date.now();
  return { v: 1, name, mime, size, mtime: now, ctime: now };
}

function encodeMeta(meta: SealedMeta): Uint8Array {
  return utf8(
    JSON.stringify({
      v: 1,
      name: meta.name,
      mime: meta.mime,
      size: meta.size,
      mtime: meta.mtime,
      ctime: meta.ctime,
    }),
  );
}

function decodeMeta(bytes: Uint8Array): SealedMeta {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fromUtf8(bytes));
  } catch {
    throw new SealedFormatError(t("container.metaNotJson"));
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new SealedFormatError(t("container.metaNotObject"));
  }
  const m = parsed as Record<string, unknown>;
  if (m.v !== 1) throw new SealedFormatError(t("container.metaVersion"));
  const name = typeof m.name === "string" ? m.name : "";
  const mime = typeof m.mime === "string" ? m.mime : "application/octet-stream";
  const size = typeof m.size === "number" && m.size >= 0 ? m.size : 0;
  const mtime = typeof m.mtime === "number" ? m.mtime : 0;
  const ctime = typeof m.ctime === "number" ? m.ctime : 0;
  // A name is attacker-influenced data that we later put on screen and, for
  // "decrypt permanently", into a path. Reject separators here, at the edge.
  if (name.includes("/") || name.includes("\\") || name.includes("\0")) {
    throw new SealedFormatError(t("container.metaPathSeparator"));
  }
  return { v: 1, name, mime, size, mtime, ctime };
}

export async function seal(
  plain: Uint8Array,
  meta: SealedMeta,
  source: KeySource,
  options: SealOptions = {},
): Promise<Uint8Array> {
  const cascade = options.cascade === true;
  const chunkKiB = options.chunkKiB ?? DEFAULT_CHUNK_KIB;
  const chunkSize = chunkKiB * 1024;
  const metaPlain = encodeMeta({ ...meta, size: plain.length });
  const header: SealedHeader = {
    version: FORMAT_VERSION,
    cascade,
    ownPassword: source.kind === "password",
    kdfId: source.kind === "password" ? source.params.id : KDF_NONE,
    argonTime: source.kind === "password" ? source.params.time : 0,
    argonLanes: source.kind === "password" ? source.params.lanes : 0,
    kdfParam:
      source.kind === "password"
        ? source.params.id === 1
          ? source.params.memoryKiB
          : source.params.iterations
        : 0,
    chunkKiB,
    salt: randomBytes(SALT_SIZE),
    noncePrefix: randomBytes(NONCE_PREFIX_SIZE),
    metaLen: metaPlain.length + tagOverhead(cascade),
  };
  const headerBytes = packHeader(header);
  // Round-trip the header we are about to write: a header that cannot be parsed
  // back would produce a file nothing can ever open.
  parseHeader(headerBytes);

  const chunks = Math.max(1, Math.ceil(plain.length / chunkSize));
  if (chunks > MAX_CHUNKS) throw new SealedFormatError(t("container.payloadTooLarge"));

  const keys = await deriveFileKeys(header, source);
  try {
    const parts: Uint8Array[] = [headerBytes];
    parts.push(
      await encryptBlock(keys, header, headerBytes, META_COUNTER, false, metaPlain),
    );
    zero(metaPlain);

    for (let i = 0; i < chunks; i++) {
      if (options.signal?.aborted) throw new Error("cancelled");
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, plain.length);
      parts.push(
        await encryptBlock(
          keys,
          header,
          headerBytes,
          i + 1,
          i === chunks - 1,
          plain.subarray(start, end),
        ),
      );
      options.onProgress?.(end, plain.length);
      if (i % 8 === 7) await yieldToHost();
    }
    return concat(...parts);
  } finally {
    keys.destroy();
  }
}

/** Decrypt only block 0, to show a file's real name and type before the body. */
export async function readMeta(
  container: Uint8Array,
  source: KeySource,
): Promise<SealedMeta> {
  const header = parseContainer(container);
  const headerBytes = container.subarray(0, HEADER_SIZE);
  const keys = await deriveFileKeys(header, source);
  try {
    const metaCipher = container.subarray(
      HEADER_SIZE,
      HEADER_SIZE + header.metaLen,
    );
    let metaPlain: Uint8Array;
    try {
      metaPlain = await decryptBlock(
        keys,
        header,
        headerBytes,
        META_COUNTER,
        false,
        metaCipher,
      );
    } catch {
      throw new SealedAuthError(t("crypto.wrongPassword"));
    }
    try {
      return decodeMeta(metaPlain);
    } finally {
      zero(metaPlain);
    }
  } finally {
    keys.destroy();
  }
}

export interface UnsealResult {
  meta: SealedMeta;
  data: Uint8Array;
}

export async function unseal(
  container: Uint8Array,
  source: KeySource,
  options: SealOptions = {},
): Promise<UnsealResult> {
  const header = parseContainer(container);
  const headerBytes = container.subarray(0, HEADER_SIZE);
  const body = container.subarray(HEADER_SIZE + header.metaLen);
  const ov = tagOverhead(header.cascade);
  const chunks = chunkCount(body.length, header.chunkKiB, header.cascade);
  const full = header.chunkKiB * 1024 + ov;

  const keys = await deriveFileKeys(header, source);
  try {
    let meta: SealedMeta;
    let metaPlain: Uint8Array;
    try {
      metaPlain = await decryptBlock(
        keys,
        header,
        headerBytes,
        META_COUNTER,
        false,
        container.subarray(HEADER_SIZE, HEADER_SIZE + header.metaLen),
      );
    } catch {
      // Block 0 failing is overwhelmingly "wrong password"; a later block
      // failing is corruption or tampering. Keeping them apart matters for UX.
      throw new SealedAuthError(t("crypto.wrongPassword"));
    }
    try {
      meta = decodeMeta(metaPlain);
    } finally {
      zero(metaPlain);
    }

    const parts: Uint8Array[] = [];
    let produced = 0;
    for (let i = 0; i < chunks; i++) {
      if (options.signal?.aborted) throw new Error("cancelled");
      const start = i * full;
      const end = Math.min(start + full, body.length);
      if (end - start < ov) {
        throw new SealedFormatError("container body is truncated");
      }
      let plain: Uint8Array;
      try {
        plain = await decryptBlock(
          keys,
          header,
          headerBytes,
          i + 1,
          i === chunks - 1,
          body.subarray(start, end),
        );
      } catch {
        throw new SealedAuthError(
          t("crypto.blockFailed", { index: i + 1, total: chunks }),
        );
      }
      parts.push(plain);
      produced += plain.length;
      options.onProgress?.(produced, meta.size);
      if (i % 8 === 7) await yieldToHost();
    }

    const data = concat(...parts);
    // Length is also covered by the AEAD tags; this catches a writer bug rather
    // than an attacker, which is exactly when a loud failure is cheapest.
    if (meta.size !== data.length) {
      zero(data);
      throw new SealedAuthError(t("crypto.sizeMismatch"));
    }
    return { meta, data };
  } finally {
    keys.destroy();
  }
}

export { GCM_TAG_SIZE };
