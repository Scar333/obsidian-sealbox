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

// Real plugin writers -> independent recovery reader, across every supported mode.
import { attachRecoveryKey } from "../src/crypto/keyring.ts";
import { generateRecoveryKey } from "../src/crypto/recovery.ts";
import { access, copyFile } from "node:fs/promises";
import { build } from "esbuild";

const ARGON_CHEAP: KdfParams = { id: 1, memoryKiB: 64, time: 1, lanes: 1, iterations: 0 };
for (const params of [PBKDF2_CHEAP, ARGON_CHEAP]) {
  for (const cascade of [false, true]) {
    for (const own of [false, true]) {
      test(`recovery reader: kdf=${params.id}, cascade=${cascade}, own password=${own}`, async () => {
        const dir = await workdir();
        const password = utf8("пароль with spaces 🦭");
        const { file, masterKey } = await createKeyring(password, params);
        const plain = randomBytes(40 * 1024 + 1);
        const container = await seal(plain, defaultMeta("notes.bin", "application/octet-stream", plain.length),
          own ? { kind: "password", password, params } : { kind: "vault", masterKey }, { cascade, chunkKiB: 16 });
        await writeFile(join(dir, "input.sealed"), container);
        await writeFile(join(dir, "keyring.json"), JSON.stringify(file));
        // Windows editor: BOM + CRLF; password itself must remain unchanged.
        await writeFile(join(dir, "pw"), "\uFEFF" + new TextDecoder().decode(password) + "\r\n");
        await run(process.execPath, [TOOL, join(dir, "input.sealed"), "--keyring", join(dir, "keyring.json"), "--password-file", join(dir, "pw"), "--out", join(dir, "out")]);
        assert.deepEqual(new Uint8Array(await readFile(join(dir, "out"))), plain);
      });
    }
  }
}

test("recovery key opens an Argon2id vault with cascade, even without the password", async () => {
  const dir = await workdir();
  const pw = utf8("lost master password");
  const { file, masterKey } = await createKeyring(pw, ARGON_CHEAP);
  const recovery = await generateRecoveryKey();
  const keyring = await attachRecoveryKey(file, pw, recovery.raw);
  const plain = utf8("recovered without Obsidian");
  await writeFile(join(dir, "keyring.json"), JSON.stringify(keyring));
  await writeFile(join(dir, "recovery.txt"), recovery.display);
  await writeFile(join(dir, "input.sealed"), await seal(plain, defaultMeta("recovered.txt", "text/plain", plain.length), { kind: "vault", masterKey }, { cascade: true }));
  await run(process.execPath, [TOOL, join(dir, "input.sealed"), "--keyring", join(dir, "keyring.json"), "--recovery-key-file", join(dir, "recovery.txt"), "--out", join(dir, "out")]);
  assert.deepEqual(new Uint8Array(await readFile(join(dir, "out"))), plain);
  await writeFile(join(dir, "recovery.txt"), "0".repeat(55));
  await assert.rejects(() => run(process.execPath, [TOOL, join(dir, "input.sealed"), "--keyring", join(dir, "keyring.json"), "--recovery-key-file", join(dir, "recovery.txt"), "--out", join(dir, "bad")]), (e: any) => /checksum|does not match/.test(e.stderr));
  await assert.rejects(access(join(dir, "bad")));
});

test("reader never overwrites input or existing output, and damaged files produce no plaintext", async () => {
  const dir = await workdir();
  const password = utf8("pw");
  const data = utf8("hello");
  const c = await seal(data, defaultMeta("safe.txt", "text/plain", data.length), { kind: "password", password, params: PBKDF2_CHEAP });
  const input = join(dir, "input.sealed"), pw = join(dir, "pw"), output = join(dir, "out");
  await writeFile(input, c); await writeFile(pw, password); await writeFile(output, "KEEP");
  const args = [TOOL, input, "--password-file", pw, "--out"];
  for (const target of [input, output]) {
    await assert.rejects(() => run(process.execPath, [...args, target]), (e: any) => /already exists/.test(e.stderr));
  }
  assert.deepEqual(new Uint8Array(await readFile(input)), c);
  assert.equal(await readFile(output, "utf8"), "KEEP");
  for (const broken of [c.slice(0, 48 + new DataView(c.buffer).getUint32(40, true)), c.slice()]) {
    if (broken.length === c.length) broken[broken.length - 1] ^= 1;
    await writeFile(input, broken);
    await assert.rejects(() => run(process.execPath, [...args, join(dir, "absent")]), (e: any) => /truncated|integrity/.test(e.stderr));
    await assert.rejects(access(join(dir, "absent")));
  }
});

test("reader rejects traversal metadata and invalid CLI options", async () => {
  const dir = await workdir();
  const pw = join(dir, "pw"), input = join(dir, "in.sealed");
  await writeFile(pw, "pw");
  await writeFile(input, await seal(utf8("x"), defaultMeta("../escape.txt", "text/plain", 1), { kind: "password", password: utf8("pw"), params: PBKDF2_CHEAP }));
  await assert.rejects(() => run(process.execPath, [TOOL, input, "--password-file", pw, "--out", join(dir, "out")]), (e: any) => /unsafe original name/.test(e.stderr));
  for (const args of [[input, "--out"], [input, input], [input, "--recovery"], [input, "--unknown"]]) {
    await assert.rejects(() => run(process.execPath, [TOOL, ...args]));
  }
  const { stdout } = await run(process.execPath, [TOOL, "--help"]);
  assert.match(stdout, /--recovery/);
});

test("bundled recovery file runs outside the repository without node_modules", async () => {
  const dir = await workdir();
  const bundled = join(dir, "sealbox-decrypt.mjs");
  // Bundle exactly as the release pack does, then copy away from its module tree.
  await build({ entryPoints: [TOOL], outfile: bundled, bundle: true, platform: "node", format: "esm", target: "node22", legalComments: "eof" });
  const pw = utf8("offline password");
  const { file, masterKey } = await createKeyring(pw, ARGON_CHEAP);
  const recovery = await generateRecoveryKey();
  const keyring = await attachRecoveryKey(file, pw, recovery.raw);
  await writeFile(join(dir, "keyring.json"), JSON.stringify(keyring));
  await writeFile(join(dir, "recovery.txt"), recovery.display);
  await writeFile(join(dir, "input.sealed"), await seal(utf8("offline"), defaultMeta("offline.txt", "text/plain", 7), { kind: "vault", masterKey }, { cascade: true }));
  await run(process.execPath, [bundled, join(dir, "input.sealed"), "--keyring", join(dir, "keyring.json"), "--recovery-key-file", join(dir, "recovery.txt"), "--out", join(dir, "out")], { cwd: dir });
  assert.equal(await readFile(join(dir, "out"), "utf8"), "offline");
  // Plain source on its own reports missing helpers truthfully.
  await copyFile(TOOL, join(dir, "source.mjs"));
  await assert.rejects(() => run(process.execPath, [join(dir, "source.mjs"), join(dir, "input.sealed"), "--keyring", join(dir, "keyring.json"), "--recovery-key-file", join(dir, "recovery.txt"), "--out", join(dir, "missing")]), (e: any) => /helper is missing/.test(e.stderr));
});
