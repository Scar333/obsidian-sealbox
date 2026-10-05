/**
 * The view for a `.sealed` file.
 *
 * It has exactly two states. **Locked** shows a lock screen and nothing else, so
 * someone without the password can open the file, see that it is sealed, and
 * navigate away. **Unlocked** renders the payload with a viewer chosen from the
 * metadata.
 *
 * The rule the whole file is built around: decrypted bytes live in this object
 * and in the DOM, and nowhere else. They are never written to a file, and they
 * are wiped the moment the vault locks, the leaf closes, or another file is
 * opened in it. Edits are re-encrypted in place — there is deliberately no
 * "decrypt to a normal note while I work on it" mode, because that plaintext
 * would immediately be picked up by git and Syncthing.
 */

import { FileView, MarkdownRenderer, Notice, TFile, WorkspaceLeaf } from "obsidian";
import { utf8, zero, fromUtf8 } from "../crypto/bytes.ts";
import type { SealedMeta } from "../crypto/seal.ts";
import type { SealboxHost } from "../host.ts";
import { log, userMessage } from "../log.ts";
import { formatBytes, isEditable, viewerFor, type ViewerKind } from "../mime.ts";
import { renderImage, type ViewerHandle } from "./viewers/image.ts";
import { renderPdf } from "./viewers/pdf.ts";
import { createEditor, type TextEditorHandle } from "./editor/index.ts";
import { copyFileLink } from "../ops/links.ts";
import { SaveQueue } from "./editor/save-queue.ts";
import { t } from "../i18n/index.ts";
import { runAction, runQuietly } from "../ui/run.ts";

export const SEALED_VIEW_TYPE = "sealbox-sealed-view";

const AUTOSAVE_DELAY_MS = 2500;

export class SealedView extends FileView {
  private host: SealboxHost;
  private unsubscribe: (() => void) | null = null;
  private viewer: ViewerHandle | null = null;
  private editor: TextEditorHandle | null = null;
  /** Serialises every save; see save-queue.ts for why that matters. */
  private readonly saves = new SaveQueue(() => this.writeOnce());
  /** A user-initiated save is somewhere in the queue, so confirm it visibly. */
  private explicitSaveWanted = false;
  private lastSavedAt: number | null = null;
  private plain: Uint8Array | null = null;
  private meta: SealedMeta | null = null;
  private kind: ViewerKind = "none";
  private editing = false;
  private dirty = false;
  private autosaveTimer: number | null = null;
  private bodyEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private busy = false;

  constructor(leaf: WorkspaceLeaf, host: SealboxHost) {
    super(leaf);
    this.host = host;
  }

  override getViewType(): string {
    return SEALED_VIEW_TYPE;
  }

  override getIcon(): string {
    return this.plain ? "lock-open" : "lock";
  }

  override getDisplayText(): string {
    if (this.meta?.name) return this.meta.name;
    return this.file ? this.file.basename : t("view.sealedFile");
  }

  override async onOpen(): Promise<void> {
    this.unsubscribe = this.host.controller.session.onChange((state) => {
      if (state === "locked") {
        // Not a redraw: an unconditional wipe. This runs from the idle timer and
        // from the user's explicit "lock now".
        this.discardPlaintext();
        if (this.file) this.renderLocked(this.file);
      } else if (this.file && !this.plain) {
        runQuietly("open payload after unlock", () => this.openPayload(this.file!));
      }
    });
  }

  override async onClose(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.discardPlaintext();
  }

  override async onLoadFile(file: TFile): Promise<void> {
    this.discardPlaintext();
    if (this.host.controller.isUnlocked) {
      await this.openPayload(file);
    } else {
      this.renderLocked(file);
    }
  }

  override async onUnloadFile(_file: TFile): Promise<void> {
    // Obsidian awaits this before opening the next file, so nothing here may
    // reject: that would cancel the navigation and trap the user in this tab.
    try {
      // Flush before clearing, otherwise switching files in the same leaf
      // silently drops the last couple of seconds of typing.
      if (this.dirty) await this.save();
    } catch (e) {
      log.warn("could not flush before leaving the file", e);
    }
    this.discardPlaintext();
  }

