/** One offline file, including Argon2 WASM and XChaCha, plus both guides. */
import { build } from 'esbuild';
import { mkdir, copyFile, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
const out = new URL('dist/recovery/', root);
await mkdir(out, { recursive: true });
await build({
  entryPoints: [fileURLToPath(new URL('tools/sealbox-decrypt.mjs', root))],
  outfile: fileURLToPath(new URL('sealbox-decrypt.mjs', out)),
  bundle: true, platform: 'node', format: 'esm', target: 'node22',
  legalComments: 'eof',
});
for (const [from, to] of [['docs/RECOVERY.en.md', 'RECOVERY.en.md'], ['docs/RECOVERY.ru.md', 'RECOVERY.ru.md'], ['LICENSE', 'LICENSE'], ['node_modules/hash-wasm/LICENSE', 'LICENSE.hash-wasm'], ['node_modules/@noble/ciphers/LICENSE', 'LICENSE.noble-ciphers']]) {
  await copyFile(new URL(from, root), new URL(to, out));
}
const hash = createHash('sha256').update(await readFile(new URL('sealbox-decrypt.mjs', out))).digest('hex');
await writeFile(new URL('SHA256SUMS', out), `${hash}  sealbox-decrypt.mjs\n`);
console.log('Offline recovery pack: dist/recovery/');
