/**
 * Confirmation dialog.
 *
 * Deliberately not `window.confirm`. Obsidian on Android runs inside a WebView
 * where the native blocking dialogs can be suppressed outright — a confirmation
 * that silently returns false would make a command look broken, and one that
 * silently returns true would be far worse for a destructive action.
 */

import { App, Modal } from "obsidian";
import { t } from "../i18n/index.ts";

export interface ConfirmRequest {
  title: string;
  body: string;
  /** Rendered in a warning colour under the body. */
  warning?: string;
  confirmLabel?: string;
  /** Style the confirm button as destructive. */
  destructive?: boolean;
}

class ConfirmModal extends Modal {
  private answered = false;

  constructor(
    app: App,
    private request: ConfirmRequest,
    private resolve: (ok: boolean) => void,
  ) {
    super(app);
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("sealbox-modal");
    contentEl.createEl("h3", { text: this.request.title });
    for (const paragraph of this.request.body.split("\n\n")) {
      contentEl.createEl("p", { text: paragraph });
    }
    if (this.request.warning) {
      contentEl.createEl("p", { cls: "sealbox-warning", text: this.request.warning });
    }

    const buttons = contentEl.createDiv({ cls: "sealbox-buttons" });
    const ok = buttons.createEl("button", {
      text: this.request.confirmLabel ?? t("common.continue"),
      cls: this.request.destructive ? "mod-warning" : "mod-cta",
    });
    ok.addEventListener("click", () => this.finish(true));
    const cancel = buttons.createEl("button", { text: t("common.cancel") });
    cancel.addEventListener("click", () => this.finish(false));
    // Cancel holds focus: nobody should confirm a destructive action by reflex.
    window.setTimeout(() => cancel.focus(), 0);
  }

  private finish(ok: boolean): void {
    if (this.answered) return;
    this.answered = true;
    this.resolve(ok);
    this.close();
  }

  override onClose(): void {
    this.contentEl.empty();
    if (!this.answered) {
      this.answered = true;
      this.resolve(false);
    }
  }
}

export function confirmAction(app: App, request: ConfirmRequest): Promise<boolean> {
  return new Promise((resolve) => new ConfirmModal(app, request, resolve).open());
}
