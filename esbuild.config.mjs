import esbuild from "esbuild";
import process from "node:process";
import fs from "node:fs";
import path from "node:path";
import { builtinModules } from "node:module";

const production = process.argv[2] === "production";

// Node's own list, so nothing has to be installed for it. Both spellings are
// marked external: a dependency may import either "path" or "node:path", and
// neither exists inside Obsidian on mobile.
const builtins = [...builtinModules, ...builtinModules.map((m) => `node:${m}`)];

// Build into the repository root by default: that is where the release workflow
// and the community catalogue expect main.js to be. Point SEALBOX_OUT at a
// vault's plugin folder to install straight into Obsidian while developing.
const outDir = process.env.SEALBOX_OUT ?? ".";

/**
 * Prelude injected at the very top of the bundled pdf.js worker.
 *
 * The worker runs in its own global scope that nothing else shares, so unlike the
 * main thread we can take its dangerous capabilities away outright instead of
 * merely declining to use them:
 *
 *  - Network APIs are replaced with functions that throw. pdf.js only reaches
 *    them when handed a URL, and we never hand it one — but if a future version
 *    (or a crafted document) found a path there, it fails loudly instead of
 *    silently making a request with your document's contents.
 *  - `console` is replaced with no-ops. The worker's source is inlined as a
 *    string, so esbuild's `drop: ["console"]` cannot reach inside it, and pdf.js
 *    logs lines that can describe a document's structure and fonts.
 *
 * The markers are what tools/check-bundle.mjs uses to tell the worker's region of
 * the bundle apart from our own code.
 */
const WORKER_BEGIN = "/*SEALBOX-WORKER-BEGIN*/";
const WORKER_END = "/*SEALBOX-WORKER-END*/";

const workerPrelude = `${WORKER_BEGIN}
(function sealboxLockDownWorker() {
  var g = typeof self !== "undefined" ? self : globalThis;
  var blocked = [
    "fetch",
    "XMLHttpRequest",
    "WebSocket",
    "EventSource",
    "importScripts",
    "BroadcastChannel",
  ];
  for (var i = 0; i < blocked.length; i++) {
    (function (name) {
      function denied() {
        throw new Error("Sealbox: " + name + " is disabled inside this worker");
      }
      try {
        Object.defineProperty(g, name, {
          value: denied,
          writable: false,
          configurable: false,
        });
      } catch (e) {
        try { g[name] = denied; } catch (e2) { /* frozen already */ }
      }
    })(blocked[i]);
  }
  try {
    if (g.navigator && typeof g.navigator.sendBeacon === "function") {
      g.navigator.sendBeacon = function () { return false; };
    }
  } catch (e) { /* navigator is read-only here */ }
  var noop = function () {};
  var quiet = {};
  var methods = ["log","info","warn","error","debug","trace","group","groupEnd",
                 "groupCollapsed","table","time","timeEnd","timeLog","assert",
                 "dir","dirxml","count","countReset","profile","profileEnd"];
  for (var j = 0; j < methods.length; j++) quiet[methods[j]] = noop;
  try {
    Object.defineProperty(g, "console", { value: quiet, writable: false, configurable: false });
  } catch (e) {
    try { g.console = quiet; } catch (e2) { /* leave it */ }
  }
})();
`;

/**
 * pdf.js needs its worker as a separate script. We cannot rely on shipping extra
 * files on mobile, so the worker source is inlined as a string and started from a
 * Blob URL at runtime — with the prelude above in front of it.
 */
const pdfWorkerPlugin = {
  name: "sealbox-pdf-worker",
  setup(build) {
    build.onResolve({ filter: /^sealbox:pdf-worker$/ }, () => ({
      path: "sealbox:pdf-worker",
      namespace: "sealbox-virtual",
    }));
    build.onLoad({ filter: /.*/, namespace: "sealbox-virtual" }, () => {
      const file = path.resolve(
        "node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs",
      );
      const source = fs.readFileSync(file, "utf8");
      return {
        contents: `${workerPrelude}${source}\n${WORKER_END}`,
        loader: "text",
      };
    });
  },
};

// No timestamp here. The banner is the first thing in main.js, so anything that
// changes between builds would make the released file differ from what the same
// sources produce — and the community directory checks exactly that. Byte-for-byte
// reproducibility is also how anyone can verify the release was built from this
// source and nothing else.
const { version } = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
const banner = `/* Sealbox ${version}. Do not edit; see src/. */`;

const ctx = await esbuild.context({
  banner: { js: banner },
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtins,
  ],
  format: "cjs",
  target: "es2020",
  // Keep non-ASCII as itself. esbuild otherwise escapes every Cyrillic character
  // into a \uXXXX sequence, which triples the size of the Russian dictionary and
  // makes the bundle impossible to eyeball. Obsidian loads main.js as UTF-8.
  charset: "utf8",
  logLevel: "info",
  sourcemap: false,
  treeShaking: true,
  // Strip every console.* call from release builds: the single most likely way
  // for plaintext to end up somewhere it should not be.
  drop: production ? ["console", "debugger"] : ["debugger"],
  minify: production,
  plugins: [pdfWorkerPlugin],
  outfile: path.join(outDir, "main.js"),
  define: {
    "process.env.NODE_ENV": production ? '"production"' : '"development"',
  },
});

fs.mkdirSync(outDir, { recursive: true });
for (const f of ["manifest.json", "styles.css"]) {
  if (fs.existsSync(f)) fs.copyFileSync(f, path.join(outDir, f));
}

if (production) {
  await ctx.rebuild();
  await ctx.dispose();
  const size = fs.statSync(path.join(outDir, "main.js")).size;
  console.log(`built ${(size / 1024).toFixed(0)} KiB -> ${outDir}`);
} else {
  await ctx.watch();
}
