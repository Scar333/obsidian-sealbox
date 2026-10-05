# Sealbox — install, build and use

Sealbox needs the internet exactly once, to download its build dependencies.
After that every step on this page works with the network switched off, and the
plugin itself never makes a request at runtime.

---

## 1. Just use it (nothing to build)

The plugin is already built into the vault at
`My_test/.obsidian/plugins/sealbox/`. Three files are all that is required:

```
.obsidian/plugins/sealbox/
├── main.js        the whole plugin, self-contained
├── manifest.json
└── styles.css
```

1. Open Obsidian.
2. **Settings → Community plugins** → turn off Restricted mode if it is on.
3. **Sealbox** should be listed and enabled. If you do not see it, press the
   reload icon next to "Installed plugins", or run **Reload app without saving**
   from the command palette (`Ctrl/Cmd-P`).

To install into a different vault, copy those three files to
`<that vault>/.obsidian/plugins/sealbox/` and enable it the same way.

### On Android

There is no separate build. Let your sync carry the three files to the phone:

- **Syncthing** — the plugin folder is inside the vault, so it syncs on its own.
- **git** — `main.js` must not be gitignored. The provided `.gitignore` only
  excludes `.obsidian/workspace.json`, `.obsidian/cache` and Sealbox's temp
  files, so the plugin itself is committed and arrives on the phone.

Then on the phone: **Settings → Community plugins → enable Sealbox**.

---

## 2. First run — do these three things in order

1. **Create the master password.** The first time anything needs unlocking,
   Sealbox asks you to create one and tells you which KDF it will use. One
   password protects everything.

2. **Create a recovery key.** *Settings → Sealbox → Recovery key → Create.* It is
   shown once, you must type it back to confirm, and it is the only thing that can
   open your vault if you forget the password. Write it on paper, or encrypt it and
   store it somewhere that is **not this vault**. Do this before you put anything
   real into Sealbox.

3. **Run the diagnostics.** *Settings → Sealbox → Run self-tests on this device.*
   It performs the real round-trip, tamper-detection and truncation checks, times
   Argon2id and PBKDF2, measures throughput and starts the PDF worker. Run it on
   the desktop and then on the phone. The report contains no vault content, file
   names or key material, so it is safe to share. **Save to
   `sealbox-diagnostics.md`** writes it into the vault — this is the only file
   Sealbox ever writes that is not ciphertext.

If Argon2id fails on the phone, nothing breaks: Sealbox falls back to
PBKDF2-SHA512 and files sealed on either device still open on the other, because
the KDF used is recorded in each file and in the keyring.

---

## 3. Language

*Settings → Sealbox → Interface → Language*: **Follow Obsidian** (the default),
**English** or **Русский**. Follow Obsidian uses whatever Obsidian's own
interface language is set to, so if Obsidian is in Russian, Sealbox is too
without touching anything.

Switching takes effect immediately, including the command palette entries —
command names live in Obsidian's global command list, so the plugin removes and
re-registers them. On Obsidian older than 1.7.2 the palette keeps the previous
names until the next reload; everything else still switches at once. A sealed
file already open on screen relabels the next time it is redrawn.

## 4. Everyday use

### Encrypting

| What | How |
| --- | --- |
| One file | Right-click it in the file list → **Sealbox: encrypt**, or `Ctrl/Cmd-P` → *Sealbox: Encrypt the current file* |
| A whole folder | Right-click the folder → **Sealbox: encrypt this folder** |
| A new encrypted note | `Ctrl/Cmd-P` → *Sealbox: New encrypted note*, or right-click a folder |

`Report.pdf` becomes `Report.pdf.sealed`. The original is verified-then-removed:
Sealbox decrypts the new container and byte-compares it with the original before
deleting anything. If that check fails, both files stay and you get a loud error.

### Opening

Click a `.sealed` file. Locked, it shows a lock screen and its size — nothing
else, so you can look at it without the password and navigate away. Press
**Unlock** (or unlock once from the status bar) and the real content appears:
Markdown rendered, text shown, images displayed, PDFs paginated.

Markdown and text files are **editable in place**. Press *Edit*, type, and it
re-encrypts on save, on autosave, when you leave the field and when you switch
files. Plaintext is never written to a file, which is deliberate: a "decrypt while
I work on it" mode would put readable data straight into git and Syncthing.

