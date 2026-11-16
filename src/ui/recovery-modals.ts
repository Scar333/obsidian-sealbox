/**
 * Recovery-key screens.
 *
 * The confirmation step is not ceremony: a recovery key that was never actually
 * written down is worse than none, because it creates the belief that the vault
 * is recoverable when it is not. So the key has to be typed back before this
 * dialog will close.
 */

import { App, Modal, Notice } from "obsidian";
import { recoveryKeyMatches, parseRecoveryKey } from "../crypto/recovery.ts";
import { zero } from "../crypto/bytes.ts";
import type { SealboxHost } from "../host.ts";
import { t } from "../i18n/index.ts";
import { runAction, runQuietly } from "./run.ts";

export class ShowRecoveryKeyModal extends Modal {
  private confirmed = false;
  private closed = false;
  private expected: Uint8Array | null = null;
  private comparison = 0;

  constructor(
    app: App,
    private displayKey: string,
  ) {
    super(app);
  }

  override onOpen(): void {
    const { contentEl } = this;
    this.modalEl.addClass("sealbox-dialog");
    contentEl.addClass("sealbox-modal");
    contentEl.createEl("h3", { text: t("recovery.show.title") });
    contentEl.createEl("p", { text: t("recovery.show.body") });
    contentEl.createEl("p", { cls: "sealbox-warning", text: t("recovery.show.warning") });

    const keyEl = contentEl.createEl("pre", { cls: "sealbox-recovery-key", text: this.displayKey });
    keyEl.setAttribute("tabindex", "0");

    const copyRow = contentEl.createDiv({ cls: "sealbox-buttons" });
    const copyButton = copyRow.createEl("button", { text: t("common.copy") });
    copyButton.addEventListener("click", () =>
      runQuietly("copy recovery key", async () => {
        try {
          await navigator.clipboard.writeText(this.displayKey);
          new Notice(t("recovery.show.copied"));
        } catch {
          new Notice(t("recovery.show.copyFailed"));
        }
      }),
    );

    contentEl.createEl("p", {
      cls: "sealbox-muted sealbox-small",
      text: t("recovery.show.confirmPrompt"),
    });
    const input = contentEl.createEl("input", { type: "text", cls: "sealbox-recovery-input" });
    input.placeholder = t("recovery.placeholder");
    input.autocapitalize = "characters";
    input.spellcheck = false;

    const feedback = contentEl.createDiv({ cls: "sealbox-small" });
    const buttons = contentEl.createDiv({ cls: "sealbox-buttons" });
    const done = buttons.createEl("button", {
      text: t("recovery.show.done"),
      cls: "mod-cta",
    });
    done.disabled = true;

    runQuietly("parse generated recovery key", async () => {
      const expected = await parseRecoveryKey(this.displayKey);
      if (this.closed) { zero(expected); return; }
      this.expected = expected;
    });

    input.addEventListener("input", () => {
      runQuietly("compare recovery key", async () => {
        if (!this.expected || this.closed) return;
        const comparison = ++this.comparison;
        const value = input.value;
        const ok = await recoveryKeyMatches(value, this.expected);
        if (this.closed || comparison !== this.comparison || value !== input.value) return;
        done.disabled = !ok;
        feedback.setText(
          input.value.trim().length === 0
            ? ""
            : ok
              ? t("recovery.show.matches")
              : t("recovery.show.noMatch"),
        );
        feedback.toggleClass("sealbox-ok", ok);
      });
    });

    done.addEventListener("click", () => {
      this.confirmed = true;
      zero(this.expected);
      this.expected = null;
      this.close();
    });

    const later = buttons.createEl("button", { text: t("common.cancel") });
    later.addEventListener("click", () => {
      zero(this.expected);
      this.expected = null;
      this.close();
    });
  }

  override onClose(): void {
    this.closed = true;
    zero(this.expected);
    this.expected = null;
    this.displayKey = "";
    // Wipe the on-screen copy, and warn if the user never confirmed it.
    this.contentEl.empty();
    if (!this.confirmed) {
      new Notice(t("recovery.show.notConfirmed"), 12000);
    }
  }
}

export class EnterRecoveryKeyModal extends Modal {
  constructor(
    app: App,
    private host: SealboxHost,
    private mode: "unlock" | "reset",
  ) {
    super(app);
  }

  override onOpen(): void {
    const { contentEl } = this;
    this.modalEl.addClass("sealbox-dialog");
    contentEl.addClass("sealbox-modal");
    contentEl.createEl("h3", {
      text:
        this.mode === "reset"
          ? t("recovery.enter.resetTitle")
          : t("recovery.enter.unlockTitle"),
    });
    contentEl.createEl("p", {
      cls: "sealbox-muted",
      text:
        this.mode === "reset"
          ? t("recovery.enter.resetBody")
          : t("recovery.enter.unlockBody"),
    });

    const input = contentEl.createEl("textarea", { cls: "sealbox-recovery-input" });
    input.placeholder = t("recovery.placeholder");
    input.spellcheck = false;

    const buttons = contentEl.createDiv({ cls: "sealbox-buttons" });
    const go = buttons.createEl("button", {
      text:
        this.mode === "reset" ? t("recovery.enter.resetAction") : t("common.unlock"),
      cls: "mod-cta",
    });
    go.addEventListener("click", () =>
      runAction("use recovery key", async () => {
        const text = input.value;
        input.value = "";
        const ok =
          this.mode === "reset"
            ? await this.host.controller.resetPasswordWithRecovery(text)
            : await this.host.controller.unlockWithRecovery(text);
        if (ok) this.close();
      }),
    );
    const cancel = buttons.createEl("button", { text: t("common.cancel") });
    cancel.addEventListener("click", () => this.close());
  }

  override onClose(): void {
    for (const el of Array.from(this.contentEl.querySelectorAll("textarea, input"))) {
      if (el.instanceOf(HTMLTextAreaElement) || el.instanceOf(HTMLInputElement)) el.value = "";
    }
    this.contentEl.empty();
  }
}

/** Offline instructions remain available even when a browser is unavailable. */
export class RecoveryHelpModal extends Modal {
  constructor(app: App, private keyringPath: string) { super(app); }

  override onOpen(): void {
    this.modalEl.addClass("sealbox-dialog");
    this.setTitle(t("recovery.help.title"));
    this.contentEl.addClass("sealbox-modal");
    this.contentEl.createEl("p", { text: t("recovery.help.intro") });
    this.contentEl.createEl("p", { text: t("recovery.help.backup", { keyring: this.keyringPath }) });
    this.contentEl.createEl("p", { text: t("recovery.help.pack") });
    this.contentEl.createEl("pre", {
      cls: "sealbox-pre sealbox-recovery-command",
      text: 'node sealbox-decrypt.mjs "file.sealed" --keyring "keyring.json" --out "restored.bin"',
    });
    this.contentEl.createEl("p", { text: t("recovery.help.forgot") });
    this.contentEl.createEl("pre", {
      cls: "sealbox-pre sealbox-recovery-command",
      text: 'node sealbox-decrypt.mjs "file.sealed" --keyring "keyring.json" --recovery --out "restored.bin"',
    });
    this.contentEl.createEl("p", { cls: "sealbox-warning", text: t("recovery.help.warning") });
    const buttons = this.contentEl.createDiv({ cls: "sealbox-buttons" });
    buttons.createEl("button", { text: t("common.close") }).addEventListener("click", () => this.close());
  }

  override onClose(): void { this.contentEl.empty(); }
}
