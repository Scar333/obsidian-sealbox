#!/usr/bin/env node
/**
 * Release gate.
 *
 * Checks the two properties that are easy to lose by accident and expensive to
 * lose quietly: the plugin must not be able to talk to the network, and it must
 * not be able to print anything. Both are verified on the built artefact rather
 * than on intentions, plus a scan of our own sources.
 *
 * Run it with:  npm run verify
 * It exits non-zero on the first real problem, so it can gate a release.
 */

import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import process from "node:process";

const ROOT = new URL("..", import.meta.url).pathname;
const BUNDLE = process.argv[2] ?? join(ROOT, "main.js");

const WORKER_BEGIN = "/*SEALBOX-WORKER-BEGIN*/";
const WORKER_END = "/*SEALBOX-WORKER-END*/";

/**
 * Every http(s) string allowed to appear anywhere in the bundle. These are XML
 * namespace identifiers and licence notices inside pdf.js and core-js — names,
 * not endpoints. A new entry appearing here means a dependency gained a URL and
 * must be looked at by hand.
 */
const URL_ALLOWLIST = new Set([
  "http://ns.adobe.com/xdp/",
  "http://ns.adobe.com/xdp/pdf/",
  "http://ns.adobe.com/xfdf/",
  "http://ns.adobe.com/xmpmeta/",
  "https://github.com/zloirock/core-js",
  "https://github.com/zloirock/core-js/blob/v3.39.0/LICENSE",
  "https://www.npmjs.com/package/hash-wasm",
  "http://www.apache.org/licenses/LICENSE-2.0",
  "http://www.w3.org/1999/xhtml",
  "http://www.w3.org/1999/XSL/Transform",
  "http://www.w3.org/2000/09/xmldsig#",
  "http://www.w3.org/2000/svg",
  "http://www.xfa.org/schema/xci/",
  "http://www.xfa.org/schema/xdc/",
  "http://www.xfa.org/schema/xfa-connection-set/",
  "http://www.xfa.org/schema/xfa-data/",
  "http://www.xfa.org/schema/xfa-data/1.0/",
  "http://www.xfa.org/schema/xfa-form/",
  "http://www.xfa.org/schema/xfa-locale-set/",
  "http://www.xfa.org/schema/xfa-source-set/",
  "http://www.xfa.org/schema/xfa-template/",
]);

