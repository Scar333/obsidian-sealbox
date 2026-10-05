/** Extension <-> media type mapping, and which viewer can show a payload. */

export type ViewerKind = "markdown" | "text" | "image" | "pdf" | "none";

const MIME_BY_EXT: Record<string, string> = {
  md: "text/markdown",
  markdown: "text/markdown",
  txt: "text/plain",
  csv: "text/csv",
  json: "application/json",
  xml: "application/xml",
  yml: "application/yaml",
  yaml: "application/yaml",
  log: "text/plain",
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  zip: "application/zip",
  "7z": "application/x-7z-compressed",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
};

export function extensionOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i + 1).toLowerCase();
}

export function mimeFor(name: string): string {
  return MIME_BY_EXT[extensionOf(name)] ?? "application/octet-stream";
}

export function viewerFor(mime: string, name: string): ViewerKind {
  const ext = extensionOf(name);
  if (mime === "text/markdown" || ext === "md" || ext === "markdown") return "markdown";
  if (mime === "application/pdf" || ext === "pdf") return "pdf";
  if (mime === "image/svg+xml") return "image";
  if (mime.startsWith("image/")) return "image";
  if (
    mime.startsWith("text/") ||
    mime === "application/json" ||
    mime === "application/xml" ||
    mime === "application/yaml"
  ) {
    return "text";
  }
  return "none";
}

export function isEditable(kind: ViewerKind): boolean {
  return kind === "markdown" || kind === "text";
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MiB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
}
