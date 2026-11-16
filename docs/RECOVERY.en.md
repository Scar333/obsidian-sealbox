# Recover files without Obsidian

SealBox's `.sealed` format can be decrypted locally even if Obsidian or the plugin no longer starts. The recovery reader does not contact a server or change encrypted originals.

## Keep these backups

- Your `.sealed` files and any `.bak` copies.
- **The matching vault's `keyring.json`**, normally at `<vault>/.obsidian/plugins/sealbox/keyring.json`. Enable hidden files to see `.obsidian`; a custom Obsidian configuration folder changes this location.
- The master password **or a recovery key created beforehand**. Store the recovery key outside the vault. Keep the current keyring and recovery key after a password change.
- The offline recovery pack and a Node.js installer for your system.

**A recovery key does not replace the keyring.** It unlocks the master key wrapped inside that file. Ordinary vault-keyed files need a matching keyring plus the password or a configured recovery key. Own-password files instead require their individual password and do not need the vault keyring; the vault recovery key cannot open them.

Test one non-sensitive file now to verify your backups.

## Prepare the tool

Recommended runtime: **Node.js 24 LTS**. Check `node --version` in a terminal.

Starting with version 0.1.4, releases include a `sealbox-recovery.zip` archive. If the published release you have does not yet include it, build the pack from the updated source repository:

```sh
npm ci
npm run recovery:build
```

Copy the entire `dist/recovery/` directory to your backup. Dependency installation requires network access; building and using the completed pack work locally. The bundled `sealbox-decrypt.mjs` contains Argon2id WASM and XChaCha20-Poly1305, so no npm packages are required on the recovery computer. Node.js is still required.

`SHA256SUMS` detects changes to the stored script. It does not authenticate the original download by itself; obtain the pack from a trusted project copy.

## Decrypt using your password

Work on copies in a local directory outside any synced vault. Put the recovery script, a copy of your keyring and the encrypted file there. Open a terminal in that directory:

```sh
node sealbox-decrypt.mjs "note.md.sealed" --keyring "keyring.json" --out "restored-note.md"
```

Type the master password at `Password:` and press Enter. Input is hidden; do not put the password in the command itself. The same command works in Windows PowerShell. Quote paths containing spaces.

The output is written only after all blocks pass authentication. Use `--out "restored.pdf"` for a PDF, or an appropriate extension for other files. Existing files are never overwritten: choose a different output name if necessary.

## Forgotten master password

Use a matching keyring with recovery configured and your saved recovery key:

```sh
node sealbox-decrypt.mjs "note.md.sealed" --keyring "keyring.json" --recovery --out "restored-note.md"
```

Enter the key at `Recovery key:` with or without hyphens. Input is hidden. The tool checks its checksum and whether it opens this keyring. This decrypts the file; it does not reset the Obsidian password or modify keys.

## Own-password files

```sh
node sealbox-decrypt.mjs "private.pdf.sealed" --out "restored-private.pdf"
```

Enter that file's individual password. Its mode is read from the header. No vault keyring or recovery key is needed.

## Secrets database and older copies

```sh
node sealbox-decrypt.mjs "Secrets.sealed" --keyring "keyring.json" --out "restored-secrets.json"
```

The output is ordinary JSON containing entries, logins, passwords and fields. Open it in a local text editor. To recover a previous generation, use `Secrets.sealed.bak` as input and another output name; the reader recognizes the content regardless of the extension. This command does not import JSON back into the plugin.

**Recovered files are plaintext.** Keep them outside shared repositories and synced folders. Output files are created with mode `0600` on Linux/macOS; Windows uses directory permissions. The reader holds the container and result in memory, so large files require sufficient RAM.

## Troubleshooting

| Error | Next step |
|---|---|
| `wrong master password or damaged keyring verifier` | Check password, keyboard layout and keyring; try recovery or an intact backup. |
| `recovery key checksum mismatch` | Check for a transcription error. |
| `recovery key does not match this keyring` | Find the matching vault/version; the recovery key may have been replaced. |
| `this keyring has no recovery slot` | Find a keyring backup made after recovery was configured. |
| `integrity check`, `damaged`, `truncated` | Try an intact copy, `.bak` or sync history. The file may also belong to a different master key. Never edit ciphertext manually. |
| `helper is missing` | Use the bundled file from `dist/recovery/`, rather than copying the source script alone. |
| `output already exists` | Choose a different `--out` name. |

Run `node sealbox-decrypt.mjs --help` for options. Automation can use `--password-file` or `--recovery-key-file`, but these contain plaintext credentials; interactive hidden input is preferable for manual recovery.

Recovery is not an encryption bypass or a repair of arbitrarily damaged ciphertext. Without the necessary files and a valid credential, decryption is impossible.