/** Network primitives that must not appear in our own source at all. */
const SOURCE_NETWORK_PATTERNS = [
  /\bfetch\s*\(/,
  /\bXMLHttpRequest\b/,
  /\bWebSocket\b/,
  /\bEventSource\b/,
  /\bsendBeacon\b/,
  /\bnavigator\s*\.\s*onLine\b/,
  /\brequestUrl\s*\(/, // Obsidian's own HTTP helper
  /\brequest\s*\(\s*\{/, // Obsidian's legacy HTTP helper
];

/** Files allowed to mention `console` at all. */
const CONSOLE_ALLOWED = new Set(["src/log.ts"]);

const problems = [];
const notes = [];

function fail(message) {
  problems.push(message);
}

async function walk(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, out);
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

// --- 1. our own sources -----------------------------------------------------

async function checkSources() {
  const files = await walk(join(ROOT, "src"));
  for (const file of files) {
    const rel = relative(ROOT, file).replaceAll("\\", "/");
    const text = await readFile(file, "utf8");
    // Strip comments so prose about fetch does not trip the scan.
    const code = text
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .map((line) => line.replace(/\/\/.*$/, ""))
      .join("\n");

    for (const pattern of SOURCE_NETWORK_PATTERNS) {
      if (pattern.test(code)) {
        fail(`${rel} uses a network primitive matching ${pattern}`);
      }
    }
    if (/\bconsole\s*\./.test(code) && !CONSOLE_ALLOWED.has(rel)) {
      fail(`${rel} calls console directly — route it through src/log.ts`);
    }
    if (/from\s+["']node:/.test(code) || /require\(["']node:/.test(code)) {
      fail(`${rel} imports a Node builtin, which does not exist on Android`);
    }
  }
  notes.push(`scanned ${files.length} source files`);
}

// --- 2. the built bundle ----------------------------------------------------

async function checkBundle() {
  let bundle;
  try {
    bundle = await readFile(BUNDLE, "utf8");
  } catch {
    fail(`cannot read the bundle at ${BUNDLE} — run "npm run build" first`);
    return;
  }

  // The bundle must not carry anything that varies between builds. A build
  // timestamp in the banner was enough to make the released main.js differ from
  // what the same sources produce, which defeats the point of being able to
  // check that a release matches its source.
  const firstLine = bundle.slice(0, bundle.indexOf("\n"));
  if (/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(firstLine)) {
    fail("the bundle banner carries a timestamp, so the build is not reproducible");
  }

  const begin = bundle.indexOf(WORKER_BEGIN);
  const end = bundle.indexOf(WORKER_END);
  if (begin < 0 || end < 0 || end < begin) {
    fail("the pdf.js worker lock-down prelude is missing from the bundle");
    return;
  }
  const worker = bundle.slice(begin, end);
  const ours = bundle.slice(0, begin) + bundle.slice(end);

  // 2a. The worker really is locked down.
  for (const name of ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "importScripts"]) {
    if (!worker.includes(`"${name}"`)) {
      fail(`the worker prelude no longer blocks ${name}`);
    }
  }
  if (!worker.includes("is disabled inside this worker")) {
    fail("the worker prelude no longer replaces network APIs with throwing stubs");
  }
  if (!worker.includes('defineProperty(g, "console"')) {
    fail("the worker prelude no longer silences console");
  }

  // 2b. Nothing outside the worker can print.
  const consoleCalls = ours.match(/console\s*\.\s*[a-zA-Z]+\s*\(/g) ?? [];
  if (consoleCalls.length > 0) {
    fail(
      `${consoleCalls.length} console call(s) survived into the bundle outside the worker ` +
        `(first: ${consoleCalls[0]}) — build with "npm run build", not a dev build`,
    );
  }

  // 2c. No Node builtins, which would break the plugin on Android.
  const builtins = ours.match(/require\(["'](?:node:)?(?:fs|path|os|child_process|net|http|https|crypto)["']\)/g) ?? [];
  if (builtins.length > 0) {
    fail(`the bundle requires Node builtins: ${[...new Set(builtins)].join(", ")}`);
  }

  // 2d. Every URL in the bundle is a known identifier, not an endpoint.
  const urls = new Set(bundle.match(/https?:\/\/[A-Za-z0-9./_#:-]+/g) ?? []);
  const unexpected = [...urls].filter((u) => !URL_ALLOWLIST.has(u));
  if (unexpected.length > 0) {
    fail(
      `unexpected URL(s) in the bundle — check whether anything actually requests them, ` +
        `then add them to URL_ALLOWLIST in this script:\n    ${unexpected.join("\n    ")}`,
    );
  }
  notes.push(`bundle ${(bundle.length / 1024).toFixed(0)} KiB, ${urls.size} URL strings, all known`);
  notes.push(`worker region ${(worker.length / 1024).toFixed(0)} KiB, locked down`);
}

// --- 3. the manifest --------------------------------------------------------

async function checkManifest() {
  const manifest = JSON.parse(await readFile(join(ROOT, "manifest.json"), "utf8"));
  if (manifest.isDesktopOnly !== false) {
    fail("manifest.json must keep isDesktopOnly: false for Android support");
  }
  notes.push(`manifest ${manifest.id} v${manifest.version}, mobile enabled`);
}

await checkSources();
await checkBundle();
await checkManifest();

for (const note of notes) process.stdout.write(`  ok   ${note}\n`);
if (problems.length === 0) {
  process.stdout.write("\nverify: no network capability, no logging capability.\n");
  process.exit(0);
}
for (const problem of problems) process.stderr.write(`  FAIL ${problem}\n`);
process.stderr.write(`\nverify: ${problems.length} problem(s).\n`);
process.exit(1);
