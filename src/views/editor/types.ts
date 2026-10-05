/**
 * The editor contract.
 *
 * Two implementations satisfy it: a CodeMirror 6 editor built on the very same
 * library Obsidian's own editor uses, and a plain textarea as the fallback. The
 * view does not care which it got — only that plaintext goes in from memory and
 * comes back out to be re-encrypted, never touching a file either way.
 */

export type TextEditorKind = "codemirror" | "textarea";

export interface TextEditorHandle {
  /** Which implementation is in use. Reported by the diagnostics screen. */
  readonly kind: TextEditorKind;
  getValue(): string;
  focus(): void;
  /**
   * Tear the editor down.
   *
   * Must never throw (it runs on the path that wipes plaintext when the vault
   * locks) and must never invoke any of the callbacks below. Reporting its own
   * teardown as a user edit is exactly how the view ended up marked dirty in
   * Preview mode with no editor left to save from.
   */
  destroy(): void;
}

export interface TextEditorOptions {
  initialValue: string;
  /** Turns on Markdown highlighting and spellcheck. */
  markdown: boolean;
  /** Called on every edit, to mark the note dirty and schedule an autosave. */
  onChange(): void;
  /** Ctrl/Cmd-S. */
  onSave(): void;
  /** Leaving the field is a natural commit point. */
  onBlur(): void;
}
