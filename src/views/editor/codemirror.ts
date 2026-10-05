/**
 * The real editor: CodeMirror 6.
 *
 * Obsidian declares the CodeMirror 6 packages as externals, which means a plugin
 * gets *Obsidian's own instance*, at Obsidian's own version — the same library
 * its editor is built on. So this is not a lookalike: undo history, multiple
 * cursors, selection handling, search and Markdown highlighting are the genuine
 * article.
 *
 * What it still is not is Obsidian's *editor*. Live preview, `[[wikilink]]`
 * autocomplete and embeds are Obsidian's proprietary layer on top of CodeMirror,
 * with no public API to instantiate inside a custom view. The only way plugins
 * get that is by letting Obsidian open a real Markdown file — which means
 * plaintext on disk, which is precisely what this plugin exists to avoid.
 *
 * Markdown highlighting comes from `@lezer/markdown`, whose parser already
 * carries highlight tags. `@codemirror/lang-markdown` would have pulled in the
 * HTML, JavaScript and CSS languages for embedded code — hundreds of kilobytes
 * for something this view does not need.
 */

import { EditorState } from "@codemirror/state";
import { EditorView, drawSelection, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import {
  HighlightStyle,
  Language,
  defineLanguageFacet,
  syntaxHighlighting,
} from "@codemirror/language";
import { styleTags, tags as t } from "@lezer/highlight";
import { parser as markdownParser } from "@lezer/markdown";

import type { TextEditorHandle, TextEditorOptions } from "./types.ts";

/**
 * The parser tags headings, emphasis, links and markers on its own; inline and
 * fenced code content is not tagged, so it is added here.
 */
const taggedMarkdown = markdownParser.configure({
  props: [styleTags({ InlineCode: t.monospace, CodeText: t.monospace, URL: t.url })],
});

const markdownLanguage = new Language(
  defineLanguageFacet({ commentTokens: { block: { open: "<!--", close: "-->" } } }),
  taggedMarkdown,
  [],
  "markdown",
);

/** Colours come from Obsidian's own CSS variables, so themes apply for free. */
const obsidianHighlight = HighlightStyle.define([
  { tag: t.heading, fontWeight: "600", color: "var(--text-accent)" },
  { tag: t.strong, fontWeight: "600" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  {
    tag: t.monospace,
    fontFamily: "var(--font-monospace)",
    color: "var(--code-normal)",
    backgroundColor: "var(--code-background)",
  },
  { tag: t.link, color: "var(--link-color)" },
  { tag: t.url, color: "var(--link-color)", textDecoration: "underline" },
  { tag: t.quote, color: "var(--text-muted)", fontStyle: "italic" },
  { tag: t.list, color: "var(--text-muted)" },
  // The syntax characters themselves (`#`, `**`, `-`, backticks): present but
  // receding, the way Obsidian's source mode shows them.
  { tag: t.meta, color: "var(--text-faint)" },
]);

/** Match Obsidian's typography and readable line width. */
const obsidianTheme = EditorView.theme({
  "&": {
    backgroundColor: "transparent",
    color: "var(--text-normal)",
    fontFamily: "var(--font-text)",
    fontSize: "var(--font-text-size)",
    height: "100%",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "inherit",
    lineHeight: "var(--line-height-normal)",
    overflow: "auto",
  },
  ".cm-content": {
    maxWidth: "var(--file-line-width)",
    margin: "0 auto",
    padding: "4px 0 40vh",
    caretColor: "var(--text-normal)",
  },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--text-normal)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "var(--text-selection)",
  },
  ".cm-panels": {
    backgroundColor: "var(--background-secondary)",
    color: "var(--text-normal)",
    borderColor: "var(--background-modifier-border)",
  },
  ".cm-searchMatch": { backgroundColor: "var(--text-highlight-bg)" },
  ".cm-selectionMatch": { backgroundColor: "var(--text-selection)" },
});

export function createCodeMirrorEditor(
  container: HTMLElement,
  options: TextEditorOptions,
): TextEditorHandle {
  const host = container.createDiv({ cls: "sealbox-cm-host" });
  // Guards the callbacks during teardown. Without it, anything the editor does
  // on its way out is reported to the view as a user edit.
  let disposed = false;

  const view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc: options.initialValue,
      extensions: [
        history(),
        drawSelection(),
        highlightSelectionMatches(),
        search({ top: true }),
        EditorView.lineWrapping,
        obsidianTheme,
        syntaxHighlighting(obsidianHighlight),
        ...(options.markdown ? [markdownLanguage] : []),
        // Ours first, so Ctrl/Cmd-S saves instead of falling through to
        // Obsidian's own save command, which has no editor here to act on.
        keymap.of([
          {
            key: "Mod-s",
            preventDefault: true,
            run: () => {
              options.onSave();
              return true;
            },
          },
        ]),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !disposed) options.onChange();
        }),
        EditorView.domEventHandlers({
          blur: () => {
            if (!disposed) options.onBlur();
            return false;
          },
        }),
        EditorView.contentAttributes.of({
          spellcheck: options.markdown ? "true" : "false",
        }),
      ],
    }),
  });

  return {
    kind: "codemirror",
    getValue: () => view.state.doc.toString(),
    focus: () => view.focus(),
    destroy() {
      disposed = true;
      // No attempt to blank the document first. CodeMirror stores it as an
      // immutable rope, so a change only builds a *new* empty state while the
      // old one keeps the text until the garbage collector takes it — it wipes
      // nothing. It does, however, count as a document change, which used to be
      // reported as a user edit and left the view marked dirty in Preview mode
      // with no editor left to save from.
      //
      // The plaintext therefore lives as an ordinary JS string until collected,
      // which is the same caveat the threat model already states for passwords:
      // strings cannot be wiped in JavaScript.
      view.destroy();
      host.remove();
    },
  };
}
