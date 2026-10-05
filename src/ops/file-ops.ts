/**
 * Sealing and unsealing files in the vault.
 *
 * The ordering here is deliberate and is the part that protects data rather than
 * secrecy: write the container, read it back and verify it decrypts, and only
 * then remove the plaintext original. A bug in this plugin should cost you a
 * duplicate file, never the file.
 */

import { App, Notice, Platform, TFile, TFolder, type TAbstractFile } from "obsidian";
import { timingSafeEqual, zero } from "../crypto/bytes.ts";
import { defaultMeta, readMeta, seal, unseal, type SealedMeta } from "../crypto/seal.ts";
import { basename, readBytes, toArrayBuffer, uniquePath, writeAtomic } from "../fs/vaultio.ts";
import { log, userMessage } from "../log.ts";
import { formatBytes, mimeFor } from "../mime.ts";
import { SEALED_SUFFIX, type SealboxSettings } from "../settings.ts";
import type { VaultController } from "../vault-controller.ts";
import { t } from "../i18n/index.ts";

export interface SealProgress {
  update(text: string): void;
  done(): void;
}

function noticeProgress(initial: string): SealProgress {
  const notice = new Notice(initial, 0);
  return {
    update: (text) => notice.setMessage(text),
    done: () => notice.hide(),
  };
}

export class SealedFileOps {
  private warnedLocalTrash = false;

  constructor(
    private app: App,
    private controller: VaultController,
    private getSettings: () => SealboxSettings,
  ) {}

  private get adapter() {
    return this.app.vault.adapter;
  }

  /**
   * Phones have far less headroom than desktops and Obsidian hands us the whole
   * file as one buffer, so an explicit refusal beats an out-of-memory crash that
   * takes the app down mid-write.
   */
  private checkSize(bytes: number, what: string): void {
    if (!Platform.isMobile) return;
    const limit = this.getSettings().maxMobileMiB * 1024 * 1024;
    if (bytes > limit) {
      throw new Error(
        t("ops.mobileSizeLimit", {
          name: what,
          size: formatBytes(bytes),
          limit: this.getSettings().maxMobileMiB,
        }),
      );
    }
  }

  async readSealed(file: TFile): Promise<{ meta: SealedMeta; data: Uint8Array }> {
    const masterKey = await this.controller.ensureUnlocked();
    if (!masterKey) throw new Error(t("vault.locked"));
    const container = await readBytes(this.app.vault, file.path);
    this.checkSize(container.length, file.name);
    return unseal(container, { kind: "vault", masterKey });
  }

  /** Same as `readSealed`, for files addressed by path rather than by `TFile`. */
  async readSealedAtPath(path: string): Promise<{ meta: SealedMeta; data: Uint8Array }> {
    const masterKey = await this.controller.ensureUnlocked();
    if (!masterKey) throw new Error(t("vault.locked"));
    const container = await readBytes(this.app.vault, path);
    this.checkSize(container.length, path);
    return unseal(container, { kind: "vault", masterKey });
  }

  async readSealedMeta(file: TFile): Promise<SealedMeta> {
    const masterKey = await this.controller.ensureUnlocked();
    if (!masterKey) throw new Error(t("vault.locked"));
    const container = await readBytes(this.app.vault, file.path);
    return readMeta(container, { kind: "vault", masterKey });
  }

  /** Seal `data` into a container with the current vault key and settings. */
  private async sealForWrite(data: Uint8Array, meta: SealedMeta): Promise<Uint8Array> {
    const masterKey = await this.controller.ensureUnlocked();
    if (!masterKey) throw new Error(t("vault.locked"));
    this.checkSize(data.length, meta.name);
    const settings = this.getSettings();
    return seal(data, meta, { kind: "vault", masterKey }, {
      cascade: settings.cascade,
      chunkKiB: settings.chunkKiB,
    });
  }

