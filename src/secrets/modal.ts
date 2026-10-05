/**
 * The secrets window: groups | entries | details.
 *
 * Everything shown here was decrypted into memory by `SecretsStore`. The modal
 * closes itself if the vault locks while it is open, and clears its own fields on
 * the way out.
 */

import { App, Modal, Notice, Platform } from "obsidian";
import type { SealboxHost } from "../host.ts";
import { log, userMessage } from "../log.ts";
import { copyWithAutoClear } from "./clipboard.ts";
import { confirmAction } from "../ui/confirm.ts";
import { runAction, runQuietly } from "../ui/run.ts";
import { t } from "../i18n/index.ts";
import { askTemplate, templateName } from "./template-modal.ts";
import { renderEntryForm } from "./entry-form.ts";
import type { MessageKey } from "../i18n/index.ts";
import {
  DEFAULT_GENERATOR,
  entryFromTemplate,
  generatePassword,
  groupsOf,
  remove,
  search,
  touchEntry,
  UNGROUPED,
  upsert,
  type GeneratorOptions,
  type SecretEntry,
  type SecretsDb,
} from "./model.ts";
import type { SecretsStore } from "./store.ts";

/** The stored group name stays "Ungrouped"; only its label is translated. */
function groupLabel(group: string): string {
  return group === UNGROUPED ? t("secrets.ungrouped") : group;
}

export class SecretsModal extends Modal {
  private db: SecretsDb | null = null;
  private query = "";
  private group: string | null = null;
  private selectedId: string | null = null;
  private unsubscribe: (() => void) | null = null;
  private generator: GeneratorOptions = { ...DEFAULT_GENERATOR };
  private pane: "groups" | "list" | "detail" = "list";

  private groupsEl!: HTMLElement;
  private listEl!: HTMLElement;
  private detailEl!: HTMLElement;

  constructor(
    app: App,
    private host: SealboxHost,
    private store: SecretsStore,
    private focusId?: string,
  ) {
    super(app);
  }

  override async onOpen(): Promise<void> {
    this.modalEl.addClass("sealbox-secrets-modal");
    this.unsubscribe = this.host.controller.session.onChange((state) => {
      if (state === "locked") {
        new Notice(t("secrets.lockedClosed"));
        this.close();
      }
    });

    try {
      this.db = await this.store.load();
    } catch (e) {
      this.contentEl.createEl("p", { cls: "sealbox-error", text: userMessage(e) });
      return;
    }
    if (this.focusId) this.selectedId = this.focusId;
    this.buildFrame();
    this.renderAll();
  }

