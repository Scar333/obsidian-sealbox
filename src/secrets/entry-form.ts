/**
 * The entry form.
 *
 * Shared by the secrets window's detail pane and the quick-add dialog, so there
 * is one definition of what an entry looks like and how its fields behave. The
 * form edits copies and only hands values back when asked, which is what lets a
 * caller abandon a dialog without touching anything stored.
 */

import { Notice } from "obsidian";
import { t } from "../i18n/index.ts";
import { copyWithAutoClear } from "./clipboard.ts";
import {
  entropyBits,
  generatePassword,
  UNGROUPED,
  type GeneratorOptions,
  type SecretEntry,
  type SecretField,
} from "./model.ts";

export interface EntryFormDeps {
  /** Seconds before a copied secret is cleared; 0 disables. */
  clipboardClearSeconds: number;
  generator: GeneratorOptions;
}

export interface EntryForm {
  /** The current values, shaped for `touchEntry`. */
  read(): Partial<SecretEntry>;
  focusFirst(): void;
}

export function renderEntryForm(
  parent: HTMLElement,
  entry: SecretEntry,
  deps: EntryFormDeps,
): EntryForm {
  const form = parent.createDiv({ cls: "sealbox-form" });

  const titleInput = textField(form, t("secrets.field.title"), entry.title);
  const groupInput = textField(form, t("secrets.field.group"), entry.group || UNGROUPED);
  const userInput = textField(form, t("secrets.field.username"), entry.username);

  // Password: masked by default, with reveal, copy and generate beside it.
  const pwWrap = form.createEl("label", { cls: "sealbox-field" });
  pwWrap.createSpan({ text: t("secrets.field.password") });
  const pwRow = pwWrap.createDiv({ cls: "sealbox-field-row" });
  const pwInput = pwRow.createEl("input", { type: "password" });
  pwInput.value = entry.password;
  pwInput.setAttribute("autocomplete", "off");
  const revealButton = pwRow.createEl("button", { text: t("common.show") });
  revealButton.addEventListener("click", () => {
    const showing = pwInput.type === "text";
    pwInput.type = showing ? "password" : "text";
    revealButton.setText(showing ? t("common.show") : t("common.hide"));
  });
  const copyButton = pwRow.createEl("button", { text: t("common.copy") });
  copyButton.addEventListener("click", () => {
    void copyWithAutoClear(pwInput.value, deps.clipboardClearSeconds);
  });
  const genButton = pwRow.createEl("button", { text: t("common.generate") });
  genButton.addEventListener("click", () => {
    pwInput.value = generatePassword(deps.generator);
    pwInput.type = "text";
    revealButton.setText(t("common.hide"));
  });
  pwWrap.createDiv({
    cls: "sealbox-muted sealbox-small",
    text: t("secrets.generatorInfo", {
      length: deps.generator.length,
      bits: entropyBits(deps.generator),
    }),
  });

  const copyUserRow = form.createDiv({ cls: "sealbox-buttons" });
  const copyUser = copyUserRow.createEl("button", { text: t("secrets.copyUsername") });
  copyUser.addEventListener("click", () => {
    void copyWithAutoClear(userInput.value, deps.clipboardClearSeconds);
  });

  // --- links ---------------------------------------------------------------
  // Local copies, written back only when `read` is called.
  const urls = [...entry.urls];
  form.createDiv({ cls: "sealbox-section-title", text: t("secrets.field.links") });
  const linksEl = form.createDiv({ cls: "sealbox-field-list" });
  const renderLinks = () => {
    linksEl.empty();
    if (urls.length === 0) {
      linksEl.createDiv({
        cls: "sealbox-muted sealbox-small",
        text: t("secrets.field.noLinks"),
      });
    }
    urls.forEach((url, index) => {
      const row = linksEl.createDiv({ cls: "sealbox-field-row" });
      const input = row.createEl("input", { type: "text" });
      input.value = url;
      input.setAttribute("autocomplete", "off");
      input.spellcheck = false;
      input.addEventListener("input", () => {
        urls[index] = input.value;
      });
      const open = row.createEl("button", { text: t("secrets.open") });
      open.addEventListener("click", () => {
        const value = input.value.trim();
        if (!/^https?:\/\//i.test(value)) {
          new Notice(t("secrets.onlyHttp"));
          return;
        }
        window.open(value, "_blank");
      });
      const copy = row.createEl("button", { text: t("common.copy") });
      copy.addEventListener("click", () => {
        void copyWithAutoClear(input.value, 0);
      });
      const remove = row.createEl("button", { text: t("secrets.remove") });
      remove.addEventListener("click", () => {
        urls.splice(index, 1);
        renderLinks();
      });
    });
    const add = linksEl.createEl("button", {
      text: t("secrets.field.addLink"),
      cls: "sealbox-add-field",
    });
    add.addEventListener("click", () => {
      urls.push("");
      renderLinks();
    });
  };
  renderLinks();

  // --- extra fields --------------------------------------------------------
  const extra: SecretField[] = entry.extra.map((field) => ({ ...field }));
  form.createDiv({ cls: "sealbox-section-title", text: t("secrets.field.extra") });
  const extraEl = form.createDiv({ cls: "sealbox-field-list" });
  const renderExtra = () => {
    extraEl.empty();
    extra.forEach((field, index) => {
      const row = extraEl.createDiv({ cls: "sealbox-field-row" });
      const labelInput = row.createEl("input", { type: "text" });
      labelInput.value = field.label;
      labelInput.placeholder = t("secrets.field.labelPlaceholder");
      labelInput.addClass("sealbox-field-label");
      labelInput.addEventListener("input", () => {
        field.label = labelInput.value;
      });

      const valueInput = row.createEl("input", {
        type: field.secret ? "password" : "text",
      });
      valueInput.value = field.value;
      valueInput.placeholder = t("secrets.field.valuePlaceholder");
      valueInput.setAttribute("autocomplete", "off");
      valueInput.addEventListener("input", () => {
        field.value = valueInput.value;
      });

      const mask = row.createEl("button", { text: t("secrets.field.secretToggle") });
      mask.toggleClass("is-active", field.secret);
      mask.addEventListener("click", () => {
        field.secret = !field.secret;
        valueInput.type = field.secret ? "password" : "text";
        mask.toggleClass("is-active", field.secret);
      });
      const copy = row.createEl("button", { text: t("common.copy") });
      copy.addEventListener("click", () => {
        void copyWithAutoClear(
          valueInput.value,
          field.secret ? deps.clipboardClearSeconds : 0,
        );
      });
      const remove = row.createEl("button", { text: t("secrets.remove") });
      remove.addEventListener("click", () => {
        extra.splice(index, 1);
        renderExtra();
      });
    });
    const add = extraEl.createEl("button", {
      text: t("secrets.field.addExtra"),
      cls: "sealbox-add-field",
    });
    add.addEventListener("click", () => {
      extra.push({ label: "", value: "", secret: false });
      renderExtra();
    });
  };
  renderExtra();

  const tagsInput = textField(form, t("secrets.field.tags"), entry.tags.join(", "));

  const noteWrap = form.createEl("label", { cls: "sealbox-field" });
  noteWrap.createSpan({ text: t("secrets.field.note") });
  const noteInput = noteWrap.createEl("textarea", { cls: "sealbox-note" });
  noteInput.value = entry.note;

  return {
    read: () => ({
      title: titleInput.value.trim(),
      group: groupInput.value.trim() || UNGROUPED,
      username: userInput.value,
      password: pwInput.value,
      urls: urls.map((u) => u.trim()).filter((u) => u.length > 0),
      extra: extra.filter((f) => f.label.trim().length > 0 || f.value.length > 0),
      note: noteInput.value,
      tags: tagsInput.value
        .split(",")
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0),
    }),
    focusFirst: () => titleInput.focus(),
  };
}

function textField(parent: HTMLElement, label: string, value: string): HTMLInputElement {
  const wrap = parent.createEl("label", { cls: "sealbox-field" });
  wrap.createSpan({ text: label });
  const input = wrap.createEl("input", { type: "text" });
  input.value = value;
  input.setAttribute("autocomplete", "off");
  input.spellcheck = false;
  return input;
}
