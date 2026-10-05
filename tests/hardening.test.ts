/**
 * Tests for the two capabilities the plugin is supposed not to have: reaching the
 * network, and printing anything.
 *
 * `tools/check-bundle.mjs` enforces this on the built artefact. These tests pin
 * the intent in source, so a well-meaning edit cannot quietly reintroduce either.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

import { loggingEnabled, log, scrub, scrubForLog } from "../src/log.ts";
import {
  FORBIDDEN_PDF_OPTIONS,
  PDF_SAFE_OPTIONS,
} from "../src/views/viewers/pdf-options.ts";

const SRC = join(import.meta.dirname, "..", "src");
const ROOT = join(import.meta.dirname, "..");

async function sourceFiles(dir = SRC, out: string[] = []): Promise<string[]> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await sourceFiles(full, out);
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

/** Comments talk about fetch and console; only code matters here. */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

test("logging is off unless explicitly built for development", () => {
  // NODE_ENV is unset under the test runner, which is the same situation as an
  // unknown bundler: the answer must be "silent".
  assert.equal(loggingEnabled, false);

  // And calling a logger in that state must not reach console at all.
  const original = { ...console };
  let calls = 0;
  for (const method of ["debug", "info", "warn", "error"] as const) {
    // eslint-disable-next-line no-console
    console[method] = () => {
      calls++;
    };
  }
  try {
    log.debug("x");
    log.info("x");
    log.warn("x", new Error("y"));
    log.error("x", new Error("y"));
  } finally {
    Object.assign(console, original);
  }
  assert.equal(calls, 0, "a logger wrote to console while logging was disabled");
});

