/**
 * Byte helpers. Deliberately free of Node APIs (`Buffer`, `node:crypto`) so the
 * exact same code runs in Electron and in the Android WebView.
 */

const B64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Reverse lookup for base64 decoding; -1 marks an invalid character. */
const B64_LOOKUP = (() => {
  const t = new Int8Array(256).fill(-1);
  for (let i = 0; i < B64_ALPHABET.length; i++) {
    t[B64_ALPHABET.charCodeAt(i)] = i;
  }
  return t;
})();

export function toBase64(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out +=
      B64_ALPHABET[(n >>> 18) & 63] +
      B64_ALPHABET[(n >>> 12) & 63] +
      B64_ALPHABET[(n >>> 6) & 63] +
      B64_ALPHABET[n & 63];
  }
  const left = bytes.length - i;
  if (left === 1) {
    const n = bytes[i] << 16;
    out += B64_ALPHABET[(n >>> 18) & 63] + B64_ALPHABET[(n >>> 12) & 63] + "==";
  } else if (left === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out +=
      B64_ALPHABET[(n >>> 18) & 63] +
      B64_ALPHABET[(n >>> 12) & 63] +
      B64_ALPHABET[(n >>> 6) & 63] +
      "=";
  }
  return out;
}

export function fromBase64(text: string): Uint8Array {
  let clean = "";
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 0x3d) break; // '='
    if (B64_LOOKUP[c] < 0) {
      // Tolerate whitespace only; anything else is a malformed field.
      if (c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09) continue;
      throw new Error("invalid base64 input");
    }
    clean += text[i];
  }
  const outLen = Math.floor((clean.length * 6) / 8);
  const out = new Uint8Array(outLen);
  let acc = 0;
  let bits = 0;
  let o = 0;
  for (let i = 0; i < clean.length; i++) {
    acc = (acc << 6) | B64_LOOKUP[clean.charCodeAt(i)];
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >>> bits) & 0xff;
    }
  }
  return out;
}

const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

export function utf8(text: string): Uint8Array {
  return utf8Encoder.encode(text);
}

export function fromUtf8(bytes: Uint8Array): string {
  return utf8Decoder.decode(bytes);
}

/**
 * Overwrite buffers in place. JS gives no guarantee that the memory is not
 * copied elsewhere by the GC, but zeroing still shortens the window in which
 * key material sits in a live heap object.
 *
 * This is a cleanup primitive: it runs on the paths that wipe plaintext when the
 * vault locks or a view closes, so it must never throw. A buffer handed to a
 * Worker has been *transferred* — pdf.js does exactly this — which detaches the
 * ArrayBuffer on this side, makes `byteLength` zero and makes `fill` throw. In
 * that case there is nothing left here to wipe, and refusing to continue would
 * leave the rest of the plaintext un-wiped.
 */
export function zero(...buffers: Array<Uint8Array | null | undefined>): void {
  for (const b of buffers) {
    if (!b || b.byteLength === 0) continue;
    try {
      b.fill(0);
    } catch {
      // Detached (transferred to a worker) or otherwise not ours any more.
    }
  }
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** Comparison whose running time does not depend on where the first difference is. */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * WebCrypto wants `BufferSource`; depending on the TS lib/@types/node combination
 * a plain `Uint8Array` is not assignable to it. Keeping the cast in one place
 * stops it from being sprinkled through the crypto code.
 */
export function bs(bytes: Uint8Array): BufferSource {
  return bytes as unknown as BufferSource;
}

/**
 * Cryptographically secure random bytes, of any length.
 *
 * `crypto.getRandomValues` throws a QuotaExceededError above 65 536 bytes, so
 * large requests have to be filled in windows. Everything security-critical here
 * asks for 32 bytes or fewer, but the benchmark and test paths ask for megabytes
 * and must not blow up.
 */
export function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  const MAX_PER_CALL = 65536;
  for (let offset = 0; offset < length; offset += MAX_PER_CALL) {
    crypto.getRandomValues(
      out.subarray(offset, Math.min(offset + MAX_PER_CALL, length)),
    );
  }
  return out;
}

/** Little-endian u64 written through a DataView to avoid BigInt on hot paths. */
export function writeU64LE(
  view: DataView,
  offset: number,
  value: number,
): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("u64 out of range");
  }
  view.setUint32(offset, value >>> 0, true);
  view.setUint32(offset + 4, Math.floor(value / 0x100000000), true);
}
