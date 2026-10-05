# Sealbox compared with the other Obsidian encryption plugins

Every claim below was read out of the other projects' own source or documentation,
with links. Where another plugin does something better, that is stated too — an
honest comparison is the only kind worth having when the subject is encryption.

## The field

| | Cipher | KDF | Salt | Attachments | Mobile | Recovery if password lost |
| --- | --- | --- | --- | --- | --- | --- |
| **Sealbox** | AES-256-GCM (chunked AEAD), optional XChaCha20-Poly1305 cascade | Argon2id 64/32 MiB `t=3`, or PBKDF2-SHA512 1 200 000 | random per file | yes, any type | first-class | **yes — recovery key** |
| [Meld Encrypt](https://github.com/meld-cp/obsidian-encrypt) | AES-256-GCM | PBKDF2-SHA512 210 000 (current); SHA-256 **1 000** in legacy format | random (current); **hardcoded** in legacy | notes only | yes | no |
| [Eccirian Encrypt](https://github.com/Enthalpiex/Eccirian-Encrypt) | AES-256-GCM + ECC-P-256 | PBKDF2 / Argon2id | random | yes | "not yet fully developed" | no |
| [Age Encrypt](https://github.com/mr-vdt/obsidian-age-encrypt) | ChaCha20-Poly1305 (age format) | scrypt (age passphrase mode) | random | notes only | unstated | no |
| [Cryptsidian](https://github.com/triumphantomato/cryptsidian) | AES-256-**CTR**, unauthenticated | scrypt, default parameters | **static, hardcoded** | whole vault, in place | desktop only | no |
| [Password Manager](https://github.com/PandaNocturne/obsidian-password-manager) | AES-GCM-256 | PBKDF2-SHA256 250 000 | random | n/a (credentials) | unstated | no |

## Where Sealbox is genuinely better, and why it matters

### 1. The password is not the key

Every other plugin here derives the file key straight from your password. Three
consequences follow, and all three are avoidable:

- **Every open pays for the KDF.** At Meld's 210 000 PBKDF2-SHA512 iterations that
  is roughly a second per decryption, which is why such plugins need a session
  password cache to stay usable.
- **Changing your password means re-encrypting everything**, because the old key
  cannot open files written under the new one.
- **Recovery is impossible even in principle.** There is nothing to hand a second
  key to.

Sealbox puts a random 32-byte master key in between. The password unwraps the
master key once per unlock; per-file keys come from HKDF with a random per-file
salt, which costs microseconds. Opening a note is instant, changing the master
password rewrites a 1 KB keyring and leaves every sealed file untouched, and a
recovery key is simply a second, independent wrapping of the same master key.

### 2. A forgotten password is survivable

Meld: *"Your passwords are never stored. If you forget your password, your notes
cannot be decrypted."* Eccirian: *"losing the password means losing the file."*
Age Encrypt: *"if you lose your passphrase, you lose your data FOREVER."*

That is the honest consequence of their design, not carelessness. Sealbox can
offer a recovery key — 32 random bytes in Crockford base32 with a checksum,
wrapping the same master key — precisely because of the indirection above. It is
the single most valuable practical difference for a real user.

### 3. Chunked AEAD instead of one big call

Others encrypt a file as one AES-GCM operation. For notes that is fine. For a
100 MB PDF on a phone it means handing the whole buffer to WebCrypto at once,
which is the quickest way to have an Android WebView killed mid-write.

Sealbox splits the payload into 1 MiB blocks, each its own AEAD operation, so peak
memory is bounded and the UI can breathe between blocks. More importantly each
block's AAD carries **the whole header, the block index and an end-of-file flag**.
That makes three attacks detectable that a single-shot design cannot even see:

- **Truncation** — cutting the file short. The new last block was sealed with
  `is_last = 0`, so reading it as final fails.
- **Reordering and duplication** of blocks — the index is authenticated.
- **Parameter substitution** — rewriting the header's KDF cost, chunk size or
  salt. Because the full header is in every block's AAD, editing any byte of it,
  reserved bytes included, makes decryption fail rather than change how the file
  is interpreted.

Sealbox also refuses an Argon2id memory cost above 1 GiB from a file header, so a
crafted container cannot turn opening a file into an out-of-memory crash.

### 4. Authenticated encryption, and a fresh salt, are not optional

Cryptsidian uses **AES-256-CTR with no MAC** — its own README notes that GCM
"would be a reasonable improvement". Without authentication, an attacker who can
write to your vault can flip any bit of any decrypted file undetectably: in a
CTR-mode ciphertext, flipping a ciphertext bit flips exactly that plaintext bit.
Changing "transfer 100" to "transfer 900" in a synced note is a realistic attack
on an unauthenticated file, and nothing in the tool will notice.

It also uses a **static salt hardcoded in the source**. That means the same
password produces the same key for every Cryptsidian user in the world — one
precomputed table attacks everybody. Meld's legacy format had the same property
(`'XHWnDAT6ehMVY2zD'`, 1 000 iterations); its current format fixed it properly,
and old files are still readable through a versioned helper, which is the right
way to handle a format migration.

Sealbox is AEAD-only by construction: there is no code path that produces
unauthenticated output, and the salt is 16 fresh random bytes per file.

### 5. Metadata is inside the ciphertext

A sealed file's original name, media type and size live in an encrypted,
authenticated block 0, not in the filename. `Divorce settlement.pdf.sealed` is
how it looks only because sealing keeps the on-disk name; rename it to `a.sealed`
and the real name still comes back on decryption. File names, sizes and folder
structure are the metadata that remains visible — stated plainly rather than
glossed over.

### 6. Nothing is deleted before the replacement is proven good

Sealbox writes the container, reads it back, decrypts it, byte-compares it against
the original, and only then removes the original. If verification fails, both
files stay and the error says so loudly. Cryptsidian, which rewrites files in
place, tells you to *"back up your vault"* first — which is a reasonable warning,
but a plugin can simply not need it.

### 7. Mobile treated as a target, not a hope

Eccirian states its mobile version "is not yet fully developed"; Cryptsidian is
desktop-only because it uses Node's `crypto`. Sealbox:

- uses **no Node APIs at all** — enforced by a test that scans every source file,
  because `fs`/`node:crypto` are the usual reason a plugin is desktop-only;
- records the KDF and its cost **in every file and in the keyring**, so a device
  where Argon2id's WebAssembly cannot run falls back to PBKDF2-SHA512 and still
  opens files sealed by the desktop;
- sizes Argon2id down on mobile (32 MiB), because a 64 MiB allocation is a
  realistic way to get a WebView killed during unlock;
- refuses oversized files with an explanation instead of crashing;
- renders PDFs to canvas, because `<iframe src="blob:…pdf">` displays nothing in
  an Android WebView;
- ships an **on-device diagnostics screen** that runs the real round-trip, tamper
  and truncation checks plus KDF timings, so the phone can be debugged without a
  USB cable.

### 8. Sync is designed for, not discovered

With git and Syncthing in the picture:

- Every write is tmp → rename → cleanup, with recovery at load, so a crash or a
  sync snapshot never captures a truncated container.
- A plaintext original is never left in the vault's `.trash`. `Vault.trash(file,
  true)` only *tries* the system trash and silently falls back to the in-vault
  folder, which would keep syncing the readable copy — on mobile that fallback is
  guaranteed. Sealbox deletes outright there and sweeps the fallback on desktop.
- A sync conflict on the secrets database is **merged entry by entry** after
  decryption, newest edit winning, nothing dropped — and only the copies that
  actually merged are deleted. No other plugin here reconciles conflicts; the
  alternative is picking one file and silently losing whatever was only in the
  other.
- A keyring with a conflict beside it is never overwritten automatically.

### 9. No network, no logging — enforced, not promised

`npm run verify` fails the build unless: the inlined pdf.js worker still has
`fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource` and `importScripts` replaced
with throwing stubs and its `console` replaced with no-ops; zero `console.*` calls
survive anywhere outside that worker; no Node builtins are bundled; and every
`http(s)` string in the 1.9 MB bundle is on an allowlist of XML namespaces and
licence notices rather than an endpoint. Tests additionally assert that no source
file mentions `fetch`, `XMLHttpRequest`, Obsidian's `requestUrl`, or `console`
outside the one logging module, and that pdf.js is never given `url`, `cMapUrl` or
`standardFontDataUrl` — the three ways a document's own contents could cause an
outbound request.

The whole build and test suite were run inside a network namespace with no
interfaces, confirming the plugin needs the internet exactly once: `npm install`.

### 10. The format is written down, and something else implements it

`README.md` specifies the container byte for byte, and
`tools/sealbox-decrypt.mjs` implements that specification independently, sharing
no code with `src/`. The test suite checks the two agree on the same files. So the
spec is verified rather than aspirational, and there is a way to read your data
with nothing but Node if this plugin ever stops building.

## Where the others are better

**Age Encrypt wins on format.** It uses [age](https://age-encryption.org), a
standardised format with an independent, widely reviewed Go implementation and a
real CLI. Your data is readable by a tool thousands of people use and audit.
Sealbox's format is bespoke; a written spec and a second implementation are a
genuine mitigation but not a substitute for an ecosystem. If what you want above
all is "my ciphertext is a standard other people's tools can read", use Age
Encrypt.

**Meld Encrypt wins on maturity.** Years in the community plugin list, many users,
a long tail of fixed bugs, and a careful versioned format migration. Its current
parameters (AES-256-GCM, PBKDF2-SHA512, 210 000 iterations, random salt) are
exactly OWASP's recommendation — there is nothing wrong with its crypto. Sealbox
is days old with one user.

**Meld also keeps notes as `.md`.** Content is unreadable but the file is still a
note, so Obsidian's own machinery treats it normally. Sealbox's `.sealed` files
are invisible to search, Dataview, the graph and backlinks. That is the direct
cost of a container format, and for some workflows it is the wrong trade.

**Eccirian wins on attachment ergonomics** — one-click encryption of every
attachment linked from a note. Sealbox needs a per-file or per-folder action and
does not rewrite links to sealed files.

**Everyone wins on size.** Sealbox's bundle is 1.9 MB because it carries its own
pdf.js, chosen so PDF rendering does not depend on Obsidian internals that change
between releases. Most of these plugins are tens of kilobytes.

## What to be sceptical about in Sealbox

- **It has had no independent security review**, and it is new. The crypto
  construction is conventional and the tests are thorough, but neither of those is
  an audit.
- **The format is custom.** Mitigated by the written spec and the standalone
  decryptor, not eliminated.
- **The secrets database is a single concentrated file.** One `.sealed` container
  holds every credential. There is a `.bak` generation and conflict merging, but
  concentration is inherent.
- **Nothing here defends against malware on your device.** A keylogger takes the
  password as you type it. That is true of every plugin in this table and of every
  password manager; it is simply not a problem application code can solve.

Start with throwaway data, create a recovery key before anything real goes in, and
keep backups outside the vault.
