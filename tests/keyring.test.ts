import { test } from "node:test";
import assert from "node:assert/strict";

import { randomBytes, utf8 } from "../src/crypto/bytes.ts";
import { SealedAuthError, KDF_PBKDF2_SHA512 } from "../src/crypto/container.ts";
import {
  attachRecoveryKey,
  changeMasterPassword,
  createKeyring,
  KeyringDamagedError,
  resetPasswordWithRecoveryKey,
  unlockKeyring,
  unlockWithRecoveryKey,
  validateKeyring,
  type KeyringFile,
} from "../src/crypto/keyring.ts";
import {
  generateRecoveryKey,
  parseRecoveryKey,
  recoveryKeyMatches,
  RecoveryKeyError,
} from "../src/crypto/recovery.ts";
import { defaultMeta, seal, unseal } from "../src/crypto/seal.ts";
import { SealedFormatError } from "../src/crypto/container.ts";
import type { KdfParams } from "../src/crypto/kdf.ts";

/** Fast parameters: these tests exercise the keyring, not the cost of the KDF. */
const CHEAP: KdfParams = {
  id: KDF_PBKDF2_SHA512,
  memoryKiB: 0,
  time: 0,
  lanes: 0,
  iterations: 10000,
};

const pw = (s: string) => utf8(s);

/** Round-trip a keyring through JSON, the way it is actually persisted. */
function persisted(file: KeyringFile): KeyringFile {
  return validateKeyring(JSON.parse(JSON.stringify(file)));
}

test("creates a keyring and unlocks it with the same password", async () => {
  const { file, masterKey } = await createKeyring(pw("hunter2 is bad"), CHEAP);
  assert.ok(file.mk.c.length > 0);
  assert.ok(file.verifier.c.length > 0);

  const again = await unlockKeyring(persisted(file), pw("hunter2 is bad"));
  // Both keys must derive the same per-file key, so a file sealed with one
  // opens with the other.
  const plain = randomBytes(256);
  const container = await seal(plain, defaultMeta("a.bin", "application/octet-stream", 256), {
    kind: "vault",
    masterKey,
  });
  const out = await unseal(container, { kind: "vault", masterKey: again });
  assert.deepEqual(out.data, plain);
});

test("rejects the wrong password as an auth error", async () => {
  const { file } = await createKeyring(pw("correct"), CHEAP);
  await assert.rejects(
    () => unlockKeyring(persisted(file), pw("incorrect")),
    (e: unknown) => e instanceof SealedAuthError,
  );
});

test("tells a damaged keyring apart from a wrong password", async () => {
  const { file } = await createKeyring(pw("correct"), CHEAP);
  const damaged = persisted(file);
  // Corrupt the wrapped master key but leave the verifier intact: the password
  // is right, so this must NOT be reported as a typo.
  const bytes = Buffer.from(damaged.mk.c, "base64");
  bytes[0] ^= 0xff;
  damaged.mk = { ...damaged.mk, c: bytes.toString("base64") };
  await assert.rejects(
    () => unlockKeyring(damaged, pw("correct")),
    (e: unknown) => e instanceof KeyringDamagedError,
  );
});

test("a box cannot be moved between keyring slots", async () => {
  const { file } = await createKeyring(pw("correct"), CHEAP);
  const swapped = persisted(file);
  // The verifier and the master key are sealed under different AAD labels, so
  // pasting one into the other's slot must fail.
  swapped.mk = swapped.verifier;
  await assert.rejects(
    () => unlockKeyring(swapped, pw("correct")),
    (e: unknown) => e instanceof KeyringDamagedError,
  );
});

