/**
 * On-device diagnostics.
 *
 * This exists because the realistic way to debug Obsidian on Android is not to
 * attach a USB debugger — it is to run the checks on the phone and read the
 * result. Everything here is a self-test of the plugin's own machinery, so the
 * report contains timings and yes/no answers and never any vault content.
 */

import { App, Modal, Notice, Platform, apiVersion } from "obsidian";
import { bs, randomBytes, zero } from "../crypto/bytes.ts";
import { SealedAuthError } from "../crypto/container.ts";
import { importHkdfBase } from "../crypto/hkdf.ts";
import { defaultMeta, seal, unseal } from "../crypto/seal.ts";
import { describeKdf, probeArgon2, PBKDF2_FALLBACK, type KdfParams } from "../crypto/kdf.ts";
import type { SealboxHost } from "../host.ts";
import { describeError, log, scrub } from "../log.ts";
import { formatBytes } from "../mime.ts";
import { writeAtomic } from "../fs/vaultio.ts";
import { pdfLibrary } from "../views/viewers/pdf.ts";
import { t } from "../i18n/index.ts";
import { runAction, runQuietly } from "./run.ts";
import { PDF_SAFE_OPTIONS } from "../views/viewers/pdf-options.ts";
import { probeRichEditor } from "../views/editor/index.ts";
import { utf8 } from "../crypto/bytes.ts";

export interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

const REPORT_PATH = "sealbox-diagnostics.md";

async function check(name: string, fn: () => Promise<string>): Promise<CheckResult> {
  try {
    return { name, ok: true, detail: await fn() };
  } catch (e) {
    return { name, ok: false, detail: describeError(e) };
  }
}

/** AES-256-GCM via WebCrypto: without this nothing else can work. */
async function checkWebCrypto(): Promise<string> {
  if (typeof crypto === "undefined" || !crypto.subtle) throw new Error("crypto.subtle is missing");
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ]);
  const iv = randomBytes(12);
  const plain = utf8("sealbox self test");
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: bs(iv) }, key, bs(plain));
  const back = new Uint8Array(
    await crypto.subtle.decrypt({ name: "AES-GCM", iv: bs(iv) }, key, ct),
  );
  if (new TextDecoder().decode(back) !== "sealbox self test") {
    throw new Error("round trip produced different bytes");
  }
  return t("diag.result.webcrypto");
}

/**
 * Full format self-test: the same round-trip and tamper-detection assertions the
 * desktop test suite makes, run on whatever device is in your hand.
 */
async function checkContainerFormat(cascade: boolean): Promise<string> {
  const raw = randomBytes(32);
  const masterKey = await importHkdfBase(raw);
  zero(raw);
  const source = { kind: "vault" as const, masterKey };

  const sizes = [0, 1, 1024, 16 * 1024 + 7];
  for (const size of sizes) {
    const plain = randomBytes(size);
    const container = await seal(plain, defaultMeta("t.bin", "application/octet-stream", size), source, {
      chunkKiB: 16,
      cascade,
    });
    const out = await unseal(container, source);
    if (out.data.length !== size) throw new Error(`size ${size}: length mismatch`);
    for (let i = 0; i < size; i++) {
      if (out.data[i] !== plain[i]) throw new Error(`size ${size}: byte ${i} differs`);
    }
    zero(out.data, plain);
  }

  // Tampering must be rejected, not silently tolerated.
  const plain = randomBytes(40 * 1024);
  const container = await seal(plain, defaultMeta("t.bin", "application/octet-stream", plain.length), source, {
    chunkKiB: 16,
    cascade,
  });
  zero(plain);
  const bad = container.slice();
  bad[bad.length - 1] ^= 0x01;
  let rejected = false;
  try {
    await unseal(bad, source);
  } catch (e) {
    rejected = e instanceof SealedAuthError;
  }
  if (!rejected) throw new Error(t("diag.error.flippedBit"));

  let truncationRejected = false;
  try {
    await unseal(container.subarray(0, container.length - (16 * 1024 + 16)), source);
  } catch {
    truncationRejected = true;
  }
  if (!truncationRejected) throw new Error(t("diag.error.truncation"));

  return cascade ? t("diag.result.formatCascade") : t("diag.result.format");
}

