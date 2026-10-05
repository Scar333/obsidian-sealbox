/**
 * Cross-check between the plugin and the standalone decryptor.
 *
 * `tools/sealbox-decrypt.mjs` reimplements the container format from the written
 * specification, sharing no code with `src/`. If both agree on the same bytes,
 * the format is documented correctly — and the escape hatch really works, which
 * is the whole point of having one.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { randomBytes, utf8 } from "../src/crypto/bytes.ts";
import { KDF_PBKDF2_SHA512 } from "../src/crypto/container.ts";
import { createKeyring } from "../src/crypto/keyring.ts";
import { defaultMeta, seal } from "../src/crypto/seal.ts";
import type { KdfParams } from "../src/crypto/kdf.ts";

const run = promisify(execFile);
const TOOL = join(import.meta.dirname, "..", "tools", "sealbox-decrypt.mjs");

const PBKDF2_CHEAP: KdfParams = {
  id: KDF_PBKDF2_SHA512,
  memoryKiB: 0,
  time: 0,
  lanes: 0,
  iterations: 10000,
};

async function workdir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "sealbox-interop-"));
}

test("the standalone tool opens a vault-keyed container", async () => {
  const dir = await workdir();
  const password = "an interop password";
  const { file, masterKey } = await createKeyring(utf8(password), PBKDF2_CHEAP);

  const plain = randomBytes(300 * 1024); // spans several default-sized chunks
  const container = await seal(
    plain,
    defaultMeta("report.pdf", "application/pdf", plain.length),
    { kind: "vault", masterKey },
    { chunkKiB: 64 },
  );

  const keyringPath = join(dir, "keyring.json");
  const containerPath = join(dir, "report.pdf.sealed");
  const passwordPath = join(dir, "pw");
  const outPath = join(dir, "out.bin");
  await writeFile(keyringPath, JSON.stringify(file, null, 2));
  await writeFile(containerPath, container);
  await writeFile(passwordPath, password);

  const { stderr } = await run("node", [
    TOOL,
    containerPath,
    "--keyring",
    keyringPath,
    "--password-file",
    passwordPath,
    "--out",
    outPath,
  ]);
  assert.match(stderr, /decrypted report\.pdf \(application\/pdf, 307200 bytes\)/);
  assert.deepEqual(new Uint8Array(await readFile(outPath)), plain);
});

test("the standalone tool opens a file sealed with its own password", async () => {
  const dir = await workdir();
  const password = "per-file password";
  const plain = utf8("a short secret note\n");
  const container = await seal(
    plain,
    defaultMeta("note.md", "text/markdown", plain.length),
    { kind: "password", password: utf8(password), params: PBKDF2_CHEAP },
  );

  const containerPath = join(dir, "note.md.sealed");
  const passwordPath = join(dir, "pw");
  await writeFile(containerPath, container);
  await writeFile(passwordPath, password);

  const { stdout } = await run("node", [
    TOOL,
    containerPath,
    "--password-file",
    passwordPath,
    "--out",
    "-",
  ]);
  assert.equal(stdout, "a short secret note\n");
});

test("the standalone tool refuses a wrong password and a tampered file", async () => {
  const dir = await workdir();
  const { file, masterKey } = await createKeyring(utf8("right"), PBKDF2_CHEAP);
  const container = await seal(
    utf8("payload"),
    defaultMeta("x.txt", "text/plain", 7),
    { kind: "vault", masterKey },
  );

  const keyringPath = join(dir, "keyring.json");
  await writeFile(keyringPath, JSON.stringify(file));
  await writeFile(join(dir, "wrong"), "wrong");
  await writeFile(join(dir, "right"), "right");

  const good = join(dir, "good.sealed");
  await writeFile(good, container);
  await assert.rejects(
    () => run("node", [TOOL, good, "--keyring", keyringPath, "--password-file", join(dir, "wrong"), "--out", "-"]),
    (e: unknown) => /wrong master password/.test(String((e as { stderr?: string }).stderr)),
  );

  const tampered = container.slice();
  tampered[tampered.length - 1] ^= 0x01;
  const bad = join(dir, "bad.sealed");
  await writeFile(bad, tampered);
  await assert.rejects(
    () => run("node", [TOOL, bad, "--keyring", keyringPath, "--password-file", join(dir, "right"), "--out", "-"]),
    (e: unknown) => /integrity check/.test(String((e as { stderr?: string }).stderr)),
  );
});