test("no source file reaches the network", async () => {
  const patterns: Array<[RegExp, string]> = [
    [/\bfetch\s*\(/, "fetch()"],
    [/\bXMLHttpRequest\b/, "XMLHttpRequest"],
    [/\bWebSocket\b/, "WebSocket"],
    [/\bEventSource\b/, "EventSource"],
    [/\bsendBeacon\b/, "sendBeacon"],
    [/\brequestUrl\s*\(/, "Obsidian requestUrl()"],
  ];
  const offenders: string[] = [];
  for (const file of await sourceFiles()) {
    const code = stripComments(await readFile(file, "utf8"));
    for (const [pattern, name] of patterns) {
      if (pattern.test(code)) {
        offenders.push(`${relative(ROOT, file)} uses ${name}`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test("only src/log.ts mentions console", async () => {
  const offenders: string[] = [];
  for (const file of await sourceFiles()) {
    const rel = relative(ROOT, file).replaceAll("\\", "/");
    if (rel === "src/log.ts") continue;
    if (/\bconsole\s*\./.test(stripComments(await readFile(file, "utf8")))) {
      offenders.push(rel);
    }
  }
  assert.deepEqual(offenders, [], "route output through src/log.ts");
});

test("no source file imports a Node builtin", async () => {
  const offenders: string[] = [];
  for (const file of await sourceFiles()) {
    const code = stripComments(await readFile(file, "utf8"));
    if (/from\s+["']node:/.test(code) || /require\(\s*["']node:/.test(code)) {
      offenders.push(relative(ROOT, file));
    }
  }
  assert.deepEqual(offenders, [], "Node builtins do not exist in the Android WebView");
});

test("the pdf.js option set cannot reach the network", () => {
  assert.equal(PDF_SAFE_OPTIONS.useWorkerFetch, false);
  assert.equal(PDF_SAFE_OPTIONS.disableAutoFetch, true);
  assert.equal(PDF_SAFE_OPTIONS.disableStream, true);
  assert.equal(PDF_SAFE_OPTIONS.isEvalSupported, false);
  assert.equal(PDF_SAFE_OPTIONS.verbosity, 0);

  // The three ways a document's own contents could trigger a request.
  for (const forbidden of FORBIDDEN_PDF_OPTIONS) {
    assert.equal(
      forbidden in PDF_SAFE_OPTIONS,
      false,
      `${forbidden} must never be set: it gives pdf.js somewhere to fetch from`,
    );
  }
  assert.throws(
    () => {
      (PDF_SAFE_OPTIONS as Record<string, unknown>).url = "https://example.invalid";
    },
    "the option set must be frozen so a call site cannot add a URL",
  );
});

test("every getDocument call goes through the audited option set", async () => {
  const offenders: string[] = [];
  for (const file of await sourceFiles()) {
    const code = stripComments(await readFile(file, "utf8"));
    for (const call of code.match(/getDocument\s*\(\s*\{[^}]*\}/g) ?? []) {
      if (!call.includes("PDF_SAFE_OPTIONS")) {
        offenders.push(`${relative(ROOT, file)}: ${call.slice(0, 60)}…`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test("the build config locks the pdf.js worker down", async () => {
  const config = await readFile(join(ROOT, "esbuild.config.mjs"), "utf8");
  for (const api of ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "importScripts"]) {
    assert.ok(config.includes(`"${api}"`), `the worker prelude no longer blocks ${api}`);
  }
  assert.ok(config.includes('defineProperty(g, "console"'), "worker console is no longer silenced");
  assert.ok(config.includes('drop: production ? ["console", "debugger"]'), "console dropping removed");
  assert.ok(config.includes("SEALBOX-WORKER-BEGIN"), "worker region markers removed");
});

test("the scrubber survives being handed something enormous", () => {
  // A pathological input must not hang the logger (catastrophic backtracking).
  const started = Date.now();
  const text = `${"A".repeat(200000)} password: ${"b".repeat(200000)}`;
  const out = scrub(text);
  assert.ok(Date.now() - started < 2000, "scrub took too long");
  assert.ok(out.includes("<redacted>"));
  assert.ok(!out.includes("b".repeat(1000)));
});

// --- no silently dropped promises ------------------------------------------

test("no handler drops a promise, so a failure can never be invisible", async () => {
  // This guards a bug that actually shipped: "Create" next to Recovery key threw
  // inside `void (async () => …)()` on a vault with no master password yet, the
  // rejection went nowhere, and the button simply did nothing. Release builds
  // have no console either, so the error was gone for good.
  const forbidden: Array<[RegExp, string]> = [
    [/void\s*\(async/, "void (async () => …)() — the rejection is discarded"],
    [/=>\s*void\s+this\./, "=> void this.method() — the rejection is discarded"],
    [/\bvoid\s+this\.[A-Za-z_$][\w$]*\s*\(/, "void this.method() — the rejection is discarded"],
    [/\.then\s*\(/, ".then() — use runAction/runQuietly with async/await instead"],
  ];
  const offenders: string[] = [];
  for (const file of await sourceFiles()) {
    const rel = relative(ROOT, file).replaceAll("\\", "/");
    // run.ts is the one place allowed to touch a promise directly: it is what
    // every other call site goes through.
    if (rel === "src/ui/run.ts") continue;
    const code = stripComments(await readFile(file, "utf8"));
    for (const [pattern, why] of forbidden) {
      if (pattern.test(code)) offenders.push(`${rel}: ${why}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("runAction and runQuietly both attach a rejection handler", async () => {
  // The module imports Obsidian, so it cannot be executed here; assert on its
  // shape instead, since its whole purpose is to not drop a rejection.
  const code = await readFile(join(ROOT, "src", "ui", "run.ts"), "utf8");
  const stripped = stripComments(code);
  assert.match(stripped, /started\.catch\(/, "runAction must catch rejections");
  assert.match(stripped, /\.catch\(/, "runQuietly must catch rejections");
  assert.match(stripped, /try\s*{[\s\S]*Promise\.resolve\(fn\(\)\)/, "a handler that throws synchronously must be caught too");
});

// --- nothing from the vault can reach a log line ----------------------------

test("every log message is a plain string literal", async () => {
  // The guarantee is structural, not a matter of care: if a message can only be
  // a literal, then no file name, note title or path can be interpolated into
  // one. Five log calls used to embed `file.path`.
  const offenders: string[] = [];
  for (const file of await sourceFiles()) {
    const rel = relative(ROOT, file).replaceAll("\\", "/");
    const code = stripComments(await readFile(file, "utf8"));
    for (const call of code.match(/\blog\.(?:debug|info|warn|error)\s*\([^)]*/g) ?? []) {
      const firstArg = call.slice(call.indexOf("(") + 1).trim();
      const literal = /^"[^"]*"/.test(firstArg) || /^'[^']*'/.test(firstArg);
      // run.ts forwards a label it was handed; the test below pins those down.
      const forwarded = rel === "src/ui/run.ts" && firstArg.startsWith("label");
      if (!literal && !forwarded) offenders.push(`${rel}: log(${firstArg.slice(0, 60)}…`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("every runAction and runQuietly label is a string literal", async () => {
  // These labels become log messages, so the same rule has to reach them.
  const offenders: string[] = [];
  for (const file of await sourceFiles()) {
    const rel = relative(ROOT, file).replaceAll("\\", "/");
    if (rel === "src/ui/run.ts") continue;
    const code = stripComments(await readFile(file, "utf8"));
    for (const call of code.match(/\brun(?:Action|Quietly)\s*\(\s*[^,]+/g) ?? []) {
      const firstArg = call.slice(call.indexOf("(") + 1).trim();
      if (!/^"[^"]*"$/.test(firstArg) && !/^'[^']*'$/.test(firstArg)) {
        offenders.push(`${rel}: ${call.slice(0, 60)}…`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test("paths and file names are redacted on the way into a log", () => {
  // An Error raised for the user names the file on purpose — the user has to
  // know which one. That is right for a notice and wrong for a log.
  for (const sample of [
    "verification of notes/Taxes 2026.pdf.sealed failed",
    "could not open Divorce papers.pdf",
    "Secrets.sealed.bak is unreadable",
    "wrote .obsidian/plugins/sealbox/keyring.json",
  ]) {
    const out = scrubForLog(sample);
    assert.ok(out.includes("<path>"), `nothing redacted in: ${sample}`);
    for (const leak of ["Taxes", "Divorce", "keyring.json", "Secrets.sealed"]) {
      assert.ok(!out.includes(leak), `${leak} survived into: ${out}`);
    }
  }
  // Ordinary prose must stay readable, or the logs become useless.
  assert.equal(scrubForLog("could not seal a file in the folder"), "could not seal a file in the folder");
  // And a user-facing message keeps its file name: `scrub` is the other level.
  assert.ok(scrub("could not open Divorce papers.pdf").includes("Divorce papers.pdf"));
});