### Locking

- Automatically after 15 minutes idle (configurable; 0 disables).
- Optionally when the Obsidian window loses focus.
- Click the status bar 🔓, or `Ctrl/Cmd-P` → *Sealbox: Lock now*.

Locking wipes decrypted content from every open view immediately.

### Secrets

The 🔑 icon in the left ribbon, or `Ctrl/Cmd-P` → *Sealbox: Open secrets*.
Three panes: groups, entries, details. Each entry has a title, username, password,
URL, note, group and tags. The password is hidden until you press *Show*;
**Generate** makes a 24-character one; **Copy** puts it in the clipboard and clears
it after 30 seconds.

On Android other apps can read the clipboard while it is there — the platform
gives no way to prevent that, and the UI says so.

**Copy note link** gives you `[[sealbox:<id>]]`. Paste it into any ordinary note
and it renders as a 🔑 chip that opens the secrets window on that entry — so a
normal note can point at a credential without containing it.

### Getting a file back out

`Ctrl/Cmd-P` → *Sealbox: Decrypt permanently*. It asks for confirmation first,
because this writes readable data back into a vault that git and Syncthing will
copy to your other devices and keep in history.

---

## 5. If you forget the password

`Ctrl/Cmd-P` → *Sealbox: Recover access with a recovery key*, or
*Settings → Sealbox → Forgot your password?*. Enter the recovery key and choose a
new master password. Your sealed files are not re-encrypted — only the keyring is
rewritten, so this takes a second regardless of vault size.

**Without a recovery key there is no way back.** That is not a policy, it is what
the encryption means.

### Reading a file without Obsidian

```sh
cd obsidian-sealbox

# A normal vault-keyed file (needs the keyring):
node tools/sealbox-decrypt.mjs path/to/Report.pdf.sealed \
  --keyring /path/to/vault/.obsidian/plugins/sealbox/keyring.json \
  --out Report.pdf

# A file that carries its own password, straight to stdout:
node tools/sealbox-decrypt.mjs note.md.sealed --out -
```

The password is read from stdin, or from `--password-file <file>`, so it never
reaches your shell history. The script depends on nothing but Node and implements
the format from the specification in `README.md` — it shares no code with the
plugin, and the test suite checks the two agree.

It cannot do Argon2id on its own, because Node has no built-in Argon2. For a
keyring on the Argon2id profile, run `npm i hash-wasm` in this folder first, or
keep a PBKDF2 keyring as your archive copy
(*Settings → Sealbox → Key derivation profile → PBKDF2-SHA512 only*, then change
your master password once so the keyring is rewritten).

**Keep a copy of `tools/sealbox-decrypt.mjs`, your `keyring.json` and your
recovery key together, outside this vault.** Those three things are a complete
escape hatch.

---

## 6. Building it yourself

### Requirements

- Node 20 or newer (`node -v`). Node 26 was used here.
- npm.

### One-time, online

```sh
cd obsidian-sealbox
npm install
```

This is the only step that touches the network. It fetches esbuild, TypeScript,
the Obsidian type definitions, `hash-wasm` (Argon2id as WebAssembly) and
`pdfjs-dist`. `.npmrc` sets `prefer-offline`, so later installs use the local
cache.

### Everything after that, offline

```sh
npm run check      # typecheck, then 71 tests, then build, then verify
npm run build      # production bundle into ../My_test/.obsidian/plugins/sealbox
npm run dev        # watch mode: rebuilds on save
npm test           # the test suite alone
npm run typecheck  # types alone
npm run verify     # the release gate (see below)
```

`npm run build` writes `main.js`, `manifest.json` and `styles.css` into the vault's
plugin folder. Set `SEALBOX_OUT` to build somewhere else:

```sh
SEALBOX_OUT=~/other-vault/.obsidian/plugins/sealbox npm run build
```

After a rebuild, reload the plugin in Obsidian: **Settings → Community plugins**,
toggle Sealbox off and on, or run **Reload app without saving**.

### The release gate

```sh
npm run verify
```

It inspects the built bundle, not the intentions, and fails if:

- the pdf.js worker lock-down prelude is missing or no longer replaces `fetch`,
  `XMLHttpRequest`, `WebSocket`, `EventSource` and `importScripts` with throwing
  stubs, or no longer silences `console`;
