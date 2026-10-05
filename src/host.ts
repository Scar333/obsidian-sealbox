/**
 * The slice of the plugin that views and modals are allowed to see.
 * Declared separately so UI modules do not import the plugin class, which would
 * make every import cycle back through `main.ts`.
 */

import type { App } from "obsidian";
import type { SealboxSettings } from "./settings.ts";
import type { VaultController } from "./vault-controller.ts";
import type { SealedFileOps } from "./ops/file-ops.ts";

export interface SealboxHost {
  app: App;
  settings: SealboxSettings;
  controller: VaultController;
  ops: SealedFileOps;
  saveSettings(): Promise<void>;
  /** Re-apply the language setting and relabel everything that caches a string. */
  applyLanguage(): void;
  /** Rebuild the sidebar icons from the settings. */
  refreshRibbon(): void;
}
