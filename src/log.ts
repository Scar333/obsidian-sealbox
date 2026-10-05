/**
 * Logging and user-facing messages.
 *
 * An encryption plugin that prints the wrong variable has defeated its own
 * purpose, so there is exactly one way to emit text and it scrubs on the way
 * out. Three layers of defence:
 *
 *  1. The API only accepts a message string and an optional `Error`. There is
 *     no way to hand it an object, a buffer or a note's contents.
 *  2. `scrub()` redacts anything shaped like key material or an encoded blob,
 *     which catches the case where a message was built by string concatenation.
 *  3. Release builds are compiled with esbuild `drop: ["console"]`, so no
 *     `console.*` call survives into the shipped `main.js` at all.
 *
 * Two rules hold the confidentiality guarantee, and both are enforced by tests:
 *
 *  - **A log message is always a plain string literal.** No template, no
 *    concatenation. Nothing derived from the vault — not even a file name — can
 *    reach a log line through the message, because there is nowhere to put it.
 *  - **Anything path-shaped is redacted on the way out.** An `Error` thrown for
 *    the user ("verification of notes/report.pdf failed") carries a file name by
 *    design, since the user needs to know which file. That is right for a notice
 *    on their own screen and wrong for a log, so the log path strips it.
 *
 * Plaintext, passwords and key material must never be passed in regardless: the
 * scrubber is a safety net for mistakes, not a licence to log secrets.
 */

const PREFIX = "[Sealbox]";
import { t } from "./i18n/index.ts";

/**
 * Logging is opt-in, and only a development build opts in.
 *
 * Release builds are already compiled with esbuild `drop: ["console"]`, which
 * removes every call site outright. This flag is the second, independent layer:
 * if the plugin is ever built with a different bundler, or without that option,
 * it still stays silent — the default is off, not on. Fail-safe, not fail-open.
 */
const LOGGING_ENABLED: boolean = (() => {
  try {
    return (
      typeof process !== "undefined" &&
      process.env != null &&
      process.env.NODE_ENV === "development"
    );
  } catch {
    return false;
  }
})();

/** Runs of base64/base32/hex long enough to be key material or a payload. */
const BLOB_PATTERNS: RegExp[] = [
  /[A-Za-z0-9+/]{40,}={0,2}/g,
  /\b[0-9a-fA-F]{32,}\b/g,
  /\b(?:[0-9A-HJKMNP-TV-Z]{5}-){3,}[0-9A-HJKMNP-TV-Z]{1,5}\b/g,
];

/** Field names whose value must never be printed, even by accident. */
const SENSITIVE_KEYS =
  /\b(password|passphrase|secret|token|recovery[-_ ]?key|master[-_ ]?key|plaintext|private)\b\s*[:=]\s*\S+/gi;

/**
 * File names and paths. Redacted in logs only — a notice has to name the file it
 * is talking about, or the user cannot act on it.
 */
const FILE_EXTENSIONS =
  "sealed|bak|md|markdown|pdf|png|jpe?g|gif|webp|avif|bmp|svg|txt|json|csv|ya?ml|log|zip|7z|docx?|xlsx?|pptx?|mp[34]";

const PATH_PATTERNS: RegExp[] = [
  // Anything with a slash in it.
  /\S*\/\S+/g,
  // A file name, including the words before it: real names have spaces in them,
  // and redacting only "papers.pdf" out of "Divorce papers.pdf" protects nothing.
  // Over-redacting a few words of a log line is the cheap side of this trade.
  new RegExp(`(?:[\\w.()\\[\\]-]+ ){0,3}[\\w.()\\[\\]-]+\\.(?:${FILE_EXTENSIONS})\\b`, "gi"),
];

/** Scrubbing for a log line: everything `scrub` does, plus paths and file names. */
export function scrubForLog(text: string): string {
  let out = scrub(text);
  for (const pattern of PATH_PATTERNS) out = out.replace(pattern, "<path>");
  return out;
}

export function scrub(text: string): string {
  let out = text.replace(SENSITIVE_KEYS, (m) => {
    const name = (m.split(/[:=]/, 1)[0] ?? "").trim();
    return `${name}=<redacted>`;
  });
  for (const pattern of BLOB_PATTERNS) {
    out = out.replace(pattern, "<redacted>");
  }
  return out;
}

/**
 * Render an error for display. Only the class name and message survive; the
 * stack is kept for development builds, where it is useful and where no release
 * log exists to leak into.
 */
export function describeError(e: unknown): string {
  if (e instanceof Error) {
    const base = `${e.name}: ${scrub(e.message)}`;
    return LOGGING_ENABLED && e.stack ? `${base}\n${scrub(e.stack)}` : base;
  }
  if (typeof e === "string") return scrub(e);
  // Deliberately not stringified: an unknown thrown value could be anything,
  // including a buffer of plaintext.
  return t("error.unknown");
}

/** Short, user-safe one-liner for a Notice or an inline error. */
export function userMessage(e: unknown): string {
  if (e instanceof Error) return scrub(e.message);
  return t("error.generic");
}

function line(message: string, error: unknown): string {
  const detail = error === undefined ? "" : ` — ${describeError(error)}`;
  return scrubForLog(`${message}${detail}`);
}

export const log = {
  debug(message: string): void {
    if (!LOGGING_ENABLED) return;
    console.debug(`${PREFIX} ${scrubForLog(message)}`);
  },
  info(message: string): void {
    if (!LOGGING_ENABLED) return;
    console.info(`${PREFIX} ${scrubForLog(message)}`);
  },
  warn(message: string, error?: unknown): void {
    if (!LOGGING_ENABLED) return;
    console.warn(`${PREFIX} ${line(message, error)}`);
  },
  error(message: string, error?: unknown): void {
    if (!LOGGING_ENABLED) return;
    console.error(`${PREFIX} ${line(message, error)}`);
  },
};

/** Exposed so a test can assert the default is "silent". */
export const loggingEnabled = LOGGING_ENABLED;
