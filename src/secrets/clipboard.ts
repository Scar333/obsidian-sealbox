/**
 * Clipboard handling for passwords.
 *
 * The clipboard is shared with every other application on the machine, so a
 * copied password is the least protected thing this plugin produces. We clear it
 * after a timeout, and we say out loud that on Android other apps can read it
 * while it is there — a limitation of the platform, not something a plugin can
 * fix.
 */

import { Notice } from "obsidian";
import { log } from "../log.ts";
import { t } from "../i18n/index.ts";

let pendingClear: number | null = null;

export async function copyWithAutoClear(
  text: string,
  clearAfterSeconds: number,
): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    log.warn("the clipboard is unavailable", e);
    new Notice(t("clipboard.unavailable"));
    return;
  }

  if (pendingClear !== null) window.clearTimeout(pendingClear);
  if (clearAfterSeconds <= 0) {
    new Notice(t("clipboard.copiedNoClear"));
    return;
  }

  new Notice(t("clipboard.copiedWithClear", { seconds: clearAfterSeconds }));
  pendingClear = window.setTimeout(() => {
    pendingClear = null;
    void clearIfUnchanged(text);
  }, clearAfterSeconds * 1000);
}

/**
 * Only wipe the clipboard if it still holds what we put there, so we do not
 * destroy something the user copied in the meantime. Reading the clipboard is
 * often denied (notably on Android); when it is, clearing anyway is the safer
 * of the two mistakes.
 */
async function clearIfUnchanged(expected: string): Promise<void> {
  try {
    const current = await navigator.clipboard.readText();
    if (current !== expected) return;
  } catch {
    // Cannot check — fall through and clear.
  }
  try {
    await navigator.clipboard.writeText("");
  } catch (e) {
    log.warn("could not clear the clipboard", e);
  }
}

export function cancelPendingClear(): void {
  if (pendingClear !== null) {
    window.clearTimeout(pendingClear);
    pendingClear = null;
  }
}
