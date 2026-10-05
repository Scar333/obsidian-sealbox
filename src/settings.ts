/**
 * Plugin settings. Kept free of Obsidian imports so it can be unit-tested and
 * imported by the pure logic modules.
 */

import { ARGON2_DESKTOP, ARGON2_MOBILE, PBKDF2_FALLBACK, type KdfParams } from "./crypto/kdf.ts";
import { DEFAULT_CHUNK_KIB } from "./crypto/container.ts";
import { isLanguage, matchHostLanguage, type Language } from "./i18n/index.ts";

export type KdfProfile = "auto" | "desktop" | "mobile" | "pbkdf2";
/** "auto" follows Obsidian's own interface language. */
export type LanguageSetting = "auto" | Language;
export type OriginalHandling = "trash" | "permanent" | "keep";

export interface SealboxSettings {
  /** Interface language; "auto" follows Obsidian. */
  language: LanguageSetting;
  /** Show the secrets icon in the left sidebar. */
  ribbonSecrets: boolean;
  /** Show the lock/unlock icon in the left sidebar. */
  ribbonLock: boolean;
  /** Show the "new secret entry" icon in the left sidebar. */
  ribbonQuickAdd: boolean;
  /** Show the "encrypt the current file" icon in the left sidebar. */
  ribbonEncrypt: boolean;
  /** Use the CodeMirror editor for encrypted notes instead of a plain textarea. */
  richEditor: boolean;
  /** Idle minutes before the vault locks itself. 0 disables auto-lock. */
  autoLockMinutes: number;
  /** Also lock when the Obsidian window loses focus. */
  lockOnBlur: boolean;
  kdfProfile: KdfProfile;
  /** Add the XChaCha20-Poly1305 layer on top of AES-256-GCM. */
  cascade: boolean;
  chunkKiB: number;
  /** Seconds before a copied password is cleared from the clipboard. 0 keeps it. */
  clipboardClearSeconds: number;
  /** What to do with the plaintext original after sealing it. */
  originalHandling: OriginalHandling;
  secretsPath: string;
  /** Refuse to seal or open files larger than this on mobile. */
  maxMobileMiB: number;
  /** Decrypt a freshly written container before deleting the original. */
  verifyAfterSeal: boolean;
  /** Keep nagging until a recovery key exists. */
  recoveryReminder: boolean;
}

export const DEFAULT_SETTINGS: SealboxSettings = {
  language: "auto",
  ribbonSecrets: true,
  ribbonLock: true,
  ribbonQuickAdd: true,
  ribbonEncrypt: true,
  richEditor: true,
  autoLockMinutes: 15,
  lockOnBlur: false,
  kdfProfile: "auto",
  cascade: false,
  chunkKiB: DEFAULT_CHUNK_KIB,
  clipboardClearSeconds: 30,
  originalHandling: "trash",
  secretsPath: "Secrets.sealed",
  maxMobileMiB: 64,
  verifyAfterSeal: true,
  recoveryReminder: true,
};

/** Coerce whatever was on disk into a valid settings object. */
export function normalizeSettings(raw: unknown): SealboxSettings {
  const s = { ...DEFAULT_SETTINGS };
  if (typeof raw !== "object" || raw === null) return s;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown, min: number, max: number, fallback: number) =>
    typeof v === "number" && Number.isFinite(v)
      ? Math.min(max, Math.max(min, Math.round(v)))
      : fallback;

  s.autoLockMinutes = num(r.autoLockMinutes, 0, 24 * 60, s.autoLockMinutes);
  s.lockOnBlur = r.lockOnBlur === true;
  s.ribbonSecrets = r.ribbonSecrets !== false;
  s.ribbonLock = r.ribbonLock !== false;
  s.ribbonQuickAdd = r.ribbonQuickAdd !== false;
  s.ribbonEncrypt = r.ribbonEncrypt !== false;
  s.richEditor = r.richEditor !== false;
  s.cascade = r.cascade === true;
  s.verifyAfterSeal = r.verifyAfterSeal !== false;
  s.recoveryReminder = r.recoveryReminder !== false;
  s.chunkKiB = num(r.chunkKiB, 16, 8192, s.chunkKiB);
  s.clipboardClearSeconds = num(r.clipboardClearSeconds, 0, 3600, s.clipboardClearSeconds);
  s.maxMobileMiB = num(r.maxMobileMiB, 1, 2048, s.maxMobileMiB);
  if (r.language === "auto" || isLanguage(r.language)) {
    s.language = r.language;
  }
  if (r.kdfProfile === "desktop" || r.kdfProfile === "mobile" || r.kdfProfile === "pbkdf2") {
    s.kdfProfile = r.kdfProfile;
  }
  if (r.originalHandling === "permanent" || r.originalHandling === "keep") {
    s.originalHandling = r.originalHandling;
  }
  if (typeof r.secretsPath === "string") {
    const sanitized = sanitizeVaultPath(r.secretsPath);
    if (sanitized) {
      s.secretsPath = sanitized.endsWith(SEALED_SUFFIX)
        ? sanitized
        : `${sanitized}${SEALED_SUFFIX}`;
    }
  }
  return s;
}

/**
 * Reduce a user- or config-supplied path to something that can only ever name a
 * file inside the vault: no absolute paths, no `..` traversal, no empty or
 * duplicated segments. Returns null when nothing usable is left.
 */
export function sanitizeVaultPath(input: string): string | null {
  const parts = input
    .split(/[/\\]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part !== "." && part !== "..");
  if (parts.length === 0) return null;
  return parts.join("/");
}

/**
 * Decide which language to actually use.
 * `hostLanguage` is what Obsidian reports for its own interface.
 */
export function resolveLanguage(
  setting: LanguageSetting,
  hostLanguage: string | undefined,
): Language {
  return setting === "auto" ? matchHostLanguage(hostLanguage) : setting;
}

export function resolveKdfParams(
  settings: SealboxSettings,
  isMobile: boolean,
  argon2Available: boolean,
): KdfParams {
  if (!argon2Available || settings.kdfProfile === "pbkdf2") return PBKDF2_FALLBACK;
  switch (settings.kdfProfile) {
    case "desktop":
      return ARGON2_DESKTOP;
    case "mobile":
      return ARGON2_MOBILE;
    default:
      return isMobile ? ARGON2_MOBILE : ARGON2_DESKTOP;
  }
}

export const SEALED_EXTENSION = "sealed";
export const SEALED_SUFFIX = `.${SEALED_EXTENSION}`;