  /**
   * Re-seal new content into a container addressed by path.
   *
   * Uses the rename-based atomic write, so this is for files Obsidian does not
   * have open in a view: the keyring, the secrets database, fresh containers.
   */
  async writeSealed(path: string, data: Uint8Array, meta: SealedMeta): Promise<void> {
    await writeAtomic(this.adapter, path, await this.sealForWrite(data, meta));
  }

  /**
   * Re-seal new content into a file that may be open in a view.
   *
   * This has to go through `vault.modifyBinary` rather than the atomic write.
   * The atomic write renames the target aside and deletes it, which Obsidian's
   * watcher sees as "the open file was deleted" — it then closes the tab and
   * moves the user somewhere else, on every save. `modifyBinary` is a modify in
   * Obsidian's own terms, so the view stays exactly where it is.
   */
  async writeSealedToFile(file: TFile, data: Uint8Array, meta: SealedMeta): Promise<void> {
    const container = await this.sealForWrite(data, meta);
    await this.app.vault.modifyBinary(file, toArrayBuffer(container));
  }

  /**
   * Seal one plaintext file. Returns the new `.sealed` path, or null if the user
   * cancelled at the password prompt.
   */
  async sealFile(file: TFile, progress?: SealProgress): Promise<string | null> {
    if (file.extension === "sealed") {
      new Notice(t("ops.alreadySealed", { name: file.name }));
      return null;
    }
    const masterKey = await this.controller.ensureUnlocked();
    if (!masterKey) return null;

    const settings = this.getSettings();
    const plain = await readBytes(this.app.vault, file.path);
    this.checkSize(plain.length, file.name);
    const target = await uniquePath(this.adapter, `${file.path}${SEALED_SUFFIX}`);

    try {
      const meta = defaultMeta(file.name, mimeFor(file.name), plain.length);
      meta.mtime = file.stat.mtime;
      meta.ctime = file.stat.ctime;

      const container = await seal(plain, meta, { kind: "vault", masterKey }, {
        cascade: settings.cascade,
        chunkKiB: settings.chunkKiB,
        onProgress: (done, total) =>
          progress?.update(
            t("ops.sealing", {
              name: file.name,
              done: formatBytes(done),
              total: formatBytes(total),
            }),
          ),
      });

      await writeAtomic(this.adapter, target, container);

      if (settings.verifyAfterSeal) {
        progress?.update(t("ops.verifying", { name: file.name }));
        const check = await unseal(await readBytes(this.app.vault, target), {
          kind: "vault",
          masterKey,
        });
        const ok =
          check.data.length === plain.length && timingSafeEqual(check.data, plain);
        zero(check.data);
        if (!ok) {
          // Leave both files in place and say so loudly. Deleting the original
          // after a failed verification is how data actually gets lost.
          throw new Error(t("ops.verifyFailed", { path: target }));
        }
      }

      await this.disposeOriginal(file, settings);
      return target;
    } finally {
      zero(plain);
    }
  }

  /**
   * Get rid of the plaintext original once the sealed copy is known good.
   *
   * The subtlety is `Vault.trash(file, true)`: it only *tries* the system trash
   * and silently falls back to the vault's own `.trash` folder. For a plaintext
   * original that fallback is a leak — the file is still inside the vault, so git
   * and Syncthing copy it to the other devices and into history.
   */
  private async disposeOriginal(file: TFile, settings: SealboxSettings): Promise<void> {
    switch (settings.originalHandling) {
      case "keep":
        new Notice(t("ops.keptOriginal", { name: file.name }), 8000);
        return;

      case "permanent":
        await this.app.vault.delete(file);
        return;

      default: {
        if (Platform.isMobile) {
          // Mobile has no system trash at all, so that fallback is guaranteed.
          // Delete outright — the sealed copy was verified a moment ago.
          await this.app.vault.delete(file);
          if (!this.warnedLocalTrash) {
            this.warnedLocalTrash = true;
            new Notice(t("ops.mobileTrashNote"), 10000);
          }
          return;
        }
        const name = file.name;
        await this.app.vault.trash(file, true);
        await this.sweepLocalTrash(name);
      }
    }
  }

