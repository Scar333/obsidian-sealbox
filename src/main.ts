import {
  Menu,
  Notice,
  Plugin,
  TFile,
  TFolder,
  WorkspaceLeaf,
  getLanguage,
  type Command,
  type MarkdownPostProcessorContext,
} from "obsidian";
import { SealedFileOps } from "./ops/file-ops.ts";
import { SecretsModal } from "./secrets/modal.ts";
import { SecretsStore } from "./secrets/store.ts";
import { quickAddSecret } from "./secrets/quick-add.ts";
import { copyFileLink } from "./ops/links.ts";
import { cancelPendingClear } from "./secrets/clipboard.ts";
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  resolveLanguage,
  SEALED_EXTENSION,
  SEALED_SUFFIX,
  type SealboxSettings,
} from "./settings.ts";
import { setLanguage, t } from "./i18n/index.ts";
import { runAction, runQuietly } from "./ui/run.ts";
import { setSafeIcon } from "./ui/icons.ts";
import { noticeWithAction } from "./ui/notices.ts";
import { VaultController } from "./vault-controller.ts";
import { SEALED_VIEW_TYPE, SealedView } from "./views/sealed-view.ts";
import { disposePdfWorker } from "./views/viewers/pdf.ts";
import { DiagnosticsModal } from "./ui/diagnostics.ts";
import { EnterRecoveryKeyModal } from "./ui/recovery-modals.ts";
import { confirmAction } from "./ui/confirm.ts";
import { SealboxSettingTab } from "./ui/settings-tab.ts";
import { recoverInterrupted } from "./fs/vaultio.ts";
import { log, userMessage } from "./log.ts";
import type { SealboxHost } from "./host.ts";

export default class SealboxPlugin extends Plugin implements SealboxHost {
  override settings: SealboxSettings = { ...DEFAULT_SETTINGS };
  controller!: VaultController;
  ops!: SealedFileOps;
  secrets!: SecretsStore;
  private statusBarEl: HTMLElement | null = null;
  /** The sidebar icons we created, so they can be rebuilt or removed. */
  private ribbon: Partial<
    Record<"secrets" | "quickAdd" | "lock" | "encrypt", HTMLElement>
  > = {};
  /** Global ids of the commands we registered, so they can be re-registered. */
  private commandIds: string[] = [];

