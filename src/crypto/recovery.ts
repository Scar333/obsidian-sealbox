/**
 * Recovery keys.
 *
 * A recovery key is 32 random bytes rendered in Crockford base32 — an alphabet
 * without I, L, O and U, so it survives being written on paper and typed back
 * in. A two-byte checksum turns a typo into "that key is wrong" instead of a
 * confusing decryption failure.
 */

import { fromBase64, randomBytes, timingSafeEqual, toBase64, bs } from "./bytes.ts";
import { t } from "../i18n/index.ts";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const KEY_BYTES = 32;
const CHECKSUM_BYTES = 2;
const GROUP = 5;

export class RecoveryKeyError extends Error {}

function decodeChar(ch: string): number {
  // Crockford: treat the visually ambiguous characters as their digit twins.
  const c = ch === "I" || ch === "L" ? "1" : ch === "O" ? "0" : ch;
  const idx = ALPHABET.indexOf(c);
  if (idx < 0) throw new RecoveryKeyError(t("recoveryKey.badChar", { char: ch }));
  return idx;
}

function base32Encode(bytes: Uint8Array): string {
  let out = "";
  let acc = 0;
  let bits = 0;
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += ALPHABET[(acc >>> bits) & 31];
    }
  }
  if (bits > 0) out += ALPHABET[(acc << (5 - bits)) & 31];
  return out;
}

function base32Decode(text: string): Uint8Array {
  const clean = text.toUpperCase().replace(/[\s-]/g, "");
  if (clean.length === 0) throw new RecoveryKeyError(t("recoveryKey.empty"));
  const bytes: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const ch of clean) {
    acc = (acc << 5) | decodeChar(ch);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((acc >>> bits) & 0xff);
    }
  }
  return new Uint8Array(bytes);
}

async function checksum(bytes: Uint8Array): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", bs(bytes));
  return new Uint8Array(digest).subarray(0, CHECKSUM_BYTES);
}

/** Group into chunks of five for legibility: `A1B2C-D3E4F-...`. */
function group(text: string): string {
  const parts: string[] = [];
  for (let i = 0; i < text.length; i += GROUP) parts.push(text.slice(i, i + GROUP));
  return parts.join("-");
}

export interface GeneratedRecoveryKey {
  /** What the user writes down. */
  display: string;
  /** Raw key material; zero it once wrapped. */
  raw: Uint8Array;
}

export async function generateRecoveryKey(): Promise<GeneratedRecoveryKey> {
  const raw = randomBytes(KEY_BYTES);
  const sum = await checksum(raw);
  const payload = new Uint8Array(KEY_BYTES + CHECKSUM_BYTES);
  payload.set(raw, 0);
  payload.set(sum, KEY_BYTES);
  const display = group(base32Encode(payload));
  payload.fill(0);
  return { display, raw };
}

/** Parse a typed-in recovery key, verifying the checksum. */
export async function parseRecoveryKey(text: string): Promise<Uint8Array> {
  const decoded = base32Decode(text);
  if (decoded.length < KEY_BYTES + CHECKSUM_BYTES) {
    throw new RecoveryKeyError(t("recoveryKey.short"));
  }
  const raw = decoded.slice(0, KEY_BYTES);
  const given = decoded.subarray(KEY_BYTES, KEY_BYTES + CHECKSUM_BYTES);
  const want = await checksum(raw);
  if (!timingSafeEqual(given, want)) {
    raw.fill(0);
    throw new RecoveryKeyError(t("recoveryKey.checksum"));
  }
  return raw;
}

/**
 * Round-trip helper used by the "confirm you wrote it down" step: compares what
 * the user typed against the generated key without keeping either in a closure.
 */
export async function recoveryKeyMatches(
  typed: string,
  expectedRaw: Uint8Array,
): Promise<boolean> {
  let raw: Uint8Array;
  try {
    raw = await parseRecoveryKey(typed);
  } catch {
    return false;
  }
  const ok = timingSafeEqual(raw, expectedRaw);
  raw.fill(0);
  return ok;
}

export { toBase64, fromBase64 };