  override onClose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    // Clear fields before the DOM goes away, so no input keeps a password in a
    // detached node that is still reachable from a stale reference.
    for (const input of Array.from(this.contentEl.querySelectorAll("input, textarea"))) {
      if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) {
        input.value = "";
      }
    }
    this.contentEl.empty();
    this.db = null;
  }

  private buildFrame(): void {
    const { contentEl } = this;
    contentEl.empty();

    const top = contentEl.createDiv({ cls: "sealbox-secrets-top" });
    const searchInput = top.createEl("input", {
      cls: "sealbox-search",
      type: "search",
      placeholder: t("secrets.searchPlaceholder"),
    });
    searchInput.addEventListener("input", () => {
      this.query = searchInput.value;
      this.host.controller.session.touch();
      this.renderList();
    });
    const addButton = top.createEl("button", { text: t("common.new"), cls: "mod-cta" });
    addButton.addEventListener("click", () =>
      runAction("create secret", () => this.createEntry()),
    );

    const panes = contentEl.createDiv({ cls: "sealbox-secrets-panes" });
    if (Platform.isMobile) panes.addClass("is-mobile");
    this.groupsEl = panes.createDiv({ cls: "sealbox-pane sealbox-pane-groups" });
    this.listEl = panes.createDiv({ cls: "sealbox-pane sealbox-pane-list" });
    this.detailEl = panes.createDiv({ cls: "sealbox-pane sealbox-pane-detail" });
    this.applyPane();
  }

  /** On a phone the three panes become one at a time. */
  private applyPane(): void {
    if (!Platform.isMobile) return;
    for (const [name, el] of [
      ["groups", this.groupsEl],
      ["list", this.listEl],
      ["detail", this.detailEl],
    ] as const) {
      el.toggleClass("is-active", this.pane === name);
    }
  }

  private renderAll(): void {
    this.renderGroups();
    this.renderList();
    this.renderDetail();
  }

  private renderGroups(): void {
    const db = this.db;
    if (!db) return;
    this.groupsEl.empty();
    this.groupsEl.createEl("div", { cls: "sealbox-pane-title", text: t("secrets.groups") });

    const makeRow = (label: string, value: string | null, count: number) => {
      const row = this.groupsEl.createDiv({ cls: "sealbox-row" });
      row.toggleClass("is-selected", this.group === value);
      row.createEl("span", { text: label });
      row.createEl("span", { cls: "sealbox-count", text: String(count) });
      row.addEventListener("click", () => {
        this.group = value;
        this.pane = "list";
        this.applyPane();
        this.renderGroups();
        this.renderList();
      });
    };

    makeRow(t("secrets.all"), null, db.entries.length);
    for (const g of groupsOf(db)) {
      makeRow(groupLabel(g), g, db.entries.filter((e) => (e.group || UNGROUPED) === g).length);
    }
  }

  private renderList(): void {
    const db = this.db;
    if (!db) return;
    this.listEl.empty();
    const header = this.listEl.createDiv({ cls: "sealbox-pane-title" });
    header.setText(this.group === null ? t("secrets.allEntries") : groupLabel(this.group));
    if (Platform.isMobile) {
      const back = this.listEl.createEl("button", {
        text: t("secrets.backGroups"),
        cls: "sealbox-back",
      });
      back.addEventListener("click", () => {
        this.pane = "groups";
        this.applyPane();
      });
    }

    const results = search(db, this.query, this.group);
    if (results.length === 0) {
      this.listEl.createEl("p", {
        cls: "sealbox-muted",
        text: db.entries.length === 0 ? t("secrets.empty") : t("secrets.noMatch"),
      });
      return;
    }

    for (const entry of results) {
      const row = this.listEl.createDiv({ cls: "sealbox-card" });
      row.toggleClass("is-selected", entry.id === this.selectedId);
      row.createEl("div", {
        cls: "sealbox-card-title",
        text: entry.title || t("common.untitled"),
      });
      // A short preview of what is inside, so the list is scannable without
      // opening every entry in turn.
      const line = (label: string, value: string) => {
        if (!value) return;
        const el = row.createEl("div", { cls: "sealbox-card-line sealbox-small" });
        el.createEl("span", { cls: "sealbox-card-label", text: `${label}: ` });
        el.createEl("span", { text: value });
      };
      line(t("secrets.field.username"), entry.username);
      line(t("secrets.field.url"), entry.urls[0] ?? "");
      line(t("secrets.field.note"), entry.note.split("\n")[0] ?? "");
      const chips = row.createDiv({ cls: "sealbox-card-chips" });
      chips.createEl("span", {
        cls: "sealbox-chip-static",
        text: groupLabel(entry.group || UNGROUPED),
      });
      if (entry.template !== "custom") {
        chips.createEl("span", {
          cls: "sealbox-chip-static",
          text: templateName(entry.template),
        });
      }
      row.addEventListener("click", () => {
        this.selectedId = entry.id;
        this.pane = "detail";
        this.applyPane();
        this.renderList();
        this.renderDetail();
      });
    }
  }

  private selected(): SecretEntry | null {
    if (!this.db || !this.selectedId) return null;
    return this.db.entries.find((e) => e.id === this.selectedId) ?? null;
  }

  private renderDetail(): void {
    this.detailEl.empty();
    const entry = this.selected();
    if (!entry) {
      this.detailEl.createEl("p", {
        cls: "sealbox-muted",
        text: t("secrets.selectEntry"),
      });
      return;
    }

    if (Platform.isMobile) {
      const back = this.detailEl.createEl("button", {
        text: t("secrets.backEntries"),
        cls: "sealbox-back",
      });
      back.addEventListener("click", () => {
        this.pane = "list";
        this.applyPane();
      });
    }

    const form = renderEntryForm(this.detailEl, entry, {
      clipboardClearSeconds: this.host.settings.clipboardClearSeconds,
      generator: this.generator,
    });

    if (entry.history.length > 0) {
      const details = this.detailEl.createEl("details", { cls: "sealbox-history" });
      details.createEl("summary", {
        text: t("secrets.history", { count: entry.history.length }),
      });
      for (const item of entry.history) {
        const row = details.createDiv({ cls: "sealbox-row" });
        row.createEl("span", {
          cls: "sealbox-small",
          text: new Date(item.replaced).toLocaleString(),
        });
        const copyOld = row.createEl("button", { text: t("common.copy") });
        copyOld.addEventListener("click", () => {
          void copyWithAutoClear(item.password, this.host.settings.clipboardClearSeconds);
        });
      }
    }

    this.detailEl.createEl("div", {
      cls: "sealbox-muted sealbox-small",
      text: t("secrets.timestamps", {
        created: new Date(entry.created).toLocaleString(),
        updated: new Date(entry.updated).toLocaleString(),
      }),
    });

    const buttons = this.detailEl.createDiv({ cls: "sealbox-buttons" });
    const save = buttons.createEl("button", { text: t("common.save"), cls: "mod-cta" });
    save.addEventListener("click", () =>
      runAction("save secret", () =>
        this.commit(entry, form.read()),
      ),
    );
    const del = buttons.createEl("button", { text: t("common.delete"), cls: "mod-warning" });
    del.addEventListener("click", () =>
      runAction("delete secret", () => this.deleteEntry(entry)),
    );

    const linkButton = buttons.createEl("button", { text: t("secrets.copyLink") });
    linkButton.addEventListener("click", () =>
      // A link carries no secret, so it goes to the clipboard directly rather
      // than through the password path with its auto-clear messaging.
      runQuietly("copy entry link", async () => {
        try {
          await navigator.clipboard.writeText(`[[sealbox:${entry.id}]]`);
          new Notice(t("secrets.linkCopied"));
        } catch {
          new Notice(t("secrets.clipboardUnavailable"));
        }
      }),
    );
  }


  private async createEntry(): Promise<void> {
    if (!this.db) return;
    const template = await askTemplate(this.app);
    if (!template) return;

    const entry = entryFromTemplate(template);
    entry.title = t("secrets.newEntryTitle");
    entry.group = this.group ?? UNGROUPED;
    entry.password = generatePassword(this.generator);
    // The template stores label *keys*; they become ordinary text the moment the
    // entry exists, so renaming one later is just editing your own data and a
    // language change never rewrites what you typed.
    entry.extra = entry.extra.map((field) => ({
      ...field,
      label: t(`secrets.label.${field.label}` as MessageKey),
    }));
    this.db = upsert(this.db, entry);
    this.selectedId = entry.id;
    this.pane = "detail";
    await this.persist();
    this.applyPane();
    this.renderAll();
  }

  private async commit(entry: SecretEntry, changes: Partial<SecretEntry>): Promise<void> {
    if (!this.db) return;
    this.db = upsert(this.db, touchEntry(entry, changes));
    await this.persist();
    this.renderAll();
    new Notice(t("secrets.saved"));
  }

  private async deleteEntry(entry: SecretEntry): Promise<void> {
    if (!this.db) return;
    const ok = await confirmAction(this.app, {
      title: t("secrets.delete.title"),
      body: t("secrets.delete.body", { title: entry.title || t("common.untitled") }),
      warning: t("secrets.delete.warning"),
      confirmLabel: t("common.delete"),
      destructive: true,
    });
    if (!ok) return;
    this.db = remove(this.db, entry.id);
    this.selectedId = null;
    this.pane = "list";
    await this.persist();
    this.applyPane();
    this.renderAll();
  }

  private async persist(): Promise<void> {
    if (!this.db) return;
    try {
      await this.store.save(this.db);
    } catch (e) {
      log.error("could not save the secrets database", e);
      new Notice(t("secrets.saveFailed", { error: userMessage(e) }), 10000);
    }
  }
}
