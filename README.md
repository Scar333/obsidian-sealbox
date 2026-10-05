# Sealbox

Encrypt notes and attachments in your vault with one password, and keep logins in
a secrets manager that lives in the same kind of encrypted file. Works on desktop
and on Android.

Sealed files never exist in readable form on disk. You edit an encrypted note
inside its own view and it is re-encrypted when you save, so there is no moment
where git or Syncthing can pick up the plaintext. That one constraint drove most
of the design decisions below.

> Early release. The construction is conventional and well covered by tests, but
> it has not been through an independent audit. Start with data you can afford to
> lose, and create a recovery key before you put anything real in.

## What you get

- `.sealed` files open to a lock screen. Without the password you see the file
  size and nothing else, and you can walk away to another note.
- One password unlocks the vault for a session. It is stretched once, not once per
  file, so opening a note is instant.
- Any file type. Markdown and text are editable in place, images and PDFs render,
  anything else decrypts to memory.
- A secrets manager with groups, tags, several links per entry, custom fields, and
  templates for websites, bank cards and servers.
- A recovery key, so a forgotten password is survivable.
- English and Russian, following Obsidian's own language by default.

## Threat model

It protects a vault **at rest**: a stolen laptop or phone, a leaked git
repository, someone's copy of your Syncthing folder, a cloud backup.

It does not protect you from malware already running on the machine. A keylogger
takes the password as you type it, and anything that can read Obsidian's memory
can read a decrypted note while it is on screen. That is the operating system's
job, and a plugin claiming otherwise is not telling you the truth. Other Obsidian
plugins run in the same process and can do the same.

File names, sizes, timestamps and folder structure stay visible; only contents are
encrypted. The original name and media type of a sealed file live inside the
ciphertext, so renaming `report.pdf.sealed` to `a.sealed` loses nothing.

## Install

Requires Obsidian 1.8.7 or newer, on desktop or Android.

Until it reaches the community catalogue: download `main.js`, `manifest.json` and
`styles.css` from the latest release into `<vault>/.obsidian/plugins/sealbox/`,
then enable Sealbox under Community plugins.

Three things to do first, in order:

