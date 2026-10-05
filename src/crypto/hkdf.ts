/**
 * HKDF-SHA256 helpers.
 *
 * The vault master key lives as a non-extractable HKDF `CryptoKey`, so its raw
 * bytes never exist in the JS heap after unlock. Per-file keys are derived from
 * it with a random per-file salt, which is cheap — the expensive password KDF
 * runs once per unlock, not once per file.
 */

import { bs, utf8, zero } from "./bytes.ts";

export const HKDF_INFO_FILE = "sealbox-file-v1";
export const HKDF_INFO_AES = "sealbox-aes-v1";
export const HKDF_INFO_XCHACHA = "sealbox-xchacha-v1";
export const HKDF_INFO_XNONCE = "sealbox-xnonce-v1";
export const HKDF_INFO_RECOVERY = "sealbox-recovery-v1";

/** Import raw bytes as an HKDF base key. Never extractable. */
export async function importHkdfBase(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", bs(raw), "HKDF", false, ["deriveBits"]);
}

export async function hkdfBytes(
  base: CryptoKey,
  salt: Uint8Array,
  info: string,
  length: number,
): Promise<Uint8Array> {
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: bs(salt), info: bs(utf8(info)) },
    base,
    length * 8,
  );
  return new Uint8Array(bits);
}

/** Expand raw key material into one labelled subkey, then forget the base. */
export async function expandOnce(
  ikm: Uint8Array,
  info: string,
  length: number,
): Promise<Uint8Array> {
  const base = await importHkdfBase(ikm);
  return hkdfBytes(base, new Uint8Array(0), info, length);
}

/** Import 32 raw bytes as a non-extractable AES-256-GCM key, wiping the input. */
export async function importAesKey(raw: Uint8Array): Promise<CryptoKey> {
  if (raw.length !== 32) throw new Error("AES key must be 32 bytes");
  const key = await crypto.subtle.importKey("raw", bs(raw), "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
  zero(raw);
  return key;
}
