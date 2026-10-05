/**
 * The fallback editor.
 *
 * Kept as a real, maintained path rather than dead code: it is what runs if a
 * device cannot start CodeMirror, and it is what the settings toggle selects for
 * anyone who would rather have a plain field. It borrows Obsidian's typography
 * and readable line width so the two do not look unrelated.
 */

import type { TextEditorHandle, TextEditorOptions } from "./types.ts";

export function createTextareaEditor(
  container: HTMLElement,
  options: TextEditorOptions,
): TextEditorHandle {
  const textarea = container.createEl("textarea", { cls: "sealbox-editor" });
  textarea.value = options.initialValue;
  textarea.spellcheck = options.markdown;
  // Same contract as the CodeMirror editor: nothing it does on the way out may
  // be reported as a user edit.
  let disposed = false;

  textarea.addEventListener("input", () => {
    if (!disposed) options.onChange();
  });
  textarea.addEventListener("blur", () => {
    if (!disposed) options.onBlur();
  });
  textarea.addEventListener("keydown", (event) => {
    // Ctrl/Cmd-S saves here and goes no further: Obsidian's own save command
    // would otherwise also fire on a view that has no editor for it to act on.
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      event.stopPropagation();
      options.onSave();
      return;
    }
    // Tab belongs in the text, not in the focus order.
    if (event.key === "Tab") {
      event.preventDefault();
      const { selectionStart, selectionEnd, value } = textarea;
      textarea.value = `${value.slice(0, selectionStart)}\t${value.slice(selectionEnd)}`;
      textarea.selectionStart = textarea.selectionEnd = selectionStart + 1;
      options.onChange();
    }
  });

  return {
    kind: "textarea",
    getValue: () => textarea.value,
    focus: () => textarea.focus(),
    destroy() {
      disposed = true;
      textarea.value = "";
      textarea.remove();
    },
  };
}