  /**
   * Drop every trace of decrypted content. Safe to call repeatedly.
   *
   * Every step is isolated, because this one method carries two jobs that must
   * not be able to break each other: it is what wipes plaintext when the vault
   * locks, and it is what Obsidian awaits when you switch away from this file.
   * A viewer that threw on teardown used to take both down with it — the
   * decrypted payload stayed on screen after locking, and the tab could not be
   * left at all.
   */
  private discardPlaintext(): void {
    if (this.autosaveTimer !== null) {
      window.clearTimeout(this.autosaveTimer);
      this.autosaveTimer = null;
    }

    const viewer = this.viewer;
    this.viewer = null;
    try {
      viewer?.destroy();
    } catch (e) {
      log.warn("a viewer failed to tear down", e);
    }

    const editor = this.editor;
    this.editor = null;
    try {
      editor?.destroy();
    } catch (e) {
      log.warn("the editor failed to tear down", e);
    }

    // The wipe itself, which must happen whatever the viewer did.
    zero(this.plain);
    this.plain = null;
    this.meta = null;
    this.editing = false;
    this.dirty = false;
    // Per-file save state: a leftover "saved at 14:32" would otherwise be shown
    // against the next file opened in this leaf.
    this.explicitSaveWanted = false;
    this.lastSavedAt = null;
    this.bodyEl = null;
    this.statusEl = null;
    try {
      this.contentEl.empty();
    } catch (e) {
      log.warn("could not clear the view", e);
    }
  }

  private renderLocked(file: TFile): void {
    this.contentEl.empty();
    const wrap = this.contentEl.createDiv({ cls: "sealbox-locked" });
    wrap.createDiv({ cls: "sealbox-locked-icon", text: "🔒" });
    wrap.createEl("h2", { text: file.basename });
    wrap.createEl("p", {
      cls: "sealbox-muted",
      text: t("view.lockedSubtitle", { size: formatBytes(file.stat.size) }),
    });

    const buttons = wrap.createDiv({ cls: "sealbox-buttons" });
    const unlock = buttons.createEl("button", { text: t("common.unlock"), cls: "mod-cta" });
    unlock.addEventListener("click", () =>
      runAction("unlock sealed file", () => this.unlockAndOpen(file)),
    );
    // Available while still locked: a link is not a secret, and wanting to
    // reference a file is no reason to have to open it.
    const copyLocked = buttons.createEl("button", { text: t("view.copyLink") });
    copyLocked.addEventListener("click", () =>
      runAction("copy file link", () => copyFileLink(this.app, file)),
    );

    wrap.createEl("p", {
      cls: "sealbox-muted sealbox-small",
      text: t("view.noPassword", {
        command: `Sealbox: ${t("command.recoverAccess")}`,
      }),
    });
  }

  private async unlockAndOpen(file: TFile): Promise<void> {
    const key = await this.host.controller.ensureUnlocked();
    if (!key) return;
    await this.openPayload(file);
  }

