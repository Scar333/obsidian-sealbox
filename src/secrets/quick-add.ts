/**
 * Quick add: one click from the sidebar to a filled-in entry.
 *
 * The secrets window is for browsing and editing what you already have. Adding
 * a new login is a different, far more frequent action, and routing it through
 * "open the window, press New, pick a template, find the form" is three clicks
 * of navigation before any typing. This is the same form with none of that.
 */

import { App, Modal, Notice } from "obsidian";
import { t, type MessageKey } from "../i18n/index.ts";
import type { SealboxHost } from "../host.ts";
import { log, userMessage } from "../log.ts";
import { runAction } from "../ui/run.ts";
import { renderEntryForm, type EntryForm } from "./entry-form.ts";
import {
  DEFAULT_GENERATOR,
  entryFromTemplate,
  generatePassword,
  touchEntry,
  upsert,
  type SecretEntry,
  type SecretTemplateId,
} from "./model.ts";
import type { SecretsStore } from "./store.ts";
import { askTemplate, templateName } from "./template-modal.ts";

class QuickAddModal extends Modal {
  private form: EntryForm | null = null;
  private unsubscribe: (() => void) | null = null;
  private readonly draft: SecretEntry;

  constructor(
    app: App,
    private host: SealboxHost,
    private store: SecretsStore,
    template: SecretTemplateId,
  ) {
    super(app);
    this.draft = entryFromTemplate(template);
    this.draft.password = generatePassword(DEFAULT_GENERATOR);
    // Template labels are stored as keys and become ordinary text here, so
    // renaming one later is editing your own data rather than a translation.
    this.draft.extra = this.draft.extra.map((field) => ({
      ...field,
      label: t(`secrets.label.${field.label}` as MessageKey),
    }));
  }

  override onOpen(): void {
    this.modalEl.addClass("sealbox-secrets-modal");
    const { contentEl } = this;
    contentEl.addClass("sealbox-modal");

    this.unsubscribe = this.host.controller.session.onChange((state) => {
      if (state === "locked") {
        new Notice(t("secrets.lockedClosed"));
        this.close();
      }
    });

    contentEl.createEl("h3", {
      text: t("quickAdd.title", { template: templateName(this.draft.template) }),
    });
    const body = contentEl.createDiv({ cls: "sealbox-quickadd-body" });
    this.form = renderEntryForm(body, this.draft, {
      clipboardClearSeconds: this.host.settings.clipboardClearSeconds,
      generator: DEFAULT_GENERATOR,
    });

    const buttons = contentEl.createDiv({ cls: "sealbox-buttons" });
    const save = buttons.createEl("button", { text: t("common.save"), cls: "mod-cta" });
    save.addEventListener("click", () => runAction("quick add secret", () => this.save()));
    const cancel = buttons.createEl("button", { text: t("common.cancel") });
    cancel.addEventListener("click", () => this.close());

    this.form.focusFirst();
  }

  private async save(): Promise<void> {
    const form = this.form;
    if (!form) return;
    const changes = form.read();
    try {
      const db = await this.store.load();
      const entry = touchEntry(this.draft, changes);
      await this.store.save(upsert(db, entry));
      new Notice(
        t("quickAdd.saved", { title: entry.title || t("common.untitled") }),
        5000,
      );
      this.close();
    } catch (e) {
      log.error("could not save a quick-added secret", e);
      new Notice(t("secrets.saveFailed", { error: userMessage(e) }), 10000);
    }
  }

  override onClose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    // Clear the fields before the DOM goes, so nothing holds a password in a
    // detached node.
    for (const el of Array.from(this.contentEl.querySelectorAll("input, textarea"))) {
      if (el.instanceOf(HTMLInputElement) || el.instanceOf(HTMLTextAreaElement)) {
        el.value = "";
      }
    }
    this.contentEl.empty();
    this.form = null;
  }
}

/** Unlock if needed, ask what kind of entry, then open the form. */
export async function quickAddSecret(
  app: App,
  host: SealboxHost,
  store: SecretsStore,
): Promise<void> {
  if (!(await host.controller.ensureUnlocked())) return;
  const template = await askTemplate(app);
  if (!template) return;
  new QuickAddModal(app, host, store, template).open();
}