test("changing the password keeps every sealed file readable", async () => {
  const { file, masterKey } = await createKeyring(pw("old password"), CHEAP);
  const plain = randomBytes(1000);
  const container = await seal(plain, defaultMeta("x.bin", "application/octet-stream", 1000), {
    kind: "vault",
    masterKey,
  });

  const updated = await changeMasterPassword(persisted(file), pw("old password"), pw("new password"), CHEAP);
  await assert.rejects(
    () => unlockKeyring(persisted(updated), pw("old password")),
    (e: unknown) => e instanceof SealedAuthError,
  );

  const newKey = await unlockKeyring(persisted(updated), pw("new password"));
  const out = await unseal(container, { kind: "vault", masterKey: newKey });
  assert.deepEqual(out.data, plain, "the master key must survive a password change");
});

test("changing the password needs the old one", async () => {
  const { file } = await createKeyring(pw("old"), CHEAP);
  await assert.rejects(
    () => changeMasterPassword(persisted(file), pw("guess"), pw("new"), CHEAP),
    (e: unknown) => e instanceof SealedAuthError,
  );
});

test("a recovery key opens the vault and can reset the password", async () => {
  const { file, masterKey } = await createKeyring(pw("forgotten"), CHEAP);
  const plain = randomBytes(600);
  const container = await seal(plain, defaultMeta("y.bin", "application/octet-stream", 600), {
    kind: "vault",
    masterKey,
  });

  const recovery = await generateRecoveryKey();
  const withRecovery = persisted(await attachRecoveryKey(persisted(file), pw("forgotten"), recovery.raw));
  assert.ok(withRecovery.recovery, "the recovery slot must be stored");

  const parsed = await parseRecoveryKey(recovery.display);
  const recovered = await unlockWithRecoveryKey(withRecovery, parsed);
  assert.deepEqual(
    (await unseal(container, { kind: "vault", masterKey: recovered })).data,
    plain,
  );

  const reset = persisted(
    await resetPasswordWithRecoveryKey(withRecovery, parsed, pw("brand new"), CHEAP),
  );
  const afterReset = await unlockKeyring(reset, pw("brand new"));
  assert.deepEqual(
    (await unseal(container, { kind: "vault", masterKey: afterReset })).data,
    plain,
    "files must still open after a recovery-key password reset",
  );
});

test("a recovery key from another vault is rejected", async () => {
  const a = await createKeyring(pw("a"), CHEAP);
  const recoveryA = await generateRecoveryKey();
  const fileA = persisted(await attachRecoveryKey(persisted(a.file), pw("a"), recoveryA.raw));

  const other = await generateRecoveryKey();
  const otherRaw = await parseRecoveryKey(other.display);
  await assert.rejects(
    () => unlockWithRecoveryKey(fileA, otherRaw),
    (e: unknown) => e instanceof SealedAuthError,
  );
});

test("recovery keys survive formatting and catch typos", async () => {
  const generated = await generateRecoveryKey();
  assert.match(generated.display, /^[0-9A-HJKMNP-TV-Z-]+$/, "must be Crockford base32");

  const raw = await parseRecoveryKey(generated.display);
  assert.equal(raw.length, 32);

  // Case, spacing and the ambiguous characters must all be forgiven.
  const mangled = generated.display.toLowerCase().replace(/-/g, " ");
  assert.deepEqual(await parseRecoveryKey(mangled), raw);
  assert.equal(await recoveryKeyMatches(mangled, raw), true);

  // A single changed character must be caught by the checksum.
  const chars = [...generated.display.replace(/-/g, "")];
  chars[0] = chars[0] === "0" ? "1" : "0";
  await assert.rejects(
    () => parseRecoveryKey(chars.join("")),
    (e: unknown) => e instanceof RecoveryKeyError,
  );
  assert.equal(await recoveryKeyMatches(chars.join(""), raw), false);
});

test("validateKeyring refuses malformed or future files", () => {
  assert.throws(() => validateKeyring(null), KeyringDamagedError);
  assert.throws(() => validateKeyring({ sealbox: 99 }), KeyringDamagedError);
  assert.throws(() => validateKeyring({ sealbox: 1 }), KeyringDamagedError);
  assert.throws(
    () => validateKeyring({ sealbox: 1, kdf: {}, mk: { n: 1, c: 2 }, verifier: {} }),
    KeyringDamagedError,
  );
});

