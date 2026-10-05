/**
 * A notice that carries an action.
 *
 * Used for "undo" right after sealing a file. That moment is the safest one to
 * offer it: the plaintext was in the vault seconds ago, so git and Syncthing have
 * most likely not even seen the change yet — which is exactly the objection that
 * makes a permanent decrypt risky at any other time.
 */

import { Notice } from "obsidian";

export function noticeWithAction(
  message: string,
  actionLabel: string,
  onAction: () => void,
  durationMs = 15000,
): Notice {
  const notice = new Notice(message, durationMs);
  // `messageEl` exists from Obsidian 1.8.7; older versions only have the
  // deprecated `noticeEl`. Falling back keeps the notice useful either way.
  const host: HTMLElement | undefined = notice.messageEl ?? notice.noticeEl;
  if (!host) return notice;

  host.appendText(" ");
  const link = host.createEl("a", {
    text: actionLabel,
    cls: "sealbox-notice-action",
  });
  link.setAttribute("href", "#");
  link.addEventListener("click", (event) => {
    event.preventDefault();
    // Clicking anywhere on a notice dismisses it; keep that from eating the click.
    event.stopPropagation();
    notice.hide();
    onAction();
  });
  return notice;
}
