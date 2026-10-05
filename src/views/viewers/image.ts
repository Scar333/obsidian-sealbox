/**
 * Image viewer.
 *
 * The decrypted bytes become a Blob URL, which is handed to an `<img>`. Two
 * details matter for safety:
 *
 *  - The URL is revoked on teardown. A Blob URL keeps its data alive for as long
 *    as it exists, so a leaked one is decrypted data left in the process.
 *  - SVG is rendered through `<img>` rather than inserted into the DOM, so any
 *    script inside a (possibly untrusted) SVG never runs.
 */

import { t } from "../../i18n/index.ts";

export interface ViewerHandle {
  destroy(): void;
}

export function renderImage(
  container: HTMLElement,
  data: Uint8Array,
  mime: string,
): ViewerHandle {
  const blob = new Blob([data as unknown as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);

  const wrap = container.createDiv({ cls: "sealbox-image-wrap" });
  const img = wrap.createEl("img", { cls: "sealbox-image" });
  img.src = url;
  img.alt = "";

  let zoomed = false;
  img.addEventListener("click", () => {
    zoomed = !zoomed;
    img.toggleClass("is-zoomed", zoomed);
  });
  img.addEventListener("error", () => {
    wrap.empty();
    wrap.createEl("p", {
      cls: "sealbox-error",
      text: t("viewer.image.unsupported"),
    });
  });

  return {
    destroy() {
      img.src = "";
      URL.revokeObjectURL(url);
      wrap.remove();
    },
  };
}