// --- revoking a recovery key ------------------------------------------------

test("changing the password revokes the old recovery key", async () => {
  // The flaw this pins down: a recovery key is a second, independent way into
  // the same master key. Leaving it in place made a password change useless
  // against the one thing people change their password for — somebody else
  // having gained a way in. The old key kept working for ever.
  const { file, masterKey } = await createKeyring(pw("old password"), CHEAP);
  const plain = randomBytes(256);
  const container = await seal(plain, defaultMeta("f.bin", "application/octet-stream", 256), {
    kind: "vault",
    masterKey,
  });

  const leaked = await generateRecoveryKey();
  const withKey = persisted(await attachRecoveryKey(persisted(file), pw("old password"), leaked.raw));
  const leakedRaw = await parseRecoveryKey(leaked.display);
  // It works before the change, so the test below is about the change itself.
  await unlockWithRecoveryKey(withKey, leakedRaw);

  const changed = persisted(
    await changeMasterPassword(withKey, pw("old password"), pw("new password"), CHEAP),
  );
  assert.equal(changed.recovery, undefined, "the old recovery slot must be gone");
  await assert.rejects(
    () => unlockWithRecoveryKey(changed, leakedRaw),
    (e: unknown) => e instanceof SealedFormatError || e instanceof SealedAuthError,
    "a leaked recovery key must not survive a password change",
  );

  // The files themselves are untouched and open with the new password.
  const key = await unlockKeyring(changed, pw("new password"));
  assert.deepEqual((await unseal(container, { kind: "vault", masterKey: key })).data, plain);
});

test("a replacement recovery key can be issued in the same step", async () => {
  const { file, masterKey } = await createKeyring(pw("old"), CHEAP);
  const plain = randomBytes(128);
  const container = await seal(plain, defaultMeta("f.bin", "application/octet-stream", 128), {
    kind: "vault",
    masterKey,
  });

  const old = await generateRecoveryKey();
  const withKey = persisted(await attachRecoveryKey(persisted(file), pw("old"), old.raw));

  const replacement = await generateRecoveryKey();
  const changed = persisted(
    await changeMasterPassword(withKey, pw("old"), pw("new"), CHEAP, {
      newRecoveryKeyRaw: replacement.raw,
    }),
  );

  // Old one dead, new one alive, and no window in between with no recovery.
  const oldRaw = await parseRecoveryKey(old.display);
  const replacementRaw = await parseRecoveryKey(replacement.display);
  await assert.rejects(
    () => unlockWithRecoveryKey(changed, oldRaw),
    (e: unknown) => e instanceof SealedAuthError,
  );
  const recovered = await unlockWithRecoveryKey(changed, replacementRaw);
  assert.deepEqual(
    (await unseal(container, { kind: "vault", masterKey: recovered })).data,
    plain,
    "the replacement must open the same files",
  );
});

test("recovering with a key keeps that key working afterwards", async () => {
  // The opposite choice, deliberately: the user has just proved they hold this
  // key, and taking it away at the moment it was needed would strand them if the
  // brand-new password is forgotten too.
  const { file } = await createKeyring(pw("forgotten"), CHEAP);
  const recovery = await generateRecoveryKey();
  const withKey = persisted(await attachRecoveryKey(persisted(file), pw("forgotten"), recovery.raw));
  const raw = await parseRecoveryKey(recovery.display);

  const reset = persisted(await resetPasswordWithRecoveryKey(withKey, raw, pw("fresh"), CHEAP));
  assert.ok(reset.recovery, "the recovery slot must still be there");
  await unlockWithRecoveryKey(reset, raw);
  await unlockKeyring(reset, pw("fresh"));
});
