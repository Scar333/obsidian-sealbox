/**
 * Choosing an editor.
 *
 * CodeMirror 6 comes from Obsidian as an external module, which is exactly why
 * it is loaded with a dynamic `import()` here rather than at the top of the file.
 * A static import would be resolved when the plugin loads: if a future Obsidian
 * ever stopped providing one of those modules, the *whole plugin* would fail to
 * load rather than one feature degrading. Loading it at the moment it is needed
 * keeps the failure local, and the textarea takes over.
 */

import { log } from "../../log.ts";
import type { TextEditorHandle, TextEditorOptions } from "./types.ts";
import { createTextareaEditor } from "./textarea.ts";

export type { TextEditorHandle, TextEditorKind, TextEditorOptions } from "./types.ts";

export interface EditorChoice {
  /** False forces the textarea, from the settings. */
  rich: boolean;
}

export async function createEditor(
  container: HTMLElement,
  options: TextEditorOptions,
  choice: EditorChoice,
): Promise<TextEditorHandle> {
  if (choice.rich) {
    try {
      const { createCodeMirrorEditor } = await import("./codemirror.ts");
      return createCodeMirrorEditor(container, options);
    } catch (e) {
      log.warn("the CodeMirror editor is unavailable; using a plain textarea", e);
      container.empty();
    }
  }
  return createTextareaEditor(container, options);
}

/**
 * Report which editor this device can actually start, without mounting one the
 * user can see. Used by the diagnostics screen.
 */
export async function probeRichEditor(): Promise<{ available: boolean; error?: string }> {
  try {
    await import("./codemirror.ts");
    return { available: true };
  } catch (e) {
    return {
      available: false,
      error: e instanceof Error ? e.message : "unknown error",
    };
  }
}