  private async openPayload(file: TFile): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const { meta, data } = await this.host.ops.readSealed(file);
      this.meta = meta;
      this.plain = data;
      this.kind = viewerFor(meta.mime, meta.name);
      await this.renderUnlocked();
    } catch (e) {
      log.warn("could not open a sealed file", e);
      this.renderError(file, userMessage(e));
    } finally {
      this.busy = false;
    }
  }

  private renderError(file: TFile, message: string): void {
    this.contentEl.empty();
    const wrap = this.contentEl.createDiv({ cls: "sealbox-locked" });
    wrap.createDiv({ cls: "sealbox-locked-icon", text: "⚠️" });
    wrap.createEl("h2", { text: file.basename });
    wrap.createEl("p", { cls: "sealbox-error", text: message });
    const retry = wrap.createEl("button", { text: t("common.tryAgain"), cls: "mod-cta" });
    retry.addEventListener("click", () =>
      runAction("reopen sealed file", () => this.openPayload(file)),
    );
  }

  private async renderUnlocked(): Promise<void> {
    const meta = this.meta;
    const plain = this.plain;
    if (!meta || !plain) return;
    this.contentEl.empty();

    const header = this.contentEl.createDiv({ cls: "sealbox-header" });
    header.createSpan({ cls: "sealbox-header-name", text: meta.name });
    header.createSpan({
      cls: "sealbox-muted sealbox-small",
      text: t("view.meta", { mime: meta.mime, size: formatBytes(meta.size) }),
    });

    const actions = header.createDiv({ cls: "sealbox-header-actions" });
    this.statusEl = header.createSpan({ cls: "sealbox-status sealbox-small" });

    if (isEditable(this.kind)) {
      const toggle = actions.createEl("button", {
        text: this.editing ? t("common.preview") : t("common.edit"),
      });
      toggle.addEventListener("click", () =>
        runAction("toggle edit mode", () => this.setEditing(!this.editing)),
      );
      // Only while editing: in Preview there is no editor to read from, so the
      // button could not do anything, and a button that does nothing when
      // pressed is the worst thing to put in front of someone.
      if (this.editing) {
        const save = actions.createEl("button", {
          text: t("common.save"),
          cls: "mod-cta",
        });
        save.addEventListener("click", () =>
          runAction("save sealed note", () => this.save(true)),
        );
      }
    }

    const copyLink = actions.createEl("button", { text: t("view.copyLink") });
    copyLink.addEventListener("click", () => {
      const current = this.file;
      if (current) runAction("copy file link", () => copyFileLink(this.app, current));
    });

    const lock = actions.createEl("button", { text: t("common.lock") });
    lock.addEventListener("click", () => this.host.controller.lock());

    this.refreshStatus();

    this.bodyEl = this.contentEl.createDiv({ cls: "sealbox-body" });
    await this.renderBody();
  }

  private async renderBody(): Promise<void> {
    const body = this.bodyEl;
    const meta = this.meta;
    const plain = this.plain;
    if (!body || !meta || !plain) return;
    this.viewer?.destroy();
    this.viewer = null;
    try {
      this.editor?.destroy();
    } catch (e) {
      log.warn("the editor failed to tear down", e);
    }
    this.editor = null;
    body.empty();

    switch (this.kind) {
      case "markdown":
      case "text":
        if (this.editing) {
          await this.renderEditor(body, plain);
        } else if (this.kind === "markdown") {
          await MarkdownRenderer.render(
            this.app,
            this.decodeText(plain),
            body.createDiv({ cls: "sealbox-markdown markdown-rendered" }),
            this.file?.path ?? "",
            this,
          );
        } else {
          body.createEl("pre", { cls: "sealbox-pre", text: this.decodeText(plain) });
        }
        return;

      case "image":
        this.viewer = renderImage(body, plain, meta.mime);
        return;

      case "pdf":
        {
          // Keep a reference to the placeholder: the PDF viewer's own toolbar also
          // carries .sealbox-muted, so re-querying for it would remove the wrong node.
          const placeholder = body.createEl("p", {
            cls: "sealbox-muted",
            text: t("view.renderingPdf"),
          });
          try {
            this.viewer = await renderPdf(body, plain);
            placeholder.remove();
          } catch (e) {
            placeholder.remove();
            log.warn("the PDF viewer failed to start", e);
            body.empty();
            body.createEl("p", {
              cls: "sealbox-error",
              text: t("view.pdfFailed", { error: userMessage(e) }),
            });
            body.createEl("p", {
              cls: "sealbox-muted sealbox-small",
              text: t("view.pdfDiagnosticsHint", {
                command: `Sealbox: ${t("command.diagnostics")}`,
              }),
            });
          }
        }
        return;

      default:
        body.createEl("p", {
          cls: "sealbox-muted",
          text: t("view.noViewer", {
            mime: meta.mime,
            command: `Sealbox: ${t("command.decryptPermanently")}`,
          }),
        });
    }
  }

  private decodeText(bytes: Uint8Array): string {
    try {
      return fromUtf8(bytes);
    } catch {
      return t("view.notUtf8");
    }
  }

  private async renderEditor(parent: HTMLElement, plain: Uint8Array): Promise<void> {
    this.editor = await createEditor(
      parent,
      {
        initialValue: this.decodeText(plain),
        markdown: this.kind === "markdown",
        onChange: () => {
          this.dirty = true;
          this.refreshStatus();
          this.host.controller.session.touch();
          this.scheduleAutosave();
        },
        onSave: () => runQuietly("save on Ctrl-S", () => this.save(true)),
        onBlur: () => {
          if (this.dirty) runQuietly("autosave on blur", () => this.save());
        },
      },
      { rich: this.host.settings.richEditor },
    );
    this.editor.focus();
  }

  private scheduleAutosave(): void {
    if (this.autosaveTimer !== null) window.clearTimeout(this.autosaveTimer);
    this.autosaveTimer = window.setTimeout(() => {
      this.autosaveTimer = null;
      if (this.dirty) runQuietly("autosave", () => this.save());
    }, AUTOSAVE_DELAY_MS);
  }

  private async setEditing(editing: boolean): Promise<void> {
    // Wait for the whole queue, not just for `dirty`: a blur fires its own save
    // a moment before this runs, and flipping the mode underneath it is what
    // used to leave Preview showing stale unsaved changes.
    if (this.dirty || this.saves.hasWork) await this.save();
    if (this.autosaveTimer !== null) {
      window.clearTimeout(this.autosaveTimer);
      this.autosaveTimer = null;
    }
    this.editing = editing;
    await this.renderUnlocked();
  }

  /**
   * Show what is actually true, derived from state rather than set by hand.
   *
   * The old version wrote "saved" and then whatever came next wrote over it, so
   * the line could claim unsaved changes right after a successful write. The
   * timestamp is the part that answers "did it save?" — a bare "saved" does not
   * tell you *when*, so it is indistinguishable from a leftover message.
   */
  private refreshStatus(): void {
    const el = this.statusEl;
    if (!el) return;
    if (this.saves.isRunning) {
      el.setText(t("view.status.saving"));
    } else if (this.dirty) {
      el.setText(t("view.status.unsaved"));
    } else if (this.lastSavedAt !== null) {
      el.setText(
        t("view.status.savedAt", {
          time: new Date(this.lastSavedAt).toLocaleTimeString(),
        }),
      );
    } else {
      el.setText("");
    }
  }

  /**
   * Re-encrypt the editor contents into the same container.
   *
   * @param explicit the user asked for this save, so confirm it visibly
   */
  private async save(explicit = false): Promise<void> {
    // Remembered across the queue, so a Ctrl-S arriving while an autosave is in
    // flight still gets its visible confirmation.
    if (explicit) this.explicitSaveWanted = true;
    const done = this.saves.request();
    this.refreshStatus();
    try {
      await done;
    } finally {
      this.refreshStatus();
    }
  }

  private async writeOnce(): Promise<void> {
    const file = this.file;
    const meta = this.meta;
    const editor = this.editor;
    // The precondition is "there is an editor holding text", not "the view is in
    // edit mode". A queued follow-up write can run just after the user switched
    // to Preview; bailing on the mode flag there left `dirty` set for a note
    // that was in fact saved, so Preview claimed unsaved changes forever.
    if (!file || !meta || !editor) return;

    const explicit = this.explicitSaveWanted;
    this.explicitSaveWanted = false;
    const text = editor.getValue();
    const bytes = utf8(text);
    try {
      await this.host.ops.writeSealedToFile(file, bytes, { ...meta, mtime: Date.now() });
      zero(this.plain);
      this.plain = bytes;
      this.meta = { ...meta, size: bytes.length, mtime: Date.now() };
      this.lastSavedAt = Date.now();

      // Typing during the write must not be reported as saved; queue another pass.
      if (editor.getValue() === text) {
        this.dirty = false;
      } else {
        this.saves.requestAnother();
      }
      if (explicit && !this.dirty) new Notice(t("view.savedNotice"), 2000);
    } catch (e) {
      // Leave `dirty` set: the text is still in the editor, so the next autosave
      // or an explicit retry can still succeed.
      log.error("could not save a sealed note", e);
      new Notice(t("view.saveFailed", { error: userMessage(e) }), 10000);
      throw e;
    }
  }
}