  /** Remove a plaintext copy that the local-trash fallback just created. */
  private async sweepLocalTrash(name: string): Promise<void> {
    try {
      const listing = await this.adapter.list(".trash");
      const cutoff = Date.now() - 15000;
      for (const path of listing.files) {
        if (basename(path) !== name) continue;
        // Only something that appeared just now: the user's older trashed files
        // are none of our business.
        const stat = await this.adapter.stat(path);
        if (stat && stat.mtime >= cutoff) {
          await this.adapter.remove(path);
          new Notice(t("ops.sweptLocalTrash", { name }), 10000);
        }
      }
    } catch {
      // No .trash folder, or it cannot be listed: nothing to sweep.
    }
  }

  /**
   * Decrypt back to a normal plaintext file. The caller is responsible for
   * having warned the user: this puts readable data back into a vault that is
   * being synced by git and Syncthing.
   */
  async unsealToPlaintext(file: TFile): Promise<string | null> {
    const { meta, data } = await this.readSealed(file);
    try {
      const folder = file.parent?.path ?? "";
      const desired = folder && folder !== "/" ? `${folder}/${meta.name}` : meta.name;
      const target = await uniquePath(this.adapter, desired);
      await writeAtomic(this.adapter, target, data);
      await this.app.vault.trash(file, true);
      return target;
    } finally {
      zero(data);
    }
  }

  /** Seal every plaintext file under a folder, skipping what is already sealed. */
  async sealFolder(folder: TFolder): Promise<void> {
    const targets: TFile[] = [];
    const walk = (f: TAbstractFile) => {
      if (f instanceof TFolder) {
        for (const child of f.children) walk(child);
      } else if (f instanceof TFile && f.extension !== "sealed") {
        targets.push(f);
      }
    };
    walk(folder);
    if (targets.length === 0) {
      new Notice(t("ops.folderEmpty"));
      return;
    }
    if (!(await this.controller.ensureUnlocked())) return;

    const progress = noticeProgress(t("ops.folderStart", { count: targets.length }));
    let done = 0;
    let failed = 0;
    try {
      for (const file of targets) {
        progress.update(
          t("ops.folderProgress", {
            index: done + 1,
            total: targets.length,
            name: file.name,
          }),
        );
        try {
          await this.sealFile(file, progress);
          done++;
        } catch (e) {
          failed++;
          log.warn("could not seal a file in the folder", e);
          new Notice(t("ops.skipped", { name: file.name, error: userMessage(e) }), 6000);
        }
      }
    } finally {
      progress.done();
    }
    new Notice(
      failed === 0
        ? t("ops.folderDone", { count: done })
        : t("ops.folderDoneWithFailures", { done, failed }),
      8000,
    );
  }

  /** Create a new, empty encrypted note and return its path. */
  async createSealedNote(folderPath: string, baseName = "Untitled"): Promise<string | null> {
    const masterKey = await this.controller.ensureUnlocked();
    if (!masterKey) return null;
    const settings = this.getSettings();
    const target = await uniquePath(
      this.adapter,
      folderPath && folderPath !== "/"
        ? `${folderPath}/${baseName}.md${SEALED_SUFFIX}`
        : `${baseName}.md${SEALED_SUFFIX}`,
    );
    const container = await seal(
      new Uint8Array(0),
      defaultMeta(`${baseName}.md`, "text/markdown", 0),
      { kind: "vault", masterKey },
      { cascade: settings.cascade, chunkKiB: settings.chunkKiB },
    );
    // `vault.createBinary` rather than the adapter: it registers the new file in
    // Obsidian's index straight away, so the caller can open it immediately
    // instead of waiting for the folder watcher to notice.
    await this.app.vault.createBinary(target, toArrayBuffer(container));
    return target;
  }

  progressNotice = noticeProgress;
}