async function checkWasm(): Promise<string> {
  if (typeof WebAssembly === "undefined") throw new Error("WebAssembly is not available");
  // Smallest valid module: the magic number plus a version.
  const bytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
  await WebAssembly.instantiate(bytes);
  return t("diag.result.wasm");
}

async function checkArgon2(params: KdfParams): Promise<string> {
  const probe = await probeArgon2(params);
  if (!probe.available) throw new Error(probe.error ?? "Argon2id did not produce a hash");
  return t("diag.result.kdf", { kdf: describeKdf(params), ms: probe.milliseconds });
}

async function checkPbkdf2(): Promise<string> {
  const probe = await probeArgon2(PBKDF2_FALLBACK);
  if (!probe.available) throw new Error(probe.error ?? "PBKDF2 failed");
  return t("diag.result.kdf", {
    kdf: describeKdf(PBKDF2_FALLBACK),
    ms: probe.milliseconds,
  });
}

async function checkAesThroughput(): Promise<string> {
  const raw = randomBytes(32);
  const masterKey = await importHkdfBase(raw);
  zero(raw);
  const size = Platform.isMobile ? 4 * 1024 * 1024 : 16 * 1024 * 1024;
  const plain = randomBytes(size);
  const started = Date.now();
  const container = await seal(plain, defaultMeta("bench.bin", "application/octet-stream", size), {
    kind: "vault",
    masterKey,
  });
  const sealed = Date.now() - started;
  const openStart = Date.now();
  const out = await unseal(container, { kind: "vault", masterKey });
  const opened = Date.now() - openStart;
  zero(out.data, plain);
  const mib = size / (1024 * 1024);
  return t("diag.result.throughput", {
    size: formatBytes(size),
    sealMs: sealed,
    sealRate: (mib / (sealed / 1000)).toFixed(0),
    openMs: opened,
    openRate: (mib / (opened / 1000)).toFixed(0),
  });
}

/**
 * Does the bundled pdf.js worker start? Feeding it deliberate garbage is enough:
 * a parse error proves the worker ran, while a worker that cannot start fails
 * with something else entirely.
 */
async function checkPdfWorker(): Promise<string> {
  const pdfjs = pdfLibrary();
  try {
    await pdfjs.getDocument({
      ...PDF_SAFE_OPTIONS,
      data: utf8("not a pdf at all"),
    }).promise;
    return t("diag.result.pdfLenient");
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    const message = e instanceof Error ? e.message : "";
    if (name === "InvalidPDFException" || /invalid pdf|unexpected server response|structure/i.test(message)) {
      return t("diag.result.pdfOk");
    }
    throw new Error(t("diag.error.pdf", { error: describeError(e) }));
  }
}

/** Can this device start the CodeMirror editor, or will notes fall back? */
async function checkRichEditor(): Promise<string> {
  const probe = await probeRichEditor();
  if (!probe.available) {
    throw new Error(t("diag.error.editor", { error: probe.error ?? "no detail" }));
  }
  return t("diag.result.editorOk");
}

function platformLine(): string {
  const bits = [
    `Obsidian API ${apiVersion}`,
    Platform.isMobile ? "mobile" : "desktop",
    Platform.isAndroidApp ? "Android" : Platform.isIosApp ? "iOS" : Platform.isMacOS ? "macOS" : Platform.isWin ? "Windows" : "Linux",
  ];
  return bits.join(" · ");
}

