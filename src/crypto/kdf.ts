/**
 * Password-based key derivation.
 *
 * Argon2id is the preferred function but it is not part of WebCrypto, so it
 * arrives as WebAssembly. Android WebViews are the realistic place for that to
 * fail, which is why PBKDF2-SHA512 is a first-class fallback rather than an
 * afterthought: the chosen function and its cost are recorded in the keyring
 * and in every container header, so a file stays readable on a device that can
 * only do one of the two.
 */

import { argon2id } from "hash-wasm";
import { bs } from "./bytes.ts";
import { KDF_ARGON2ID, KDF_PBKDF2_SHA512 } from "./container.ts";

export const DERIVED_KEY_SIZE = 32;

export interface KdfParams {
  id: typeof KDF_ARGON2ID | typeof KDF_PBKDF2_SHA512;
  /** Argon2id memory in KiB. Unused by PBKDF2. */
  memoryKiB: number;
  /** Argon2id time cost (passes). Unused by PBKDF2. */
  time: number;
  /** Argon2id lanes. Unused by PBKDF2. */
  lanes: number;
  /** PBKDF2 iteration count. Unused by Argon2id. */
  iterations: number;
}

/**
 * OWASP-flavoured defaults. The mobile profile is lower on purpose: a 64 MiB
 * Argon2 allocation is a realistic way to have an Android WebView killed
 * mid-unlock, and a failed unlock is worse than a slightly cheaper KDF.
 */
export const ARGON2_DESKTOP: KdfParams = {
  id: KDF_ARGON2ID,
  memoryKiB: 65536,
  time: 3,
  lanes: 1,
  iterations: 0,
};

export const ARGON2_MOBILE: KdfParams = {
  id: KDF_ARGON2ID,
  memoryKiB: 32768,
  time: 3,
  lanes: 1,
  iterations: 0,
};

export const PBKDF2_FALLBACK: KdfParams = {
  id: KDF_PBKDF2_SHA512,
  memoryKiB: 0,
  time: 0,
  lanes: 0,
  iterations: 1200000,
};

export function describeKdf(p: KdfParams): string {
  return p.id === KDF_ARGON2ID
    ? `Argon2id (${Math.round(p.memoryKiB / 1024)} MiB, t=${p.time}, p=${p.lanes})`
    : `PBKDF2-SHA512 (${p.iterations.toLocaleString("en-US")} iterations)`;
}

/**
 * Derive 32 bytes of key material from a password.
 *
 * `password` is taken as bytes rather than a string so the caller can zero it
 * afterwards; a JS string cannot be wiped.
 */
export async function deriveFromPassword(
  password: Uint8Array,
  salt: Uint8Array,
  params: KdfParams,
): Promise<Uint8Array> {
  if (password.length === 0) throw new Error("empty password");
  if (salt.length < 8) throw new Error("salt is too short");

  if (params.id === KDF_ARGON2ID) {
    const hash = await argon2id({
      password,
      salt,
      parallelism: params.lanes,
      iterations: params.time,
      memorySize: params.memoryKiB,
      hashLength: DERIVED_KEY_SIZE,
      outputType: "binary",
    });
    return hash instanceof Uint8Array ? hash : new Uint8Array(hash);
  }

  const base = await crypto.subtle.importKey("raw", bs(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-512",
      salt: bs(salt),
      iterations: params.iterations,
    },
    base,
    DERIVED_KEY_SIZE * 8,
  );
  return new Uint8Array(bits);
}

export interface Argon2Probe {
  available: boolean;
  milliseconds: number;
  error?: string;
}

/**
 * Check that Argon2id actually runs here, with the parameters we intend to use.
 * Called by the diagnostics screen, which is the only practical way to find
 * out what an Android device does without attaching a debugger to it.
 */
export async function probeArgon2(params: KdfParams): Promise<Argon2Probe> {
  const started = Date.now();
  try {
    const out = await deriveFromPassword(
      new Uint8Array([0x70, 0x72, 0x6f, 0x62, 0x65]),
      new Uint8Array(16),
      params,
    );
    const ok = out.length === DERIVED_KEY_SIZE;
    out.fill(0);
    return {
      available: ok,
      milliseconds: Date.now() - started,
      ...(ok ? {} : { error: "unexpected output length" }),
    };
  } catch (e) {
    return {
      available: false,
      milliseconds: Date.now() - started,
      error: e instanceof Error ? e.message : "unknown error",
    };
  }
}
