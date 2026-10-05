/**
 * Password strength estimation.
 *
 * Kept free of Obsidian imports so it can be unit-tested directly.
 */
import { t } from "../i18n/index.ts";


export interface StrengthReport {
  bits: number;
  label: string;
  tone: "weak" | "fair" | "good" | "strong";
}

/**
 * Rough entropy estimate. Deliberately conservative and deliberately small —
 * a full estimator (zxcvbn and friends) would add megabytes to a plugin that
 * has to load on a phone, and the only job here is to stop "qwerty123".
 */
export function estimateStrength(password: string): StrengthReport {
  if (password.length === 0) return { bits: 0, label: t("strength.empty"), tone: "weak" };

  let classes = 0;
  if (/[a-z]/.test(password)) classes += 26;
  if (/[A-Z]/.test(password)) classes += 26;
  if (/[0-9]/.test(password)) classes += 10;
  if (/[^A-Za-z0-9]/.test(password)) classes += 33;

  const unique = new Set(password).size;
  // Repetition means fewer effective characters than the raw length suggests.
  const effectiveLength = password.length * Math.min(1, (unique + 2) / password.length);
  let bits = effectiveLength * Math.log2(Math.max(classes, 2));

  if (/^[0-9]+$/.test(password)) bits *= 0.5;
  if (/(.)\1{2,}/.test(password)) bits *= 0.8;
  if (/^(?:qwerty|password|пароль|12345|letmein|admin)/i.test(password)) bits = Math.min(bits, 18);

  bits = Math.round(bits);
  if (bits < 45) return { bits, label: t("strength.weak"), tone: "weak" };
  if (bits < 65) return { bits, label: t("strength.fair"), tone: "fair" };
  if (bits < 90) return { bits, label: t("strength.good"), tone: "good" };
  return { bits, label: t("strength.strong"), tone: "strong" };
}
