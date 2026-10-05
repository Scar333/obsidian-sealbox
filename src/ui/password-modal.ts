/**
 * Password prompt.
 *
 * Returns the password as bytes, not as a string, so the caller can wipe it.
 * The `<input>` is cleared on close; the intermediate JS string cannot be wiped
 * (strings are immutable in JS) and will linger until it is garbage collected.
 * That residue is inside the threat model we accept: an attacker who can read
 * this process's heap has already won.
 */

import { App, Modal, Platform } from "obsidian";
import { estimateStrength } from "./strength.ts";
import { t } from "../i18n/index.ts";

export interface PasswordRequest {
  title: string;
  description?: string;
  /** Ask twice and require a match. Use when creating or changing a password. */
  confirm?: boolean;
  showStrength?: boolean;
  submitLabel?: string;
  /** Extra line rendered in a warning colour. */
  warning?: string;
}

class PasswordModal extends Modal {
  private resolved = false;
  private inputs: HTMLInputElement[] = [];

  constructor(
    app: App,
    private request: PasswordRequest,
    private resolve: (value: Uint8Array | null) => void,
  ) {
    super(app);
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("sealbox-modal");
    contentEl.createEl("h3", { text: this.request.title });
    if (this.request.description) {
      contentEl.createEl("p", {
        text: this.request.description,
        cls: "sealbox-muted",
      });
    }
    if (this.request.warning) {
      contentEl.createEl("p", { text: this.request.warning, cls: "sealbox-warning" });
    }

    const primary = this.addField(contentEl, t("password.field"));
    const second = this.request.confirm
      ? this.addField(contentEl, t("password.repeat"))
      : null;

    const strengthEl = this.request.showStrength
      ? contentEl.createEl("div", { cls: "sealbox-strength" })
      : null;
    const errorEl = contentEl.createEl("div", { cls: "sealbox-error" });
    errorEl.hide();

    const refresh = () => {
      if (strengthEl) {
        const report = estimateStrength(primary.value);
        strengthEl.setText(
          primary.value.length === 0
            ? ""
            : t("password.strength", { label: report.label, bits: report.bits }),
        );
        strengthEl.dataset.tone = report.tone;
      }
    };
    primary.addEventListener("input", refresh);

    const submit = () => {
      errorEl.hide();
      if (primary.value.length === 0) {
        errorEl.setText(t("password.enter"));
        errorEl.show();
        return;
      }
      if (second && second.value !== primary.value) {
        errorEl.setText(t("password.mismatch"));
        errorEl.show();
        return;
      }
      const bytes = new TextEncoder().encode(primary.value);
      this.finish(bytes);
    };

    for (const input of this.inputs) {
      input.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") {
          ev.preventDefault();
          submit();
        }
      });
    }

    const buttons = contentEl.createEl("div", { cls: "sealbox-buttons" });
    const ok = buttons.createEl("button", {
      text: this.request.submitLabel ?? t("common.unlock"),
      cls: "mod-cta",
    });
    ok.addEventListener("click", submit);
    const cancel = buttons.createEl("button", { text: t("common.cancel") });
    cancel.addEventListener("click", () => this.close());

    // On a phone the soft keyboard covers the dialog unless focus happens after
    // the modal has actually been laid out.
    window.setTimeout(() => primary.focus(), Platform.isMobile ? 250 : 0);
  }

  private addField(parent: HTMLElement, label: string): HTMLInputElement {
    const wrap = parent.createEl("label", { cls: "sealbox-field" });
    wrap.createEl("span", { text: label });
    const row = wrap.createEl("div", { cls: "sealbox-field-row" });
    const input = row.createEl("input", { type: "password" });
    input.autocapitalize = "off";
    input.spellcheck = false;
    input.setAttribute("autocomplete", "off");
    const reveal = row.createEl("button", { text: t("common.show"), cls: "sealbox-reveal" });
    reveal.setAttribute("type", "button");
    reveal.addEventListener("click", () => {
      const showing = input.type === "text";
      input.type = showing ? "password" : "text";
      reveal.setText(showing ? t("common.show") : t("common.hide"));
    });
    this.inputs.push(input);
    return input;
  }

  private finish(value: Uint8Array | null): void {
    if (this.resolved) return;
    this.resolved = true;
    this.resolve(value);
    this.close();
  }

  override onClose(): void {
    for (const input of this.inputs) input.value = "";
    this.contentEl.empty();
    if (!this.resolved) {
      this.resolved = true;
      this.resolve(null);
    }
  }
}

/** Resolves with the password as bytes, or `null` if the user cancelled. */
export function askPassword(
  app: App,
  request: PasswordRequest,
): Promise<Uint8Array | null> {
  return new Promise((resolve) => new PasswordModal(app, request, resolve).open());
}

export { estimateStrength };
