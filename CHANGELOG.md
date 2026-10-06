# Changelog

## 0.1.3

Dialog buttons are centred on desktop as well as on a phone. 0.1.2 centred them
behind a mobile check, which left the same dialog looking one way on a laptop and
another on a phone for no reason a user could see.

The reveal button beside a password field keeps its place next to the input, and
the Save row in the secrets window stays where it is — those belong to a form,
not to a dialog.

## 0.1.2

**Two dialogs could fail silently.** `Modal.onOpen` returns nothing, so Obsidian
calls it and throws the result away. The secrets window and the self-tests both
declared it `async`, which meant a failure inside either reached nobody: the
window would open empty, with no notice and nothing in a log. Both now open
through `runAction`, which always reports. A test walks every `Modal` subclass
and fails if an `async onOpen` comes back.

The README now explains what happens to the plaintext original after sealing, and
why the plugin does not follow Obsidian's deletion preference for that one file:
one of the choices is a `.trash` folder inside the vault, which git and Syncthing
would then carry to every other device.

## 0.1.1

Everything the community directory review flagged.

- `minAppVersion` is 1.8.7, which is the truth. `getLanguage()` and
  `Notice.messageEl` are 1.8.7 APIs; the manifest claimed 1.5.0 and the code
  worked around the gap with runtime guards. The guards are gone and the
  `obsidian` typings are pinned to the same version, so the compiler enforces it.
- **The build reproduces.** It carried a timestamp in its banner, so rebuilding a
  release produced a different file by four bytes and nothing could be checked
  against the source. The timestamp is gone, the release gate fails if anything
  varying returns, and the workflow rebuilds and compares before publishing.
  Releases also carry GitHub provenance attestations.
- The PDF canvas is sized by the stylesheet instead of by assigning to
  `element.style`.
- Timers go through `window.*` so they survive a popped-out window, and
  `instanceof` checks are `.instanceOf()` so they work across windows.
- `log.debug` and `log.info` were never called. A logger nobody uses is still a
  way for data to escape, so they are deleted rather than left available.

## 0.1.0

First release.

- `.sealed` files open to a lock screen; without the password you see the file
  size and nothing else.
- One password unlocks the vault for a session, stretched once rather than once
  per file.
- Markdown and text are editable in place, images and PDFs render, anything else
  decrypts to memory.
- A secrets manager with groups, tags, several links per entry, custom fields and
  templates.
- A recovery key, revoked and reissued whenever the master password changes.
- English and Russian, following Obsidian's own language by default.