- any `console.*` call survived anywhere outside that worker;
- a Node builtin got bundled (which would break Android);
- any `http(s)` string in the bundle is not on the allowlist of known XML
  namespaces and licence notices. A new one means a dependency gained a URL and
  needs looking at by hand;
- `manifest.json` lost `isDesktopOnly: false`.

It also scans every source file for network primitives, direct `console` use and
Node imports. Expected output:

```
  ok   scanned 31 source files
  ok   bundle 1895 KiB, 21 URL strings, all known
  ok   worker region 1387 KiB, locked down
  ok   manifest sealbox v0.1.0, mobile enabled

verify: no network capability, no logging capability.
```

### Proving the offline claim yourself

On Linux, run the whole thing with no network interface at all:

```sh
unshare -rn sh -c '
  node -e "fetch(\"https://registry.npmjs.org\").catch(e => console.log(\"no network:\", e.cause?.code))"
  node esbuild.config.mjs production
  node --test tests/
  node tools/check-bundle.mjs
'
```

The probe prints `no network: EADDRNOTAVAIL`, and the build, all 71 tests and the
gate still pass.

### Moving the toolchain to an offline machine

```sh
tar czf sealbox-toolchain.tgz node_modules package.json package-lock.json
# copy it across, unpack in the project folder, then:
npm run check
```

Or `npm ci --offline` on a machine whose npm cache already has the packages.

---

## 7. git and Syncthing

The vault already has the right `.gitattributes`:

```gitattributes
*.sealed        binary -diff -merge
*.sealed.bak    binary -diff -merge
keyring.json    -merge
```

Without `-merge`, git will attempt a three-way merge on ciphertext and destroy the
file. Without `-diff` it prints megabytes of binary noise.

Syncthing cannot merge an encrypted file either, so it leaves a second copy named
`…sync-conflict-….sealed`.

- **Secrets database:** `Ctrl/Cmd-P` → *Sealbox: Merge sync conflicts in the
  secrets database*. Both copies are decrypted and reconciled entry by entry, the
  newer edit winning, nothing dropped. Only the copies that actually merged are
  removed. This also runs automatically when you open the secrets window.
- **Ordinary files:** you pick one. Both are intact and openable, so you can look
  before choosing.
- **Keyring:** Sealbox refuses to touch it and tells you. Resolve it by hand —
  picking the wrong one loses access to every sealed file.

**`keyring.json` must sync between devices.** Without it the phone cannot open
what the desktop sealed. Back it up somewhere outside the vault as well.

---

## 8. Troubleshooting

| Symptom | What it means |
| --- | --- |
| "Wrong master password" after changing it elsewhere | The new keyring has not synced yet. Sealbox re-reads the keyring on every lock, so once the file arrives, lock and unlock. |
| "the password is correct but the wrapped master key is damaged" | The keyring is corrupt, not your password. Restore `keyring.json` from a backup, or use the recovery key. |
| "this file is damaged or was modified (block N of M failed its integrity check)" | The ciphertext changed after it was written — a bad sync, a partial copy, or tampering. Restore that file from a backup; the message names the block so you know it is not a password problem. |
| PDF shows an error | Run the diagnostics; the "PDF worker" check says whether pdf.js starts on this device. |
| "above the … MiB mobile limit" | Do it on the desktop, or raise *Mobile size limit* in settings if the device can take it. |
| `.sealed` files open as plain text or not at all | Another plugin claimed the extension, or Sealbox failed to load. Check the Community plugins screen. |
| Unlock takes several seconds on the phone | Argon2id at the configured memory cost. Switch *Key derivation profile* to `Argon2id 32 MiB`, or to PBKDF2 if WebAssembly is slow there. |
| Everything relocks constantly | *Auto-lock after* is low, or *Lock when Obsidian loses focus* is on. |

---

## 9. What to back up

Three things, stored together and outside this vault:

1. `keyring.json` — from `.obsidian/plugins/sealbox/`.
2. Your **recovery key**, on paper or encrypted separately.
3. `tools/sealbox-decrypt.mjs` plus `README.md` (which holds the format spec).

With those three you can read your data on any machine with Node, forever,
whether or not this plugin still exists.
