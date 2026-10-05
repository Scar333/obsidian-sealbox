/**
 * The only option set pdf.js is ever started with.
 *
 * Kept in its own import-free module so a test can assert its contents directly.
 * Every field here is load-bearing:
 *
 *  - `isEvalSupported: false` — pdf.js otherwise compiles font programs with
 *    `eval`. Giving up a little font fidelity is the right trade in a plugin that
 *    handles data you do not want executed.
 *  - `useWorkerFetch: false` — stops the worker fetching anything itself.
 *  - `disableAutoFetch` / `disableStream` — no speculative range requests.
 *  - `verbosity: 0` — pdf.js logs through `console.log` from inside the worker,
 *    where the build's console stripping cannot reach. Its info and warning lines
 *    can describe a document's structure and fonts.
 *  - **No `url`, `cMapUrl` or `standardFontDataUrl`.** These are the three ways a
 *    PDF's own contents could cause an outbound request. We always hand pdf.js a
 *    buffer and leave the URL options unset, so there is nowhere to fetch from.
 *    A PDF must never be able to phone home: that would turn a viewer into an
 *    exfiltration channel.
 */

export const PDF_SAFE_OPTIONS = Object.freeze({
  isEvalSupported: false,
  useSystemFonts: false,
  useWorkerFetch: false,
  disableAutoFetch: true,
  disableStream: true,
  verbosity: 0,
});

/** Option names that would let a document reach the network. Asserted by tests. */
export const FORBIDDEN_PDF_OPTIONS = Object.freeze([
  "url",
  "cMapUrl",
  "standardFontDataUrl",
  "iccUrl",
  "wasmUrl",
]);
