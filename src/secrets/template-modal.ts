/**
 * Picking what kind of entry to create.
 *
 * The template only decides which fields a new entry starts with and what they
 * are called — the stored shape is identical for all of them. That keeps the
 * encrypted database one schema rather than four, so a template can be added or
 * renamed later without touching anything already saved.
 */

import { App, Modal } from "obsidian";
import { t, type MessageKey } from "../i18n/index.ts";
import { TEMPLATE_IDS, type SecretTemplateId } from "./model.ts";

const NAME_KEYS: Record<SecretTemplateId, MessageKey> = {
  site: "secrets.template.site",
  card: "secrets.template.card",
  server: "secrets.template.server",
  custom: "secrets.template.custom",
};

const DESC_KEYS: Record<SecretTemplateId, MessageKey> = {
  site: "secrets.template.siteDesc",
  card: "secrets.template.cardDesc",
  server: "secrets.template.serverDesc",
  custom: "secrets.template.customDesc",
};

export function templateName(template: SecretTemplateId): string {
  return t(NAME_KEYS[template]);
}

class TemplateModal extends Modal {
  private answered = false;

  constructor(
    app: App,
    private resolve: (template: SecretTemplateId | null) => void,
  ) {
    super(app);
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("sealbox-modal");
    contentEl.createEl("h3", { text: t("secrets.template.choose") });

    const list = contentEl.createDiv({ cls: "sealbox-template-list" });
    for (const template of TEMPLATE_IDS) {
      const card = list.createDiv({ cls: "sealbox-template" });
      card.createDiv({
        cls: "sealbox-template-name",
        text: templateName(template),
      });
      card.createDiv({
        cls: "sealbox-muted sealbox-small",
        text: t(DESC_KEYS[template]),
      });
      card.addEventListener("click", () => this.finish(template));
    }

    const buttons = contentEl.createDiv({ cls: "sealbox-buttons" });
    const cancel = buttons.createEl("button", { text: t("common.cancel") });
    cancel.addEventListener("click", () => this.finish(null));
  }

  private finish(template: SecretTemplateId | null): void {
    if (this.answered) return;
    this.answered = true;
    this.resolve(template);
    this.close();
  }

  override onClose(): void {
    this.contentEl.empty();
    if (!this.answered) {
      this.answered = true;
      this.resolve(null);
    }
  }
}

export function askTemplate(app: App): Promise<SecretTemplateId | null> {
  return new Promise((resolve) => new TemplateModal(app, resolve).open());
}
