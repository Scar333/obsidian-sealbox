/**
 * Linking to a sealed file.
 *
 * Unlike a secrets entry, a sealed file needs no invented link format: Obsidian
 * resolves links to any file in the vault, and clicking one opens it in the lock
 * screen. `generateMarkdownLink` produces it in whatever form this vault is
 * configured for — wikilink or Markdown, shortest path or relative — so the link
 * matches everything else the user writes.
 *
 * A link discloses nothing. The file name is already visible in the explorer,
 * and the contents stay sealed until someone unlocks them.
 */

import { App, Notice, TFile } from "obsidian";
import { t } from "../i18n/index.ts";

export async function copyFileLink(app: App, file: TFile): Promise<void> {
  const link = app.fileManager.generateMarkdownLink(file, "");
  try {
    await navigator.clipboard.writeText(link);
    new Notice(t("notice.fileLinkCopied", { link }), 6000);
  } catch {
    new Notice(t("secrets.clipboardUnavailable"));
  }
}
