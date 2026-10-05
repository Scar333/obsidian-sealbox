/**
 * English dictionary — the source of truth.
 *
 * `MessageKey` is derived from this object, so every other language must supply
 * exactly these keys. Entries with `{one, few?, many}` are plural forms selected
 * by a `count` parameter.
 *
 * Not everything in the codebase is here. Messages that can only mean "this
 * plugin has a bug" — a wrong internal buffer size, an out-of-range integer —
 * stay as plain English `Error`s: they are developer diagnostics, and a
 * translated one is harder to search for, not easier to act on.
 */

export const en = {
  // --- shared labels ------------------------------------------------------
  "common.cancel": "Cancel",
  "common.continue": "Continue",
  "common.unlock": "Unlock",
  "common.lock": "Lock",
  "common.save": "Save",
  "common.delete": "Delete",
  "common.show": "Show",
  "common.hide": "Hide",
  "common.copy": "Copy",
  "common.generate": "Generate",
  "common.create": "Create",
  "common.change": "Change",
  "common.run": "Run",
  "common.tryAgain": "Try again",
  "common.new": "New",
  "common.edit": "Edit",
  "common.preview": "Preview",
  "common.untitled": "(untitled)",

  // --- password prompt ----------------------------------------------------
  "password.field": "Password",
  "password.repeat": "Repeat password",
  "password.enter": "Enter a password.",
  "password.mismatch": "The two passwords do not match.",
  "password.strength": "Strength: {label} (~{bits} bits)",

  "strength.empty": "empty",
  "strength.weak": "weak — do not use this for real data",
  "strength.fair": "fair — a long passphrase would be better",
  "strength.good": "good",
  "strength.strong": "strong",

  // --- setup, unlock, password changes ------------------------------------
  "setup.title": "Create your Sealbox master password",
  "setup.description":
    "One password protects everything. It is stretched with {kdf} and never stored anywhere — if you forget it, only a recovery key can get your files back.",
  "setup.submit": "Create",
  "setup.done": "Sealbox is set up and unlocked.",

  "unlock.title": "Unlock Sealbox",
  "unlock.kdf": "Key derivation: {kdf}.",
  "unlock.throttled": {
    one: "{count} failed attempt — the next try is delayed by {seconds}s.",
    many: "{count} failed attempts — the next try is delayed by {seconds}s.",
  },
  "unlock.wrongPassword": "Wrong master password.",
  "vault.locked": "the vault is locked",

  "keyring.conflict": {
    one: "There is a sync conflict on your keyring ({count} extra copy). Resolve it by hand before changing Sealbox's keyring — picking the wrong one loses access to every sealed file.",
    many: "There is a sync conflict on your keyring ({count} extra copies). Resolve it by hand before changing Sealbox's keyring — picking the wrong one loses access to every sealed file.",
  },

  "password.current.title": "Current master password",
  "password.new.title": "New master password",
  "password.new.description":
    "Only the keyring is rewritten — your sealed files are not touched, so this takes a moment rather than an hour.",
  "password.new.submit": "Change password",
  "password.changed": "Master password changed.",
  "password.new.revokesRecovery":
    "Your current recovery key will stop working. A new one is created and shown right after, so write that one down instead.",
  "recovery.rotated":
    "The old recovery key no longer opens this vault. Here is the new one — write it down now.",
  "password.changeFailed": "Could not change the password: {error}",

  // --- recovery -----------------------------------------------------------
  "recovery.confirmPassword.title": "Confirm your master password",
  "recovery.confirmPassword.description":
    "Needed to wrap the master key under a new recovery key.",
  "recovery.createFailed": "Could not create a recovery key: {error}",
  "recovery.unlocked": "Unlocked with your recovery key. Set a new password now.",
  "recovery.passwordReset": "Master password reset. Your sealed files are unchanged.",
  "recovery.newPassword.submit": "Set password",

  "recovery.show.title": "Write down your recovery key",
  "recovery.show.body":
    "This is the only thing that can open your vault if you forget your master password. It is shown once and is not stored anywhere by Sealbox.",
  "recovery.show.warning":
    "Anyone holding this key has full access to every sealed file. Treat it like the password itself: on paper in a safe place, or encrypted somewhere separate from this vault.",
  "recovery.show.copied": "Copied. Paste it somewhere safe, then clear your clipboard.",
  "recovery.show.copyFailed": "The clipboard is unavailable here — copy it by hand.",
  "recovery.show.confirmPrompt": "Now type it back in to confirm you really have it:",
  "recovery.show.matches": "✓ matches",
  "recovery.show.noMatch": "does not match yet",
  "recovery.show.done": "I have written it down",
  "recovery.show.notConfirmed":
    "The recovery key is saved in your keyring, but you did not confirm you wrote it down. Create a new one from Sealbox settings if you lost it.",

  "recovery.enter.resetTitle": "Reset your master password",
  "recovery.enter.unlockTitle": "Unlock with a recovery key",
  "recovery.enter.resetBody":
    "Enter your recovery key, then choose a new master password. Your sealed files are not re-encrypted.",
  "recovery.enter.unlockBody": "Enter your recovery key to unlock this session.",
  "recovery.enter.resetAction": "Reset password",
  "recovery.placeholder": "XXXXX-XXXXX-XXXXX-…",

  // --- the sealed-file view -----------------------------------------------
  "view.copyLink": "Copy link",
  "view.sealedFile": "Sealed file",
  "view.lockedSubtitle":
    "Sealed file · {size} on disk. Its real name and type are inside the encryption.",
  "view.noPassword":
    "No password? Nothing here is readable without it — open another note and carry on. If you have lost it, use “{command}” from the command palette.",
  "view.meta": "{mime} · {size}",
  "view.status.unsaved": "unsaved changes",
  "view.status.saving": "saving…",
  "view.status.saved": "saved",
  "view.status.savedAt": "saved at {time}",
  "view.savedNotice": "Saved.",
  "view.status.notSaved": "NOT saved",
  "view.saveFailed": "Sealbox could not save: {error}",
  "view.notUtf8": "(this file is not valid UTF-8 text)",
  "view.noViewer":
    "There is no built-in viewer for {mime}. The file is intact — use “{command}” if you need it outside Obsidian.",
  "view.renderingPdf": "Rendering PDF…",
  "view.pdfFailed": "This PDF could not be displayed: {error}",
  "view.pdfDiagnosticsHint":
    "Run “{command}” to check whether PDF rendering works on this device.",

  "viewer.image.unsupported": "The decrypted data is not an image this platform can display.",
  "viewer.pdf.pageLimit": "This PDF has {total} pages; showing the first {shown}.",
  "viewer.pdf.pages": { one: "{count} page", many: "{count} pages" },
  "viewer.pdf.pagesZoom": "{pages} · {percent}%",
  "viewer.pdf.pagePlaceholder": "Page {page}",
  "viewer.pdf.pageFailed": "Page {page} could not be rendered.",

  // --- sealing and unsealing files ----------------------------------------
  "ops.alreadySealed": "{name} is already sealed.",
  "ops.sealing": "Sealing {name} — {done} of {total}",
  "ops.verifying": "Verifying {name}…",
  "ops.verifyFailed":
    "verification of {path} failed — the original was NOT removed. Please report this.",
  "ops.keptOriginal":
    "{name} was sealed but the plaintext original was kept — it is still readable, and still syncs.",
  "ops.mobileTrashNote":
    "On mobile the original is deleted outright rather than trashed: the local trash folder is inside the vault and would keep syncing the readable copy.",
  "ops.sweptLocalTrash":
    "The system trash was unavailable, so Sealbox removed the plaintext copy of {name} from the vault's local trash instead of letting it sync.",
  "ops.mobileSizeLimit":
    "{name} is {size}, above the {limit} MiB mobile limit. Do this on a desktop, or raise the limit in Sealbox settings if your device can take it.",
  "ops.folderEmpty": "Nothing to seal in that folder.",
  "ops.folderStart": {
    one: "Sealing {count} file…",
    many: "Sealing {count} files…",
  },
  "ops.folderProgress": "Sealing {index}/{total}: {name}",
  "ops.folderDone": { one: "Sealed {count} file.", many: "Sealed {count} files." },
  "ops.folderDoneWithFailures":
    "Sealed {done} files, skipped {failed}. Nothing was deleted for the skipped ones.",
  "ops.skipped": "Skipped {name}: {error}",

  // --- commands, menus, notices -------------------------------------------
  "command.unlock": "Unlock",
  "command.lock": "Lock now",
  "command.sealActive": "Encrypt the current file",
  "command.decryptPermanently": "Decrypt permanently (writes plaintext back into the vault)",
  "command.newSealedNote": "New encrypted note",
  "command.openSecrets": "Open secrets",
  "command.quickAdd": "New secret entry",
  "command.mergeConflicts": "Merge sync conflicts in the secrets database",
  "command.recoverAccess": "Recover access with a recovery key",
  "command.copyFileLink": "Copy a link to the current sealed file",
  "command.diagnostics": "Diagnostics",

  "menu.seal": "Sealbox: encrypt",
  "menu.sealFolder": "Sealbox: encrypt this folder",
  "menu.newNoteHere": "Sealbox: new encrypted note here",
  "menu.copyLink": "Sealbox: copy link to this file",
  "menu.decrypt": "Sealbox: decrypt permanently",
  "ribbon.secrets": "Sealbox secrets",
  "ribbon.quickAdd": "New Sealbox entry",
  "ribbon.encrypt.ready": "Encrypt {name}",
  "ribbon.encrypt.alreadySealed": "{name} is already encrypted",
  "ribbon.decrypt.ready": "Remove encryption from {name} — writes a readable copy",
  "ribbon.encrypt.noFile": "Open a file to encrypt it",
  "notice.openFileFirst": "Open the file you want to encrypt first.",
  "statusbar.unlocked": "Sealbox is unlocked — click to lock",
  "statusbar.locked": "Sealbox is locked — click to unlock",

  "notice.locked": "Sealbox locked.",
  "notice.extensionTaken":
    "Sealbox could not claim the .{ext} extension — another plugin may already handle it.",
  "notice.restored": {
    one: "Sealbox restored {count} file after an interrupted write.",
    many: "Sealbox restored {count} files after an interrupted write.",
  },
  "notice.fileLinkCopied": "Link copied: {link}",
  "notice.sealedAs": "Sealed as {path}",
  "notice.undo": "Undo",
  "notice.undone": "Encryption removed — {name} is readable again.",
  "notice.undoUnavailable":
    "Sealbox cannot find that file any more. Use “{command}” on it instead.",
  "notice.sealFailed": "Could not seal {name}: {error}",
  "notice.decryptedTo": "Decrypted to {path} — this file is now readable by anything.",
  "notice.decryptFailed": "Could not decrypt {name}: {error}",
  "notice.createNoteFailed": "Could not create an encrypted note: {error}",
  "notice.createdNote": "Created {path}. Open it from the file list.",
  "notice.noConflicts": "No sync conflicts found.",

  "confirm.decrypt.title": "Decrypt {name}?",
  "confirm.decrypt.body":
    "This writes the readable file back into the vault.\n\ngit and Syncthing will then pick it up, copy it to your other devices and keep it in history — where deleting it later does not remove it.",
  "confirm.decrypt.warning": "Only do this if you actually need the file outside Obsidian.",
  "confirm.decrypt.action": "Decrypt permanently",
  "chip.secret": "🔑 secret",

  // --- secrets manager ----------------------------------------------------
  "secrets.searchPlaceholder": "Search title, user, URL, note, tags…",
  "secrets.groups": "Groups",
  "secrets.all": "All",
  "secrets.allEntries": "All entries",
  "secrets.ungrouped": "Ungrouped",
  "secrets.empty": "No entries yet. Press New.",
  "secrets.noMatch": "Nothing matches.",
  "secrets.selectEntry": "Select an entry, or press New.",
  "secrets.backGroups": "‹ Groups",
  "secrets.backEntries": "‹ Entries",
  "quickAdd.title": "New entry · {template}",
  "quickAdd.saved": "“{title}” was added to your secrets.",
  "secrets.template.choose": "What kind of entry is this?",
  "secrets.template.site": "Website",
  "secrets.template.siteDesc": "Login page, username and password.",
  "secrets.template.card": "Bank card",
  "secrets.template.cardDesc": "Number, expiry, CVC and cardholder.",
  "secrets.template.server": "Server / SSH",
  "secrets.template.serverDesc": "Host, port and a key.",
  "secrets.template.custom": "Blank",
  "secrets.template.customDesc": "Just the basic fields; add your own.",

  "secrets.field.links": "Links",
  "secrets.field.addLink": "Add link",
  "secrets.field.noLinks": "No links yet.",
  "secrets.field.extra": "Extra fields",
  "secrets.field.addExtra": "Add field",
  "secrets.field.labelPlaceholder": "Field name",
  "secrets.field.valuePlaceholder": "Value",
  "secrets.field.secretToggle": "Mask",
  "secrets.open": "Open",
  "secrets.remove": "Remove",

  "secrets.label.cardNumber": "Card number",
  "secrets.label.cardExpiry": "Expiry",
  "secrets.label.cardCvc": "CVC",
  "secrets.label.cardHolder": "Cardholder",
  "secrets.label.host": "Host",
  "secrets.label.port": "Port",
  "secrets.label.sshKey": "SSH key",

  "secrets.field.title": "Title",
  "secrets.field.group": "Group",
  "secrets.field.username": "Username",
  "secrets.field.password": "Password",
  "secrets.field.url": "URL",
  "secrets.field.tags": "Tags (comma separated)",
  "secrets.field.note": "Note",
  "secrets.generatorInfo": "Generator: {length} chars, ~{bits} bits",
  "secrets.openUrl": "Open URL",
  "secrets.copyUsername": "Copy username",
  "secrets.onlyHttp": "Only http and https links can be opened.",
  "secrets.history": {
    one: "Previous password ({count})",
    many: "Previous passwords ({count})",
  },
  "secrets.timestamps": "Created {created} · updated {updated}",
  "secrets.copyLink": "Copy note link",
  "secrets.linkCopied": "Paste that into a note to link to this entry.",
  "secrets.clipboardUnavailable": "The clipboard is unavailable here.",
  "secrets.newEntryTitle": "New entry",
  "secrets.saved": "Saved.",
  "secrets.saveFailed": "Sealbox could not save: {error}",
  "secrets.lockedClosed": "Sealbox locked — the secrets window was closed.",
  "secrets.delete.title": "Delete this entry?",
  "secrets.delete.body": "“{title}” will be removed from the secrets database.",
  "secrets.delete.warning":
    "This cannot be undone from inside Sealbox — only by restoring the .bak container.",

  "store.unreadable":
    "The secrets database decrypted correctly but its contents are not readable. A previous version may be available at {path}.",
  "store.conflictUnreadable":
    "Sealbox could not read one conflict copy ({name}). It was left in place.",
  "store.merged": {
    one: "Merged {count} sync conflict into the secrets database: {added} new entries.",
    few: "Merged {count} sync conflicts into the secrets database: {added} new entries.",
    many: "Merged {count} sync conflicts into the secrets database: {added} new entries.",
  },
  "store.mergedConflicts":
    " {edited} entries were edited on both devices; the newer edit won ({titles}).",

  "clipboard.unavailable": "This platform did not allow Sealbox to use the clipboard.",
  "clipboard.copiedNoClear": "Copied. Auto-clear is disabled, so it stays in the clipboard.",
  "clipboard.copiedWithClear": "Copied — the clipboard will be cleared in {seconds}s.",

  // --- settings -----------------------------------------------------------
  "settings.interface": "Interface",
  "settings.language.name": "Language",
  "settings.language.desc":
    "Follow Obsidian uses whatever language Obsidian itself is set to. Command names update immediately.",
  "settings.language.auto": "Follow Obsidian",

  "settings.ribbon.name": "Sidebar icons",
  "settings.ribbon.desc":
    "Which Sealbox icons appear in the left sidebar. There is deliberately no one-click “decrypt permanently” icon: it writes a readable copy back into the vault, which git and Syncthing then spread and keep in history, so it stays behind a right-click and a confirmation.",
  "settings.ribbon.secrets": "Secrets",
  "settings.ribbon.quickAdd": "New entry",
  "settings.ribbon.lock": "Lock / unlock",
  "settings.ribbon.encrypt": "Encrypt the current file",

  "settings.richEditor.name": "Rich editor for encrypted notes",
  "settings.richEditor.desc":
    "Uses Obsidian's own CodeMirror library: undo history, multiple cursors, in-document search and Markdown highlighting. It is not Obsidian's editor, though — live preview, wikilink autocomplete and embeds belong to a layer with no public API, and getting them would mean letting Obsidian open a decrypted file on disk. Turn this off for a plain text field.",

  "settings.security": "Security",
  "settings.autoLock.name": "Auto-lock after",
  "settings.autoLock.desc":
    "Minutes of inactivity before the vault locks itself and every open sealed file goes back to its lock screen. 0 disables it.",
  "settings.lockOnBlur.name": "Lock when Obsidian loses focus",
  "settings.lockOnBlur.desc":
    "Stricter, but means retyping your password whenever you switch windows.",
  "settings.clipboard.name": "Clear copied passwords after",
  "settings.clipboard.desc":
    "Seconds before the clipboard is wiped. 0 keeps the password in the clipboard. Note: on Android other apps can read the clipboard while it is there.",

  "settings.encryption": "Encryption",
  "settings.kdf.name": "Key derivation profile",
  "settings.kdf.desc":
    "Automatic picks Argon2id sized for the device, and falls back to PBKDF2 where Argon2id cannot run. Changing this only affects new keyrings and files sealed with their own password — existing files carry their own parameters.",
  "settings.kdf.auto": "Automatic (recommended)",
  "settings.kdf.desktop": "Argon2id 64 MiB",
  "settings.kdf.mobile": "Argon2id 32 MiB",
  "settings.kdf.pbkdf2": "PBKDF2-SHA512 only",
  "settings.kdf.onThisDevice": "On this device: {kdf}.",
  "settings.cascade.name": "Paranoid mode (cascade)",
  "settings.cascade.desc":
    "Adds XChaCha20-Poly1305 on top of AES-256-GCM. Honest assessment: this buys almost nothing — attacks go after passwords, not AES — and it roughly doubles the time to seal and open a file. Existing files keep opening either way.",
  "settings.verify.name": "Verify after sealing",
  "settings.verify.desc":
    "Decrypt each freshly sealed file and compare it with the original before the original is removed. Keep this on.",
  "settings.verify.warning":
    "Verification is off. A bug in Sealbox could now delete an original whose encrypted copy is unreadable.",
  "settings.original.name": "After sealing, the original is",
  "settings.original.trash": "Moved to the system trash",
  "settings.original.permanent": "Deleted immediately",
  "settings.original.keep": "Kept (still readable, still synced)",
  "settings.mobileLimit.name": "Mobile size limit (MiB)",
  "settings.mobileLimit.desc":
    "Refuse to seal or open files larger than this on a phone or tablet, instead of risking the app being killed mid-write.",

  "settings.secrets": "Secrets",
  "settings.secretsPath.name": "Secrets database path",
  "settings.secretsPath.desc":
    "A sealed container inside the vault. It is encrypted exactly like any other sealed file.",

  "settings.access": "Access and recovery",
  "settings.changePassword.name": "Change master password",
  "settings.changePassword.desc":
    "Rewrites only the keyring, so this is instant and your sealed files are untouched.",
  "settings.recovery.name": "Recovery key",
  "settings.recovery.checking": "Checking the keyring…",
  "settings.recovery.exists":
    "A recovery key exists. Creating a new one replaces it — the old one stops working.",
  "settings.recovery.missing":
    "No recovery key yet. Without one, a forgotten password means the files are gone for good.",
  "settings.recovery.createNew": "Create a new one",
  "settings.forgot.name": "Forgot your password?",
  "settings.forgot.desc": "Use your recovery key to set a new master password.",
  "settings.forgot.button": "Use recovery key",

  "settings.diagnostics": "Diagnostics",
  "settings.selfTest.name": "Run self-tests on this device",
  "settings.selfTest.desc":
    "Checks WebCrypto, Argon2id, the container format, throughput and the PDF viewer. The report contains no vault content, so it is safe to share.",
  "settings.threatModel":
    "What this protects against: a stolen laptop or phone, a leaked git repository, a copy of your Syncthing folder, a cloud backup. What it cannot protect against: malware already running on the device (it can capture your password as you type it), other Obsidian plugins, and a forgotten password with no recovery key. File names, sizes and folder structure stay visible; only contents are encrypted.",

  // --- diagnostics --------------------------------------------------------
  "diag.title": "Sealbox diagnostics",
  "diag.intro":
    "Self-tests of this plugin's own encryption on this device. No note, file name or password appears in the results, so the report is safe to share.",
  "diag.running": "Running…",
  "diag.allPassed": "All checks passed on this device.",
  "diag.someFailed": {
    one: "{count} check failed: {names}.",
    few: "{count} checks failed: {names}.",
    many: "{count} checks failed: {names}.",
  },
  "diag.save": "Save to {path}",
  "diag.copy": "Copy report",
  "diag.copied": "Report copied.",
  "diag.copyFailed": "The clipboard is unavailable here.",
  "diag.saved": "Saved {path}.",
  "diag.saveFailed": "Could not write the report file.",

  "diag.check.platform": "Platform",
  "diag.check.webcrypto": "WebCrypto AES-256-GCM",
  "diag.check.wasm": "WebAssembly",
  "diag.check.argon2": "Argon2id (configured profile)",
  "diag.check.pbkdf2": "PBKDF2-SHA512 fallback",
  "diag.check.format": "Container format self-test",
  "diag.check.formatCascade": "Container format self-test (cascade)",
  "diag.check.throughput": "Throughput",
  "diag.check.pdf": "PDF worker",
  "diag.check.editor": "Rich editor",
  "diag.result.editorOk": "CodeMirror loads from Obsidian and starts here",
  "diag.error.editor": "CodeMirror is unavailable; notes fall back to a plain textarea ({error})",

  "diag.result.webcrypto": "AES-256-GCM encrypt/decrypt works",
  "diag.result.wasm": "WebAssembly compiles and instantiates",
  "diag.result.kdf": "{kdf} took {ms} ms",
  "diag.result.format": "round-trip, tamper and truncation detection all pass",
  "diag.result.formatCascade":
    "cascade round-trip, tamper and truncation detection all pass",
  "diag.result.throughput":
    "{size}: seal {sealMs} ms ({sealRate} MiB/s), open {openMs} ms ({openRate} MiB/s)",
  "diag.result.pdfOk":
    "worker started and parsed (rejected the invalid test input, as expected)",
  "diag.result.pdfLenient": "worker started (and surprisingly accepted the test input)",
  "diag.error.pdf": "the pdf.js worker did not start: {error}",
  "diag.error.flippedBit": "a flipped bit was NOT detected — do not use this build",
  "diag.error.truncation": "truncation was NOT detected",

  "diag.report.generated": "Generated {timestamp}",
  "diag.report.colCheck": "Check",
  "diag.report.colResult": "Result",
  "diag.report.colDetail": "Detail",
  "diag.report.pass": "pass",
  "diag.report.fail": "FAIL",
  "diag.report.footer":
    "This report contains no vault content, file names or key material.",

  // --- errors shown to the user -------------------------------------------
  "error.actionFailed": "Sealbox could not finish that: {error}",
  "notice.notSetUp":
    "Sealbox is not set up yet. Encrypt a file, or create a recovery key, and it will ask you to choose a master password first.",
  "error.unknown": "an unknown error occurred",
  "error.generic": "Something went wrong. See the Sealbox diagnostics screen.",

  "crypto.wrongPassword": "wrong password, or this file was tampered with",
  "crypto.blockFailed":
    "this file is damaged or was modified (block {index} of {total} failed its integrity check)",
  "crypto.sizeMismatch": "decrypted size does not match the metadata",
  "crypto.wrongMasterPassword": "wrong master password",
  "crypto.keyringDamagedMk":
    "the password is correct but the wrapped master key is damaged — restore the keyring from a backup or use your recovery key",
  "crypto.keyringNoRecovery": "this keyring has no recovery key configured",
  "crypto.recoveryMismatch": "that recovery key does not match this vault",
  "crypto.recoveryMalformed": "recovery slot holds a malformed master key",
  "crypto.keyringNotJson":
    "keyring.json is not valid JSON — restore it from a backup before doing anything else",
  "crypto.keyringNotObject": "keyring is not a JSON object",
  "crypto.keyringVersion": "keyring version {version} is not supported by this plugin",
  "crypto.keyringMissingFields": "keyring is missing required fields",
  "crypto.keyringBadBox": "keyring contains a malformed box",
  "crypto.keyringUnknownKdf": "keyring names an unknown key derivation function",
  "crypto.keyringSaltShort": "keyring salt is too short",
  "crypto.keyringBadNonce": "bad nonce in keyring",
  "crypto.keyringMkSize": "wrapped master key has the wrong size",

  "recoveryKey.empty": "recovery key is empty",
  "recoveryKey.short": "recovery key is too short",
  "recoveryKey.badChar": 'unexpected character "{char}"',
  "recoveryKey.checksum": "that recovery key has a typo in it (checksum does not match)",

  "container.tooShort": "file is too short to be a Sealbox container",
  "container.notContainer": "not a Sealbox container",
  "container.futureVersion":
    "container format v{version} is newer than this plugin understands",
  "container.unknownFlags": "container uses unknown feature flags",
  "container.reservedNotEmpty": "reserved header bytes are not empty",
  "container.unknownKdf": "unknown key derivation function",
  "container.vaultWithKdf": "vault-keyed container must not carry a kdf",
  "container.chunkRange": "chunk size out of range",
  "container.metaRange": "metadata length out of range",
  "container.truncatedMeta": "container is truncated inside its metadata",
  "container.implausibleArgon": "implausible argon2id parameters",
  "container.argonTooLarge": "argon2id memory cost is unreasonably large",
  "container.pbkdf2WithArgon": "pbkdf2 container carries argon2 parameters",
  "container.implausiblePbkdf2": "implausible pbkdf2 iteration count",
  "container.kdfWithoutKdf": "kdf parameters present without a kdf",
  "container.bodyTruncated": "container body is truncated",
  "container.implausibleChunks": "implausible chunk count",
  "container.payloadTooLarge": "payload is too large",
  "container.metaNotJson": "metadata is not valid JSON",
  "container.metaNotObject": "metadata is not an object",
  "container.metaVersion": "unsupported metadata version",
  "container.metaPathSeparator": "metadata name contains a path separator",
} as const;