export async function runDiagnostics(host: SealboxHost): Promise<CheckResult[]> {
  const params = await host.controller.kdfParams();
  const results: CheckResult[] = [];
  results.push({ name: t("diag.check.platform"), ok: true, detail: platformLine() });
  results.push(await check(t("diag.check.webcrypto"), checkWebCrypto));
  results.push(await check(t("diag.check.wasm"), checkWasm));
  results.push(await check(t("diag.check.argon2"), () => checkArgon2(params)));
  results.push(await check(t("diag.check.pbkdf2"), checkPbkdf2));
  results.push(await check(t("diag.check.format"), () => checkContainerFormat(false)));
  results.push(
    await check(t("diag.check.formatCascade"), () => checkContainerFormat(true)),
  );
  results.push(await check(t("diag.check.throughput"), checkAesThroughput));
  results.push(await check(t("diag.check.pdf"), checkPdfWorker));
  results.push(await check(t("diag.check.editor"), checkRichEditor));
  return results;
}

export class DiagnosticsModal extends Modal {
  private results: CheckResult[] = [];

  constructor(
    app: App,
    private host: SealboxHost,
  ) {
    super(app);
  }

  override async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.addClass("sealbox-modal");
    contentEl.createEl("h3", { text: t("diag.title") });
    contentEl.createEl("p", { cls: "sealbox-muted sealbox-small", text: t("diag.intro") });
    const status = contentEl.createEl("p", { text: t("diag.running") });
    const list = contentEl.createEl("div", { cls: "sealbox-checks" });

    this.results = await runDiagnostics(this.host);
    status.remove();

    for (const result of this.results) {
      const row = list.createDiv({ cls: "sealbox-check" });
      row.createEl("span", {
        cls: result.ok ? "sealbox-check-ok" : "sealbox-check-fail",
        text: result.ok ? "✓" : "✗",
      });
      const body = row.createDiv();
      body.createEl("div", { cls: "sealbox-check-name", text: result.name });
      body.createEl("div", { cls: "sealbox-small sealbox-muted", text: result.detail });
    }

    const failed = this.results.filter((r) => !r.ok);
    contentEl.createEl("p", {
      cls: failed.length === 0 ? "sealbox-ok" : "sealbox-warning",
      text:
        failed.length === 0
          ? t("diag.allPassed")
          : t("diag.someFailed", {
              count: failed.length,
              names: failed.map((f) => f.name).join(", "),
            }),
    });

    const buttons = contentEl.createDiv({ cls: "sealbox-buttons" });
    const save = buttons.createEl("button", {
      text: t("diag.save", { path: REPORT_PATH }),
      cls: "mod-cta",
    });
    save.addEventListener("click", () =>
      runAction("save diagnostics report", () => this.saveReport()),
    );
    const copy = buttons.createEl("button", { text: t("diag.copy") });
    copy.addEventListener("click", () =>
      runQuietly("copy diagnostics report", async () => {
        try {
          await navigator.clipboard.writeText(this.reportText());
          new Notice(t("diag.copied"));
        } catch {
          new Notice(t("diag.copyFailed"));
        }
      }),
    );
  }

  private reportText(): string {
    const lines = [
      `# ${t("diag.title")}`,
      "",
      t("diag.report.generated", { timestamp: new Date().toISOString() }),
      "",
      `| ${t("diag.report.colCheck")} | ${t("diag.report.colResult")} | ${t("diag.report.colDetail")} |`,
      "| --- | --- | --- |",
      ...this.results.map((r) => {
        const verdict = r.ok ? t("diag.report.pass") : t("diag.report.fail");
        const detail = r.detail.replace(/\|/g, "\\|").replace(/\n/g, " ");
        return `| ${r.name} | ${verdict} | ${detail} |`;
      }),
      "",
      t("diag.report.footer"),
    ];
    // Nothing here is supposed to need scrubbing; running it anyway means a future
    // check that accidentally includes a path or a blob cannot leak through a file
    // the user is likely to share.
    return scrub(lines.join("\n"));
  }

  private async saveReport(): Promise<void> {
    try {
      await writeAtomic(this.app.vault.adapter, REPORT_PATH, utf8(this.reportText()));
      new Notice(t("diag.saved", { path: REPORT_PATH }));
    } catch (e) {
      log.error("could not save the diagnostics report", e);
      new Notice(t("diag.saveFailed"));
    }
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
