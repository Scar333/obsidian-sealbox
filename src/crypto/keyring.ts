/**
 * The keyring: a small JSON file that holds the vault master key, wrapped.
 *
 * Two independent wrappings of the same master key exist: one under a key
 * derived from the master password, one under the recovery key. That is what
 * makes "change my password" a one-second operation instead of re-encrypting
 * the whole vault, and what makes a forgotten password survivable.
 *
 * The keyring is expected to be synced between devices — without it a phone
 * cannot open what a desktop sealed. Losing it loses everything, which is why
 * the recovery key exists and why callers must never overwrite it blindly.
 */

import { bs, fromBase64, randomBytes, toBase64, utf8, zero } from "./bytes.ts";
import { SealedAuthError, SealedFormatError, KDF_ARGON2ID, KDF_PBKDF2_SHA512 } from "./container.ts";
import { expandOnce, importAesKey, importHkdfBase, HKDF_INFO_RECOVERY } from "./hkdf.ts";
import { deriveFromPassword, type KdfParams } from "./kdf.ts";
import { t } from "../i18n/index.ts";

export const KEYRING_VERSION = 1;
export const KEYRING_FILENAME = "keyring.json";

const VERIFIER_PLAINTEXT = utf8("sealbox-verify-v1");

/** Domain labels, so a box from one slot cannot be pasted into another. */
const AAD_MK = utf8("sealbox-keyring-v1/master-key");
const AAD_VERIFIER = utf8("sealbox-keyring-v1/verifier");
const AAD_RECOVERY = utf8("sealbox-keyring-v1/recovery-master-key");

const MK_SIZE = 32;

interface StoredBox {
  n: string;
  c: string;
}

interface StoredKdf {
  id: number;
  m: number;
  t: number;
  p: number;
  iter: number;
  salt: string;
}

export interface KeyringFile {
  sealbox: number;
  kdf: StoredKdf;
  mk: StoredBox;
  verifier: StoredBox;
  recovery?: {
    salt: string;
    mk: StoredBox;
    created: string;
  };
  created: string;
}

export class KeyringDamagedError extends Error {}

function storeKdf(params: KdfParams, salt: Uint8Array): StoredKdf {
  return {
    id: params.id,
    m: params.memoryKiB,
    t: params.time,
    p: params.lanes,
    iter: params.iterations,
    salt: toBase64(salt),
  };
}

function loadKdf(stored: StoredKdf): { params: KdfParams; salt: Uint8Array } {
  if (stored.id !== KDF_ARGON2ID && stored.id !== KDF_PBKDF2_SHA512) {
    throw new KeyringDamagedError(t("crypto.keyringUnknownKdf"));
  }
  const salt = fromBase64(stored.salt);
  if (salt.length < 16) throw new KeyringDamagedError(t("crypto.keyringSaltShort"));
  return {
    params: {
      id: stored.id,
      memoryKiB: stored.m,
      time: stored.t,
      lanes: stored.p,
      iterations: stored.iter,
    },
    salt,
  };
}

async function sealBox(
  key: CryptoKey,
  aad: Uint8Array,
  plain: Uint8Array,
): Promise<StoredBox> {
  const nonce = randomBytes(12);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: bs(nonce), additionalData: bs(aad), tagLength: 128 },
    key,
    bs(plain),
  );
  return { n: toBase64(nonce), c: toBase64(new Uint8Array(ct)) };
}

async function openBox(
  key: CryptoKey,
  aad: Uint8Array,
  box: StoredBox,
): Promise<Uint8Array> {
  const nonce = fromBase64(box.n);
  const ct = fromBase64(box.c);
  if (nonce.length !== 12) throw new KeyringDamagedError(t("crypto.keyringBadNonce"));
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bs(nonce), additionalData: bs(aad), tagLength: 128 },
    key,
    bs(ct),
  );
  return new Uint8Array(plain);
}

/** Derive the key-encryption key from a password, then forget the raw material. */
async function kekFromPassword(
  password: Uint8Array,
  salt: Uint8Array,
  params: KdfParams,
): Promise<CryptoKey> {
  const derived = await deriveFromPassword(password, salt, params);
  try {
    return await importAesKey(derived.slice()); // importAesKey wipes its argument
  } finally {
    zero(derived);
  }
}

/**
 * The recovery key is already 32 bytes of full-entropy randomness, so it needs
 * HKDF rather than a password-stretching KDF — stretching it would buy nothing
 * and only make recovery slower.
 */