  override async onload(): Promise<void> {
    this.settings = normalizeSettings(await this.loadData());
    // Before anything that produces a label.
    setLanguage(resolveLanguage(this.settings.language, getLanguage()));

    this.controller = new VaultController(
      this.app,
      this.manifest.dir ?? `.obsidian/plugins/${this.manifest.id}`,
      () => this.settings,
    );
    this.ops = new SealedFileOps(this.app, this.controller, () => this.settings);
    this.secrets = new SecretsStore(this);

    this.registerView(SEALED_VIEW_TYPE, (leaf: WorkspaceLeaf) => new SealedView(leaf, this));
    try {
      this.registerExtensions([SEALED_EXTENSION], SEALED_VIEW_TYPE);
    } catch (e) {
      // Another encryption plugin may already own the extension.
      log.error("could not claim the sealed-file extension", e);
      new Notice(t("notice.extensionTaken", { ext: SEALED_EXTENSION }), 10000);
    }

    this.addSettingTab(new SealboxSettingTab(this.app, this, this));
    this.registerCommands();
    this.registerMenus();
    this.registerSecretLinks();

    this.statusBarEl = this.addStatusBarItem();
    this.registerEvent(
      this.app.workspace.on("quit", () => this.controller.lock()),
    );
    this.register(
      this.controller.session.onChange((state) => {
        if (state === "locked") {
          this.secrets.forget();
          // Drop the cached keyring too. Otherwise a password changed on another
          // device and synced here would keep being rejected until Obsidian
          // restarts, because we would still be checking against the old wrap.
          this.controller.invalidateKeyringCache();
        }
        this.updateStatusBar();
        this.updateRibbonState();
      }),
    );

    // The encrypt icon describes the file it would act on, so it has to follow
    // whatever is in front of the user. Registered separately because
    // `workspace.on` is overloaded per event name and will not take a union.
    this.registerEvent(
      this.app.workspace.on("file-open", () => this.updateRibbonState()),
    );
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => this.updateRibbonState()),
    );
    this.updateStatusBar();

    this.refreshRibbon();

    if (this.settings.lockOnBlur) {
      this.registerDomEvent(window, "blur", () => this.controller.lock());
    }

    // Repair anything a crash left mid-write before the user touches a file.
    this.app.workspace.onLayoutReady(() => {
      runQuietly("crash recovery scan", () => this.repairAfterCrash());
    });
  }

  override onunload(): void {
    // The key goes first: every view listens for the lock and wipes its own
    // decrypted content in response.
    this.controller.lock();
    this.secrets.forget();
    cancelPendingClear();
    disposePdfWorker();
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.controller.applySettings(this.settings);
  }

  /**
   * Switch the interface language at runtime.
   *
   * Command names live in Obsidian's global command list, so they are not
   * re-read on their own: the commands have to be removed and added again.
   * `removeCommand` only exists from Obsidian 1.7.2, so on anything older the
   * palette keeps the old names until the next reload — everything else still
   * switches immediately.
   */
  applyLanguage(): void {
    setLanguage(resolveLanguage(this.settings.language, getLanguage()));
    this.registerCommands();
    this.refreshRibbon();
    this.updateStatusBar();
  }

  /**
   * (Re)create the sidebar icons from the settings.
   *
   * There is no `removeRibbonIcon` in the API, but the element `addRibbonIcon`
   * hands back is ours, so rebuilding from scratch is both simplest and correct.
   *
   * Note what is deliberately absent: a one-click "decrypt permanently" icon.
   * That action writes a readable copy back into the vault, where git and
   * Syncthing spread it and keep it in history — a mis-click there cannot be
   * taken back, so it stays behind a right-click and a confirmation.
   */
  refreshRibbon(): void {
    for (const el of Object.values(this.ribbon)) el?.remove();
    this.ribbon = {};

    if (this.settings.ribbonSecrets) {
      this.ribbon.secrets = this.addRibbonIcon("key-round", t("ribbon.secrets"), () =>
        runAction("open secrets", () => this.openSecrets()),
      );
    }
    if (this.settings.ribbonQuickAdd) {
      this.ribbon.quickAdd = this.addRibbonIcon(
        "user-plus",
        t("ribbon.quickAdd"),
        () => runAction("quick add secret", () => this.quickAdd()),
      );
    }
    if (this.settings.ribbonLock) {
      this.ribbon.lock = this.addRibbonIcon("lock", t("statusbar.locked"), () => {
        if (this.controller.isUnlocked) this.controller.lock();
        else runAction("unlock", () => this.controller.ensureUnlocked());
      });
    }
    if (this.settings.ribbonEncrypt) {
      this.ribbon.encrypt = this.addRibbonIcon(
        "file-lock",
        t("ribbon.encrypt.noFile"),
        () =>
          runAction("toggle encryption", () => this.toggleActiveFileEncryption()),
      );
    }
    this.updateRibbonState();
  }

  /** Keep the icons telling the truth about the lock state and the open file. */
  private updateRibbonState(): void {
    const lockEl = this.ribbon.lock;
    if (lockEl) {
      const unlocked = this.controller.isUnlocked;
      setSafeIcon(lockEl, unlocked ? "unlock" : "lock");
      lockEl.setAttribute(
        "aria-label",
        unlocked ? t("statusbar.unlocked") : t("statusbar.locked"),
      );
    }

    const encryptEl = this.ribbon.encrypt;
    if (encryptEl) {
      // One icon, one action, decided by the open file. Two adjacent buttons
      // would let a mis-click decrypt when you meant to encrypt; a toggle cannot
      // be wrong about which of the two it is offering — and the decrypt
      // direction still goes through its confirmation dialog.
      const file = this.app.workspace.getActiveFile();
      const sealed = file?.extension === SEALED_EXTENSION;
      setSafeIcon(encryptEl, sealed ? "file-key" : "file-lock");
      encryptEl.setAttribute(
        "aria-label",
        !file
          ? t("ribbon.encrypt.noFile")
          : sealed
            ? t("ribbon.decrypt.ready", { name: file.name })
            : t("ribbon.encrypt.ready", { name: file.name }),
      );
      // Dimmed only when there is genuinely nothing to act on.
      encryptEl.toggleClass("sealbox-ribbon-idle", !file);
    }
  }

  /** Encrypt the open file, or take the encryption off it — whichever applies. */
  private async toggleActiveFileEncryption(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new Notice(t("notice.openFileFirst"));
      return;
    }
    if (file.extension === SEALED_EXTENSION) {
      // Same confirmation as the command and the context menu. This is what
      // makes the toggle safe against habit: the second press cannot write
      // plaintext back without you reading what it is about to do.
      await this.unsealWithConfirmation(file);
      return;
    }
    await this.sealFileWithFeedback(file);
  }

  /**
   * Undo a seal that just happened.
   *
   * Offered from the success notice rather than as a permanent button: "I changed
   * my mind" is a different intent from "decrypt this file", and it is only this
   * safe for a few seconds — before any sync has carried the change away.
   */
  private async undoSeal(sealedPath: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(sealedPath);
    if (!(file instanceof TFile)) {
      new Notice(
        t("notice.undoUnavailable", {
          command: `Sealbox: ${t("command.decryptPermanently")}`,
        }),
        12000,
      );
      return;
    }
    const restored = await this.ops.unsealToPlaintext(file);
    if (restored) {
      const name = restored.slice(restored.lastIndexOf("/") + 1);
      new Notice(t("notice.undone", { name }), 8000);
    }
  }

  private updateStatusBar(): void {
    if (!this.statusBarEl) return;
    const unlocked = this.controller.isUnlocked;
    this.statusBarEl.empty();
    this.statusBarEl.setText(unlocked ? "🔓 Sealbox" : "🔒 Sealbox");
    this.statusBarEl.setAttribute(
      "aria-label",
      unlocked ? t("statusbar.unlocked") : t("statusbar.locked"),
    );
    this.statusBarEl.addClass("mod-clickable");
    this.statusBarEl.onclick = () => {
      if (this.controller.isUnlocked) this.controller.lock();
      else runAction("unlock", () => this.controller.ensureUnlocked());
    };
  }

  private async repairAfterCrash(): Promise<void> {
    try {
      const repaired = await recoverInterrupted(this.app.vault.adapter, "/");
      if (repaired.length > 0) {
        new Notice(t("notice.restored", { count: repaired.length }), 10000);
      }
    } catch (e) {
      log.warn("crash recovery scan failed", e);
    }
  }

  /** (Re)register every command under the current language. */
  private registerCommands(): void {
    for (const id of this.commandIds) {
      // Guard: removeCommand only exists from Obsidian 1.7.2.
      if (typeof this.removeCommand === "function") this.removeCommand(id);
    }
    this.commandIds = [];
    const add = (command: Command): void => {
      this.addCommand(command);
      this.commandIds.push(`${this.manifest.id}:${command.id}`);
    };

    add({
      id: "unlock",
      name: t("command.unlock"),
      callback: () => runAction("unlock", () => this.controller.ensureUnlocked()),
    });

    add({
      id: "lock",
      name: t("command.lock"),
      callback: () => {
        this.controller.lock();
        new Notice(t("notice.locked"));
      },
    });

    add({
      id: "seal-active-file",
      name: t("command.sealActive"),
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension === SEALED_EXTENSION) return false;
        if (!checking) runAction("seal file", () => this.sealFileWithFeedback(file));
        return true;
      },
    });

    add({
      id: "decrypt-permanently",
      name: t("command.decryptPermanently"),
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== SEALED_EXTENSION) return false;
        if (!checking) {
          runAction("decrypt permanently", () => this.unsealWithConfirmation(file));
        }
        return true;
      },
    });

    add({
      id: "new-sealed-note",
      name: t("command.newSealedNote"),
      callback: () => runAction("new encrypted note", () => this.createSealedNote()),
    });

    add({
      id: "open-secrets",
      name: t("command.openSecrets"),
      callback: () => runAction("open secrets", () => this.openSecrets()),
    });

    add({
      id: "quick-add-secret",
      name: t("command.quickAdd"),
      callback: () => runAction("quick add secret", () => this.quickAdd()),
    });

    add({
      id: "merge-secret-conflicts",
      name: t("command.mergeConflicts"),
      callback: () =>
        runAction("merge secret conflicts", async () => {
          if (!(await this.controller.ensureUnlocked())) return;
          const merged = await this.secrets.mergeConflicts();
          if (merged === 0) new Notice(t("notice.noConflicts"));
        }),
    });

    add({
      id: "recover-access",
      name: t("command.recoverAccess"),
      callback: () => new EnterRecoveryKeyModal(this.app, this, "reset").open(),
    });

    add({
      id: "copy-file-link",
      name: t("command.copyFileLink"),
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== SEALED_EXTENSION) return false;
        if (!checking) runAction("copy file link", () => copyFileLink(this.app, file));
        return true;
      },
    });

    add({
      id: "diagnostics",
      name: t("command.diagnostics"),
      callback: () => new DiagnosticsModal(this.app, this).open(),
    });
  }

  private registerMenus(): void {
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu: Menu, file) => {
        if (file instanceof TFolder) {
          menu.addItem((item) =>
            item
              .setTitle(t("menu.sealFolder"))
              .setIcon("lock")
              .onClick(() => runAction("seal folder", () => this.ops.sealFolder(file))),
          );
          menu.addItem((item) =>
            item
              .setTitle(t("menu.newNoteHere"))
              .setIcon("file-plus")
              .onClick(() =>
                runAction("new encrypted note", () => this.createSealedNote(file.path)),
              ),
          );
          return;
        }
        if (!(file instanceof TFile)) return;

        if (file.extension === SEALED_EXTENSION) {
          menu.addItem((item) =>
            item
              .setTitle(t("menu.copyLink"))
              .setIcon("link")
              .onClick(() => runAction("copy file link", () => copyFileLink(this.app, file))),
          );
          menu.addItem((item) =>
            item
              .setTitle(t("menu.decrypt"))
              .setIcon("unlock")
              .onClick(() =>
                runAction("decrypt permanently", () => this.unsealWithConfirmation(file)),
              ),
          );
        } else {
          menu.addItem((item) =>
            item
              .setTitle(t("menu.seal"))
              .setIcon("lock")
              .onClick(() => runAction("seal file", () => this.sealFileWithFeedback(file))),
          );
        }
      }),
    );
  }

  /**
   * Render `[[sealbox:<id>]]` as a chip that opens the secrets window on that
   * entry, so a normal note can point at a credential without containing it.
   */
  private registerSecretLinks(): void {
    this.registerMarkdownPostProcessor(
      (el: HTMLElement, _ctx: MarkdownPostProcessorContext) => {
        for (const link of Array.from(el.querySelectorAll("a.internal-link"))) {
          const text = link.textContent ?? "";
          if (!text.startsWith("sealbox:")) continue;
          const id = text.slice("sealbox:".length).trim();
          if (!/^[0-9a-f]{8,64}$/.test(id)) continue;
          const chip = document.createElement("a");
          chip.addClass("sealbox-chip");
          chip.setText(t("chip.secret"));
          chip.setAttribute("href", "#");
          chip.addEventListener("click", (ev) => {
            ev.preventDefault();
            runAction("open secrets", () => this.openSecrets(id));
          });
          link.replaceWith(chip);
        }
      },
    );
  }

  private async sealFileWithFeedback(file: TFile): Promise<void> {
    const progress = this.ops.progressNotice(t("ops.folderStart", { count: 1 }));
    try {
      const target = await this.ops.sealFile(file, progress);
      if (target) {
        const sealedPath = target;
        noticeWithAction(t("notice.sealedAs", { path: sealedPath }), t("notice.undo"), () =>
          runAction("undo seal", () => this.undoSeal(sealedPath)),
        );
      }
    } catch (e) {
      log.error("sealing a file failed", e);
      new Notice(t("notice.sealFailed", { name: file.name, error: userMessage(e) }), 12000);
    } finally {
      progress.done();
    }
  }

  private async unsealWithConfirmation(file: TFile): Promise<void> {
    const confirmed = await confirmAction(this.app, {
      title: t("confirm.decrypt.title", { name: file.name }),
      body: t("confirm.decrypt.body"),
      warning: t("confirm.decrypt.warning"),
      confirmLabel: t("confirm.decrypt.action"),
      destructive: true,
    });
    if (!confirmed) return;
    try {
      const target = await this.ops.unsealToPlaintext(file);
      if (target) new Notice(t("notice.decryptedTo", { path: target }), 12000);
    } catch (e) {
      log.error("decrypting a file failed", e);
      new Notice(
        t("notice.decryptFailed", { name: file.name, error: userMessage(e) }),
        12000,
      );
    }
  }

  private async createSealedNote(folderPath?: string): Promise<void> {
    const folder =
      folderPath ?? this.app.workspace.getActiveFile()?.parent?.path ?? "";
    try {
      const path = await this.ops.createSealedNote(folder);
      if (!path) return;
      const leaf = this.app.workspace.getLeaf(false);
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) {
        await leaf.openFile(file);
      } else {
        new Notice(t("notice.createdNote", { path }));
      }
    } catch (e) {
      log.error("could not create an encrypted note", e);
      new Notice(t("notice.createNoteFailed", { error: userMessage(e) }));
    }
  }

  /** Straight to a filled-in form, without going through the browser window. */
  private async quickAdd(): Promise<void> {
    await quickAddSecret(this.app, this, this.secrets);
  }

  private async openSecrets(focusId?: string): Promise<void> {
    if (!(await this.controller.ensureUnlocked())) return;
    try {
      // Fold in anything sync left behind before showing a stale list.
      await this.secrets.mergeConflicts();
    } catch (e) {
      log.warn("conflict merge on open failed", e);
    }
    new SecretsModal(this.app, this, this.secrets, focusId).open();
  }
}

export { SEALED_SUFFIX };
