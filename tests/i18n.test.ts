/**
 * Tests for the dictionaries.
 *
 * Key completeness is already a compile error (`ru` is typed as
 * `Record<MessageKey, Message>`), so these cover what the type system cannot:
 * that the translations keep their placeholders and plural forms, and that the
 * Russian plural rule is actually the Russian one.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  en,
  ru,
  getCurrentLanguage,
  matchHostLanguage,
  setLanguage,
  t,
  type Message,
  type MessageKey,
} from "../src/i18n/index.ts";
import { resolveLanguage, DEFAULT_SETTINGS, normalizeSettings } from "../src/settings.ts";

function forms(message: Message): string[] {
  return typeof message === "string"
    ? [message]
    : [message.one, message.few, message.many].filter((f): f is string => f !== undefined);
}

function placeholders(message: Message): Set<string> {
  const found = new Set<string>();
  for (const form of forms(message)) {
    for (const match of form.matchAll(/\{(\w+)\}/g)) found.add(match[1]);
  }
  return found;
}

const keys = Object.keys(en) as MessageKey[];

test("the two dictionaries have exactly the same keys", () => {
  // The compiler enforces this, but a stray extra key in ru would only show up
  // here — and a silently unused translation is a sign of a renamed key.
  assert.deepEqual(Object.keys(ru).sort(), keys.slice().sort());
});

test("every Russian message keeps the English placeholders", () => {
  const mismatched: string[] = [];
  for (const key of keys) {
    const expected = placeholders(en[key]);
    const actual = placeholders(ru[key]);
    const missing = [...expected].filter((p) => !actual.has(p));
    const extra = [...actual].filter((p) => !expected.has(p));
    if (missing.length || extra.length) {
      mismatched.push(`${key}: missing ${missing.join(",") || "-"} / extra ${extra.join(",") || "-"}`);
    }
  }
  assert.deepEqual(mismatched, []);
});

test("no message is empty, and plural entries stay plural in both languages", () => {
  for (const key of keys) {
    for (const [lang, dict] of [["en", en], ["ru", ru]] as const) {
      for (const form of forms(dict[key])) {
        assert.ok(form.trim().length > 0, `${lang} ${key} is empty`);
      }
    }
    const enPlural = typeof en[key] !== "string";
    const ruPlural = typeof ru[key] !== "string";
    assert.equal(ruPlural, enPlural, `${key}: plural shape differs between languages`);
    // Russian needs a third form; a plural entry with only one/many would read
    // as "2 файлов".
    if (ruPlural) {
      const value = ru[key];
      assert.ok(
        typeof value !== "string" && typeof value.few === "string",
        `${key}: Russian plural needs a "few" form`,
      );
    }
  }
});

test("Russian plural selection follows the Russian rule", () => {
  setLanguage("ru");
  try {
    // 1 файл / 2 файла / 5 файлов, and the 11–14 exception.
    const cases: Array<[number, string]> = [
      [1, "Зашифрован 1 файл."],
      [2, "Зашифровано 2 файла."],
      [4, "Зашифровано 4 файла."],
      [5, "Зашифровано 5 файлов."],
      [11, "Зашифровано 11 файлов."],
      [14, "Зашифровано 14 файлов."],
      [21, "Зашифрован 21 файл."],
      [22, "Зашифровано 22 файла."],
      [25, "Зашифровано 25 файлов."],
      [100, "Зашифровано 100 файлов."],
      [101, "Зашифрован 101 файл."],
    ];
    for (const [count, expected] of cases) {
      assert.equal(t("ops.folderDone", { count }), expected, `count ${count}`);
    }
  } finally {
    setLanguage("en");
  }
});

test("English plural selection is one/other", () => {
  setLanguage("en");
  assert.equal(t("ops.folderDone", { count: 1 }), "Sealed 1 file.");
  assert.equal(t("ops.folderDone", { count: 2 }), "Sealed 2 files.");
  assert.equal(t("ops.folderDone", { count: 0 }), "Sealed 0 files.");
});

test("placeholders are substituted, and unknown ones are left visible", () => {
  setLanguage("en");
  assert.equal(
    t("notice.sealedAs", { path: "notes/a.sealed" }),
    "Sealed as notes/a.sealed",
  );
  // A template referring to a parameter the caller forgot must not silently
  // render "undefined".
  assert.equal(t("notice.sealedAs", {}), "Sealed as {path}");
});

test("an unknown key degrades to the key itself rather than an empty string", () => {
  setLanguage("ru");
  try {
    const bogus = "does.not.exist" as MessageKey;
    assert.equal(t(bogus), "does.not.exist");
  } finally {
    setLanguage("en");
  }
});

test("a missing translation falls back to English", () => {
  // Simulate a gap by deleting one entry from the live Russian dictionary.
  const key: MessageKey = "common.save";
  const saved = ru[key];
  try {
    delete (ru as Record<string, Message>)[key];
    setLanguage("ru");
    assert.equal(t(key), en[key]);
  } finally {
    (ru as Record<string, Message>)[key] = saved;
    setLanguage("en");
  }
});

test("the host language is mapped onto a supported language", () => {
  assert.equal(matchHostLanguage("ru"), "ru");
  assert.equal(matchHostLanguage("ru-RU"), "ru");
  assert.equal(matchHostLanguage("en"), "en");
  assert.equal(matchHostLanguage("en-GB"), "en");
  // Anything we do not translate falls back to English rather than breaking.
  assert.equal(matchHostLanguage("de"), "en");
  assert.equal(matchHostLanguage(undefined), "en");
});

test("the language setting resolves and round-trips through settings", () => {
  assert.equal(resolveLanguage("auto", "ru"), "ru");
  assert.equal(resolveLanguage("auto", "fr"), "en");
  // An explicit choice overrides Obsidian's own language.
  assert.equal(resolveLanguage("en", "ru"), "en");
  assert.equal(resolveLanguage("ru", "en"), "ru");

  assert.equal(DEFAULT_SETTINGS.language, "auto");
  assert.equal(normalizeSettings({ language: "ru" }).language, "ru");
  assert.equal(normalizeSettings({ language: "klingon" }).language, "auto");
  assert.equal(normalizeSettings({}).language, "auto");
});

test("setLanguage is what t() reads", () => {
  setLanguage("ru");
  assert.equal(getCurrentLanguage(), "ru");
  assert.equal(t("common.cancel"), "Отмена");
  setLanguage("en");
  assert.equal(getCurrentLanguage(), "en");
  assert.equal(t("common.cancel"), "Cancel");
});