async function kekFromRecoveryKey(
  recoveryRaw: Uint8Array,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const base = await importHkdfBase(recoveryRaw);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: bs(salt), info: bs(utf8(HKDF_INFO_RECOVERY)) },
    base,
    256,
  );
  return importAesKey(new Uint8Array(bits));
}

export function validateKeyring(data: unknown): KeyringFile {
  if (typeof data !== "object" || data === null) {
    throw new KeyringDamagedError(t("crypto.keyringNotObject"));
  }
  const k = data as Partial<KeyringFile>;
  if (k.sealbox !== KEYRING_VERSION) {
    throw new KeyringDamagedError(
      t("crypto.keyringVersion", { version: String(k.sealbox) }),
    );
  }
  if (!k.kdf || !k.mk || !k.verifier) {
    throw new KeyringDamagedError(t("crypto.keyringMissingFields"));
  }
  for (const box of [k.mk, k.verifier]) {
    if (typeof box.n !== "string" || typeof box.c !== "string") {
      throw new KeyringDamagedError(t("crypto.keyringBadBox"));
    }
  }
  return k as KeyringFile;
}

export interface CreatedKeyring {
  file: KeyringFile;
  /** Non-extractable HKDF key; the raw master key no longer exists in the heap. */
  masterKey: CryptoKey;
}

export async function createKeyring(
  password: Uint8Array,
  params: KdfParams,
): Promise<CreatedKeyring> {
  const salt = randomBytes(16);
  const kek = await kekFromPassword(password, salt, params);
  const mkRaw = randomBytes(MK_SIZE);
  try {
    const file: KeyringFile = {
      sealbox: KEYRING_VERSION,
      kdf: storeKdf(params, salt),
      mk: await sealBox(kek, AAD_MK, mkRaw),
      verifier: await sealBox(kek, AAD_VERIFIER, VERIFIER_PLAINTEXT),
      created: new Date().toISOString(),
    };
    return { file, masterKey: await importHkdfBase(mkRaw) };
  } finally {
    zero(mkRaw);
  }
}

/**
 * Recover the raw master key. Confined to this module: everywhere else uses the
 * non-extractable `CryptoKey` instead.
 */
async function openMasterKeyRaw(
  file: KeyringFile,
  password: Uint8Array,
): Promise<Uint8Array> {
  const { params, salt } = loadKdf(file.kdf);
  const kek = await kekFromPassword(password, salt, params);

  // The verifier separates "wrong password" from "damaged keyring". Without it
  // a corrupted file looks exactly like a typo, and the user retypes forever.
  try {
    const probe = await openBox(kek, AAD_VERIFIER, file.verifier);
    zero(probe);
  } catch {
    throw new SealedAuthError(t("crypto.wrongMasterPassword"));
  }

  let mkRaw: Uint8Array;
  try {
    mkRaw = await openMk(kek, file);
  } catch (e) {
    if (e instanceof KeyringDamagedError) throw e;
    throw new KeyringDamagedError(t("crypto.keyringDamagedMk"));
  }
  return mkRaw;
}

async function openMk(kek: CryptoKey, file: KeyringFile): Promise<Uint8Array> {
  const mkRaw = await openBox(kek, AAD_MK, file.mk);
  if (mkRaw.length !== MK_SIZE) {
    zero(mkRaw);
    throw new KeyringDamagedError(t("crypto.keyringMkSize"));
  }
  return mkRaw;
}

export async function unlockKeyring(
  file: KeyringFile,
  password: Uint8Array,
): Promise<CryptoKey> {
  const mkRaw = await openMasterKeyRaw(file, password);
  try {
    return await importHkdfBase(mkRaw);
  } finally {
    zero(mkRaw);
  }
}

export async function unlockWithRecoveryKey(
  file: KeyringFile,
  recoveryRaw: Uint8Array,
): Promise<CryptoKey> {
  if (!file.recovery) {
    throw new SealedFormatError(t("crypto.keyringNoRecovery"));
  }
  const kek = await kekFromRecoveryKey(recoveryRaw, fromBase64(file.recovery.salt));
  let mkRaw: Uint8Array;
  try {
    mkRaw = await openBox(kek, AAD_RECOVERY, file.recovery.mk);
  } catch {
    throw new SealedAuthError(t("crypto.recoveryMismatch"));
  }
  try {
    if (mkRaw.length !== MK_SIZE) {
      throw new KeyringDamagedError(t("crypto.recoveryMalformed"));
    }
    return await importHkdfBase(mkRaw);
  } finally {
    zero(mkRaw);
  }
}

