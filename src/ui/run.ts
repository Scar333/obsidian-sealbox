/**
 * Running async work from a UI handler.
 *
 * Every click handler must go through this. The idiom it replaces —
 * `onClick(() => void somethingAsync())` — discards the promise, so a rejection
 * is never reported anywhere: the button appears to do nothing at all, which is
 * the most confusing failure mode a UI can have and the hardest to diagnose from
 * a bug report. A release build has no console either, so the error is gone for
 * good.
 *
 * `runAction` guarantees the opposite: whatever happens, the user is told.
 */

import { Notice } from "obsidian";
import { t } from "../i18n/index.ts";
import { log, userMessage } from "../log.ts";

/**
 * Start async work from an event handler.
 *
 * @param label  a fixed description for the log line, never shown to the user.
 *               Must be a string literal: see the logging rules in src/log.ts.
 * @param fn     the work; its rejection is reported rather than dropped
 */
export function runAction(label: string, fn: () => Promise<unknown>): void {
  let started: Promise<unknown>;
  try {
    started = Promise.resolve(fn());
  } catch (e) {
    // A handler that throws synchronously, before its first await.
    report(label, e);
    return;
  }
  void started.catch((e: unknown) => report(label, e));
}

function report(label: string, error: unknown): void {
  log.error(label, error);
  new Notice(t("error.actionFailed", { error: userMessage(error) }), 12000);
}

/**
 * Fire-and-forget work whose failure is not worth a dialog — refreshing a label,
 * say. It still must not vanish silently, so it is logged. `label` must be a
 * string literal, for the same reason.
 */
export function runQuietly(label: string, fn: () => Promise<unknown>): void {
  void Promise.resolve()
    .then(fn)
    .catch((e: unknown) => log.warn(label, e));
}
