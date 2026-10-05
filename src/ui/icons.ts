/**
 * Icon helper.
 *
 * Obsidian types `IconName` as plain `string`, so a name that is not in the
 * bundled Lucide set does not fail to compile — it renders nothing, leaving an
 * invisible button in the sidebar. This checks that an SVG actually landed and
 * falls back to a name that certainly exists.
 */

import { setIcon } from "obsidian";

const FALLBACK = "lock";

export function setSafeIcon(el: HTMLElement, icon: string): void {
  setIcon(el, icon);
  if (!el.querySelector("svg") && icon !== FALLBACK) setIcon(el, FALLBACK);
}