/** Attach (or replace) the recovery slot. Requires the current password. */
export async function attachRecoveryKey(
  file: KeyringFile,
  password: Uint8Array,
  recoveryRaw: Uint8Array,
): Promise<KeyringFile> {
  const mkRaw = await openMasterKeyRaw(file, password);
  try {
    return await withRecoverySlot(file, mkRaw, recoveryRaw);
  } finally {
    zero(mkRaw);
  }
}

/**
 * Change the master password. Only the keyring is rewritten — every sealed file
 * keeps working, because the master key itself does not change.
 *
 * **The existing recovery key stops working.** A recovery key is a second,
 * independent way into the same master key, so leaving it in place would make
 * changing the password useless against the one thing people change it for:
 * someone else having gained a way in. Anyone holding the old key would keep
 * full access for ever, and the obvious remedy would quietly not be one.
 *
 * Pass `newRecoveryKeyRaw` to put a fresh key in its place in the same step. It
 * is wrapped from the master key directly, so this costs no extra password
 * prompt and leaves no window in which the vault has no recovery at all.
 */
export async function changeMasterPassword(
  file: KeyringFile,
  oldPassword: Uint8Array,
  newPassword: Uint8Array,
  params: KdfParams,
  options: { newRecoveryKeyRaw?: Uint8Array } = {},
): Promise<KeyringFile> {
  const mkRaw = await openMasterKeyRaw(file, oldPassword);
  try {
    const rewrapped = await rewrapUnderPassword(file, mkRaw, newPassword, params, false);
    return options.newRecoveryKeyRaw
      ? await withRecoverySlot(rewrapped, mkRaw, options.newRecoveryKeyRaw)
      : rewrapped;
  } finally {
    zero(mkRaw);
  }
}

/** Wrap the master key under a recovery key, replacing any existing slot. */
async function withRecoverySlot(
  file: KeyringFile,
  mkRaw: Uint8Array,
  recoveryRaw: Uint8Array,
): Promise<KeyringFile> {
  const salt = randomBytes(16);
  const kek = await kekFromRecoveryKey(recoveryRaw, salt);
  return {
    ...file,
    recovery: {
      salt: toBase64(salt),
      mk: await sealBox(kek, AAD_RECOVERY, mkRaw),
      created: new Date().toISOString(),
    },
  };
}

/** Set a new password using the recovery key instead of the old password. */
export async function resetPasswordWithRecoveryKey(
  file: KeyringFile,
  recoveryRaw: Uint8Array,
  newPassword: Uint8Array,
  params: KdfParams,
): Promise<KeyringFile> {
  if (!file.recovery) {
    throw new SealedFormatError(t("crypto.keyringNoRecovery"));
  }
  const kek = await kekFromRecoveryKey(recoveryRaw, fromBase64(file.recovery.salt));
  let mkRaw: Uint8Array;
  try {
    mkRaw = await openBox(kek, AAD_RECOVERY, file.recovery.mk);
  } catch {
    throw new SealedAuthError(t("crypto.recoveryMismatch"));
  }
  try {
    // The recovery slot is kept here: the user just proved they hold that key,
    // and taking it away at the very moment it was needed would leave them with
    // no way back if the brand-new password is forgotten too.
    return await rewrapUnderPassword(file, mkRaw, newPassword, params, true);
  } finally {
    zero(mkRaw);
  }
}

async function rewrapUnderPassword(
  file: KeyringFile,
  mkRaw: Uint8Array,
  newPassword: Uint8Array,
  params: KdfParams,
  keepRecovery: boolean,
): Promise<KeyringFile> {
  const salt = randomBytes(16);
  const kek = await kekFromPassword(newPassword, salt, params);
  const rewrapped: KeyringFile = {
    ...file,
    kdf: storeKdf(params, salt),
    mk: await sealBox(kek, AAD_MK, mkRaw),
    verifier: await sealBox(kek, AAD_VERIFIER, VERIFIER_PLAINTEXT),
  };
  if (!keepRecovery) delete rewrapped.recovery;
  return rewrapped;
}

export function describeKeyringKdf(file: KeyringFile): KdfParams {
  return loadKdf(file.kdf).params;
}

export { expandOnce };
