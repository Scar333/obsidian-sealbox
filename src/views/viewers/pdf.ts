/**
 * PDF viewer.
 *
 * Obsidian ships its own pdf.js, but it is not part of the plugin API and moves
 * between releases, so we bundle our own. Two constraints shaped this file:
 *
 *  - On Android, `<iframe src="blob:…pdf">` renders nothing: the WebView has no
 *    built-in PDF plugin. Pages therefore have to be drawn onto a canvas.
 *  - The worker cannot be shipped as a separate file we can rely on loading on
 *    mobile, so its source is inlined at build time and started from a Blob URL.
 *
 * `isEvalSupported: false` keeps pdf.js from evaluating font programs with
 * `eval`, which is worth giving up a little font fidelity for in a plugin whose
 * whole job is handling data you do not want leaking.
 */

import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import workerSource from "sealbox:pdf-worker";
import { zero } from "../../crypto/bytes.ts";
import { log } from "../../log.ts";
import { runQuietly } from "../../ui/run.ts";
import { PDF_SAFE_OPTIONS } from "./pdf-options.ts";
import type { ViewerHandle } from "./image.ts";
import { t } from "../../i18n/index.ts";

/** Hard cap so a hostile or broken file cannot spin forever. */
const MAX_PAGES = 2000;

let workerUrl: string | null = null;
let worker: Worker | null = null;

function ensureWorker(): void {
  if (worker) return;
  workerUrl = URL.createObjectURL(
    new Blob([workerSource], { type: "text/javascript" }),
  );
  try {
    worker = new Worker(workerUrl, { type: "module" });
  } catch {
    // Older WebViews reject module workers; the bundled worker also runs as a
    // classic script.
    worker = new Worker(workerUrl);
  }
  pdfjs.GlobalWorkerOptions.workerPort = worker;
  // pdf.js logs info/warning lines through console.log from inside the worker,
  // where our build-time console stripping cannot reach. Those lines can describe
  // a document's structure and fonts, so every getDocument call below passes
  // `verbosity: 0`, which is what the worker actually honours.
}

/**
 * The pdf.js module with its worker already started. Used by the diagnostics
 * screen, which needs to know whether the worker comes up at all on this device.
 */
export function pdfLibrary(): typeof pdfjs {
  ensureWorker();
  return pdfjs;
}

/** Called when the plugin unloads, so the worker does not outlive it. */
export function disposePdfWorker(): void {
  worker?.terminate();
  worker = null;
  if (workerUrl) {
    URL.revokeObjectURL(workerUrl);
    workerUrl = null;
  }
}

export async function renderPdf(
  container: HTMLElement,
  data: Uint8Array,
): Promise<ViewerHandle> {
  ensureWorker();

  const wrap = container.createDiv({ cls: "sealbox-pdf" });
  const toolbar = wrap.createDiv({ cls: "sealbox-pdf-toolbar" });
  const pagesEl = wrap.createDiv({ cls: "sealbox-pdf-pages" });

  let scale = 1.2;
  let destroyed = false;
  const observers: IntersectionObserver[] = [];

  // pdf.js takes ownership of the buffer it is given and detaches it, so hand it
  // a copy: the caller still needs its plaintext for "save" and for wiping.
  const copy = data.slice();

  // See pdf-options.ts for why each flag is there. Always a buffer, never a URL.
  const doc = await pdfjs.getDocument({ ...PDF_SAFE_OPTIONS, data: copy }).promise;

  const pageCount = Math.min(doc.numPages, MAX_PAGES);
  if (doc.numPages > MAX_PAGES) {
    wrap.createEl("p", {
      cls: "sealbox-warning",
      text: t("viewer.pdf.pageLimit", { total: doc.numPages, shown: MAX_PAGES }),
    });
  }

  const pagesLabel = () => t("viewer.pdf.pages", { count: pageCount });
  const label = toolbar.createSpan({ cls: "sealbox-muted", text: pagesLabel() });
  const zoomOut = toolbar.createEl("button", { text: "−" });
  const zoomIn = toolbar.createEl("button", { text: "+" });

  const slots: Array<{ el: HTMLElement; rendered: boolean }> = [];

  /** Draw one page, but only once and only while still mounted. */
  const drawPage = async (index: number) => {
    const slot = slots[index];
    if (!slot || slot.rendered || destroyed) return;
    slot.rendered = true;
    try {
      const page = await doc.getPage(index + 1);
      if (destroyed) return;
      const viewport = page.getViewport({ scale });
      const canvas = createEl("canvas");
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("canvas is unavailable");
      ctx.scale(ratio, ratio);
      await page.render({ canvasContext: ctx, viewport }).promise;
      if (destroyed) {
        // The vault locked while this page was rendering: throw the pixels away
        // instead of putting decrypted content on screen.
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        return;
      }
      slot.el.empty();
      slot.el.appendChild(canvas);
      page.cleanup();
    } catch (e) {
      log.warn("could not render a PDF page", e);
      slot.el.setText(t("viewer.pdf.pageFailed", { page: index + 1 }));
    }
  };

  const build = () => {
    pagesEl.empty();
    slots.length = 0;
    for (const observer of observers.splice(0)) observer.disconnect();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const index = Number((entry.target as HTMLElement).dataset.page);
          void drawPage(index);
        }
      },
      { root: pagesEl, rootMargin: "400px" },
    );
    observers.push(observer);

    for (let i = 0; i < pageCount; i++) {
      const slot = pagesEl.createDiv({ cls: "sealbox-pdf-page" });
      slot.dataset.page = String(i);
      slot.setText(t("viewer.pdf.pagePlaceholder", { page: i + 1 }));
      slots.push({ el: slot, rendered: false });
      observer.observe(slot);
    }
    // Lazy rendering keeps a 500-page scan from allocating 500 canvases at once,
    // which is the difference between working and being killed on a phone.
    void drawPage(0);
  };

  const rescale = (next: number) => {
    scale = Math.min(4, Math.max(0.4, next));
    label.setText(
      t("viewer.pdf.pagesZoom", { pages: pagesLabel(), percent: Math.round(scale * 100) }),
    );
    build();
  };
  zoomIn.addEventListener("click", () => rescale(scale * 1.25));
  zoomOut.addEventListener("click", () => rescale(scale / 1.25));

  build();

  return {
    destroy() {
      destroyed = true;
      for (const observer of observers.splice(0)) observer.disconnect();
      pagesEl.empty();
      // `copy` was transferred to the worker by getDocument, so the buffer here
      // is detached; `zero` handles that rather than throwing. The worker's own
      // copy is freed by destroying the document.
      zero(copy);
      runQuietly("destroy pdf document", () => doc.destroy());
      wrap.remove();
    },
  };
}
