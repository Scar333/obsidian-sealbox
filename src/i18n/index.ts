/**
 * Localisation.
 *
 * Deliberately free of Obsidian imports, for two reasons: the crypto core raises
 * user-facing errors and must stay runnable under `node --test`, and the whole
 * dictionary is then a plain object a test can check for completeness.
 *
 * English is the source of truth. `MessageKey` is derived from it, so every other
 * language is a `Record<MessageKey, …>` and a missing or misspelt key is a
 * compile error rather than a blank label at runtime.
 */

import { en } from "./en.ts";
import { ru } from "./ru.ts";

export type Language = "en" | "ru";
export const LANGUAGES: Language[] = ["en", "ru"];

/** Plural categories we support. English uses one/many; Russian needs few too. */
export interface PluralForms {
  one: string;
  few?: string;
  many: string;
}

export type Message = string | PluralForms;
export type MessageKey = keyof typeof en;
export type Dictionary = Record<MessageKey, Message>;

const DICTIONARIES: Record<Language, Dictionary> = { en, ru };

let current: Language = "en";

export function setLanguage(language: Language): void {
  current = language;
}

export function getCurrentLanguage(): Language {
  return current;
}

export function isLanguage(value: unknown): value is Language {
  return value === "en" || value === "ru";
}

/**
 * Pick the plural category for a count.
 *
 * Russian distinguishes 1 файл / 2 файла / 5 файлов, and getting it wrong is the
 * most visible way a translation looks machine-made.
 */
function pluralCategory(language: Language, count: number): keyof PluralForms {
  const n = Math.abs(Math.trunc(count));
  if (language === "ru") {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return "one";
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "few";
    return "many";
  }
  return n === 1 ? "one" : "many";
}

export type MessageParams = Record<string, string | number>;

function resolve(language: Language, key: MessageKey, params?: MessageParams): string | null {
  const message = DICTIONARIES[language][key];
  if (message === undefined) return null;
  if (typeof message === "string") return message;

  const count = typeof params?.count === "number" ? params.count : 0;
  const category = pluralCategory(language, count);
  return message[category] ?? message.many;
}

/**
 * Translate a key, substituting `{name}` placeholders.
 *
 * Falls back to English, and then to the key itself, so a gap in a translation
 * degrades to readable text instead of an empty button.
 */
export function t(key: MessageKey, params?: MessageParams): string {
  const template = resolve(current, key, params) ?? resolve("en", key, params) ?? String(key);
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = params[name];
    return value === undefined ? whole : String(value);
  });
}

/**
 * Map Obsidian's interface language onto ours.
 * Called with the result of Obsidian's `getLanguage()`, e.g. "ru" or "en-GB".
 */
export function matchHostLanguage(hostLanguage: string | undefined): Language {
  const tag = (hostLanguage ?? "").toLowerCase();
  return tag.startsWith("ru") ? "ru" : "en";
}

export { en, ru };