1. Create a master password. Four or five random words, not something you invented
   — see [Picking a password](#picking-a-password).
2. **Settings → Sealbox → Recovery key → Create.** Write it down somewhere that is
   not this vault. Without it a forgotten password means the files are gone.
3. **Settings → Sealbox → Run self-tests.** Nine checks against this device,
   including Argon2id timing and whether the PDF renderer starts. On a phone that
   is the only practical way to find out. The report contains no vault content, so
   it is safe to share.

## How it works

AES-256-GCM through WebCrypto, Argon2id for the password. Both are available
natively in Electron and in the Android WebView, which is what lets one codebase
cover both.

Argon2id is not part of WebCrypto, so it arrives as WebAssembly, and an Android
WebView is a realistic place for that to fail or to be killed for allocating
64 MiB. PBKDF2-SHA512 is therefore a first-class fallback rather than an
afterthought: the function and its cost are recorded in the keyring and in every
container, so a file sealed on a desktop still opens on a device that can only do
one of the two. Profiles are 64 MiB on desktop, 32 MiB on mobile, `t=3, p=1`, and
PBKDF2 at 1 200 000 iterations.

### The password is not the key

A random 32-byte master key sits between your password and your files. The
password unwraps it once per unlock; per-file keys come from HKDF with a random
per-file salt, which costs microseconds.

Three things follow, and together they are the reason for the indirection:

- Opening a note is instant instead of costing a full KDF run.
- Changing the master password rewrites a 1 KB keyring. Your files are untouched,
  so it takes a second regardless of vault size.
- A recovery key becomes possible at all. It is a second, independent wrapping of
  the same master key.

After unlock the master key is a non-extractable `CryptoKey`. Its raw bytes are
gone from the heap; code can ask WebCrypto to use it but cannot read it back.

### Chunked, authenticated containers

Payloads are split into 1 MiB blocks, each its own AEAD operation. That bounds
peak memory, which matters because handing a 200 MB buffer to a single
`crypto.subtle.encrypt` call is a good way to get a WebView killed.

More importantly, each block's additional authenticated data carries the whole
header, the block index and an end-of-file flag. Three attacks become detectable
that a single-shot design cannot see at all:

- Truncating the file. The new last block was sealed with `is_last = 0`, so
  reading it as the final block fails.
- Reordering or duplicating blocks, because the index is authenticated.
- Editing the header to swap the KDF cost, the chunk size or the salt.

A header asking for more than 1 GiB of Argon2 memory is refused outright. Obeying
it would be an out-of-memory crash, not a decryption.

### Container format, version 1

Little-endian throughout.

```
off  len  field
 0    6   magic "SEALED"
 6    1   format version (1)
 7    1   flags: bit0 cascade, bit1 own-password
 8    1   kdf id: 0 none (vault-keyed), 1 argon2id, 2 pbkdf2-sha512
 9    1   argon2 time cost, else 0
10    1   argon2 lanes, else 0
11    1   reserved, must be 0
12    4   argon2 memory in KiB, or pbkdf2 iteration count, or 0
16    4   chunk size in KiB
20   16   salt
36    4   nonce prefix
40    4   metadata ciphertext length
44    4   reserved, must be 0
48    N   metadata ciphertext (block 0)
...       chunk[1..M] ciphertext
```

Nonce for block *n* is `nonce_prefix(4) || u64le(n)`. AAD for block *n* is
`header[0..48) || u64le(n) || is_last(1)`. Block 0 holds metadata as JSON:
`{v, name, mime, size, mtime, ctime}`. A writer always emits at least one block,
so an empty payload is still authenticated. Tag overhead is 16 bytes per block, 32
with the optional cascade.

Key derivation:

```
vault-keyed file (flag bit1 = 0):
  ikm = HKDF-SHA256(master_key, salt = header.salt, info = "sealbox-file-v1", 32)

own-password file (flag bit1 = 1):
  ikm = Argon2id|PBKDF2-SHA512(password, header.salt, header parameters) -> 32

then, for both:
  aes_key       = HKDF-SHA256(ikm, "", "sealbox-aes-v1",     32)
  cascade_key   = HKDF-SHA256(ikm, "", "sealbox-xchacha-v1", 32)
  cascade_nonce = HKDF-SHA256(ikm, "", "sealbox-xnonce-v1",  16) || u64le(n)
```

Paranoid mode adds XChaCha20-Poly1305 over AES-256-GCM. It is off by default and
honestly buys close to nothing, since attacks go after passwords rather than AES.
It exists because the format had room for it.

### The keyring

`.obsidian/plugins/sealbox/keyring.json` holds the master key, wrapped:

```json
{
  "sealbox": 1,
  "kdf": { "id": 1, "m": 65536, "t": 3, "p": 1, "salt": "base64" },
  "mk":       { "n": "nonce", "c": "ciphertext" },
  "verifier": { "n": "nonce", "c": "ciphertext" },
  "recovery": { "salt": "base64", "mk": { "n": "...", "c": "..." }, "created": "iso" }
}
```

The verifier is a known constant sealed under the same key. It separates "wrong
password" from "damaged keyring"; without it a corrupt file looks exactly like a
typo and you retype forever. Each slot uses its own AAD label, so a box cannot be
moved from one slot into another.

**The keyring has to be synced between your devices.** A phone cannot open what a
desktop sealed without it, and it exists nowhere else. Back it up alongside the
recovery key.

It cannot decrypt anything on its own. What it gives an attacker who steals it is
the ability to guess your password offline with no rate limit, which brings us to:

### Picking a password

Rough cost of an offline attack against Argon2id at 64 MiB, assuming eight
high-end GPUs:

| Password | Entropy | Time to find |
| --- | --- | --- |
| Something you invented, like `Sealbox2026!` | ~30 bits | hours |
| 3 random words | 39 bits | months |
| **4 random words** | 52 bits | **thousands of years** |
| 5 random words | 65 bits | longer than you need |

Orders of magnitude, not promises. The shape is the point: four random words moves
the problem out of reach, a clever-looking password you thought up does not. This
is also the one place where better guessing models genuinely help an attacker,
because guessing human-chosen passwords is exactly what they are good at. Random
words give them nothing to guess.

### Recovery keys can be revoked

Changing the master password invalidates the existing recovery key and issues a
new one in the same step. A recovery key is a second way into the same master key,
so leaving it alone would make a password change useless against the thing people
change their password for: somebody else having gained a way in.

The exception is recovering *with* a key. If you use it to set a new password it
keeps working, because taking it away at the moment it was needed would strand you
if the brand-new password is forgotten too.

This is the opposite trade from a wallet seed phrase, and the better one here. A
seed phrase *is* the root key and cannot be rotated; if it leaks you move
everything to a new wallet. Here the root key is separate, so a leaked recovery
key is simply revoked.

## Confidentiality

Two capabilities the plugin does not have, enforced by `npm run verify` rather
than by good intentions.

**No network.** Nothing in `src/` contains `fetch`, `XMLHttpRequest`, `WebSocket`
or Obsidian's `requestUrl`, and a test fails if that changes. The bundled pdf.js
worker runs with those APIs replaced by stubs that throw. pdf.js is only ever
handed a buffer, never `url`, `cMapUrl` or `standardFontDataUrl`, which are the
three ways a document's own contents could trigger a request. Every `http` string
in the 2 MB bundle is checked against an allowlist of XML namespaces and licence
notices.

**No logs.** Release builds are compiled with `drop: ["console"]`; the logger is
silent unless `NODE_ENV=development`; and the inlined pdf.js worker has its
`console` replaced with no-ops, because a string the bundler never parses is out
of reach of `drop`. On top of that a log message can only be a string literal, and
a test enforces it, so no file name or note title can be interpolated into one.
Anything path-shaped is redacted before printing.

The only file the plugin writes that is not ciphertext is the diagnostics report,
and only when you press the button.

Two things a scanner will notice, and what they are:

**Clipboard.** A secrets manager has to copy passwords, so the plugin reads and
writes the system clipboard. Nothing is copied unless you press a copy button,
and the clipboard is wiped after a delay you set in the settings — the only
exception is Android, where other apps can read the clipboard while the password
is in it. That warning is in the setting's own description, not just here.

**Dynamic code execution.** `eval` and `new Function` appear nowhere in `src/`.
They come from the bundled pdf.js worker. pdf.js is started with
`isEvalSupported: false`, so it compiles no font programs at runtime, and the
worker's global scope has its network APIs and `console` replaced before a single
line of it runs. The trade is a little font fidelity for not executing anything
that arrived inside a document.

## Reproducible builds

`main.js` contains nothing that varies between builds — no timestamp, no build
host, no random identifier. The same commit always produces the same bytes, so
you can check that a published release really was built from this source:

```sh
git checkout 0.1.1
npm ci && npm run build
sha256sum main.js
```

That hash is printed in the Release workflow's log, and `npm run verify` fails if
anything varying is ever added to the bundle. Releases also carry GitHub build
provenance attestations:

```sh
gh attestation verify main.js --repo Scar333/obsidian-sealbox
```

## git and Syncthing

Put this in your vault's `.gitattributes`:

```gitattributes
*.sealed        binary -diff -merge
*.sealed.bak    binary -diff -merge
keyring.json    -merge
```

Without `-merge`, git will attempt a three-way merge on ciphertext and destroy the
file.

Syncthing cannot merge an encrypted file either, so it leaves a second copy named
`…sync-conflict-….sealed`. For the secrets database that is recoverable: **Sealbox:
Merge sync conflicts** decrypts both, reconciles them entry by entry with the
newer edit winning, and deletes only the copies that actually merged. For ordinary
files you pick one, and both are intact so you can look first. For the keyring the
plugin refuses to act and tells you, because picking the wrong one loses access to
everything.

## Building

```sh
npm install        # the only step that ever needs the network
npm run check      # types, 93 tests, build, release gate
npm run build      # build only, into ./main.js
npm run dev        # rebuild on save
```

To install straight into a vault while developing:

```sh
SEALBOX_OUT=~/vault/.obsidian/plugins/sealbox npm run build
```

Everything after `npm install` works offline. On Linux you can prove it:

```sh
unshare -rn sh -c 'node --test tests/ && node esbuild.config.mjs production && node tools/check-bundle.mjs'
```

Four conventions that are load-bearing rather than taste:

- No Node APIs. `fs`, `path` and `node:crypto` do not exist in the Android
  WebView, and reaching for them is the usual reason a plugin ends up
  desktop-only.
- Plaintext never reaches a file. A feature that needs decrypted bytes keeps them
  in memory and wipes them when the vault locks.
- Verify before deleting. Anything that removes a user's file first proves the
  replacement decrypts to the same bytes.
- Every async UI handler goes through `runAction`, so a failure can never be
  invisible.

## Reading your data without the plugin

`tools/sealbox-decrypt.mjs` decrypts a container using nothing but Node. It
implements the format from the specification above, shares no code with `src/`,
and the test suite checks that the two agree — so it is both a backup plan and
evidence that this document is accurate.

```sh
node tools/sealbox-decrypt.mjs file.sealed --keyring keyring.json --out file.pdf
```

Keep a copy of that script, your `keyring.json` and your recovery key together,
outside the vault. With those three you can read your data on any machine with
Node, whether or not this plugin still exists.

## Licence

MIT, see [LICENSE](LICENSE).

Sealbox shares no code with other encryption plugins. Meld Encrypt, Age Encrypt
and the Password Manager plugin were all read while designing it;
[COMPARISON.md](COMPARISON.md) covers how they differ, including where they are
better.
