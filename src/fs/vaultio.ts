/**
 * Vault file access.
 *
 * Everything goes through Obsidian's `DataAdapter`, never through Node's `fs`:
 * Node APIs do not exist in the Android WebView, and reaching for them is the
 * single most common reason an Obsidian plugin works on desktop only.
 */

import type { DataAdapter, Vault } from "obsidian";
import { log } from "../log.ts";

const TMP_SUFFIX = ".sealbox-tmp";
const OLD_SUFFIX = ".sealbox-old";

/** `writeBinary` wants an `ArrayBuffer`; views over a larger buffer must be copied. */
export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    return bytes.buffer as ArrayBuffer;
  }
  return bytes.slice().buffer as ArrayBuffer;
}

export async function readBytes(vault: Vault, path: string): Promise<Uint8Array> {
  const buf = await vault.adapter.readBinary(path);
  return new Uint8Array(buf);
}

/**
 * Write a file so that a crash or a mid-write sync snapshot can never leave a
 * half-file behind.
 *
 * tmp -> (old aside) -> rename into place -> drop old. Each step is a rename or
 * a whole-file write, so at every instant there is a complete copy on disk under
 * one of the three names. `recoverInterrupted` puts things right afterwards.
 *
 * This matters specifically for Syncthing: it happily propagates a file that is
 * still being written, and a truncated container is an unopenable container.
 */
export async function writeAtomic(
  adapter: DataAdapter,
  path: string,
  bytes: Uint8Array,
): Promise<void> {
  const tmp = path + TMP_SUFFIX;
  const old = path + OLD_SUFFIX;
  await adapter.writeBinary(tmp, toArrayBuffer(bytes));
  try {
    if (await adapter.exists(path)) {
      if (await adapter.exists(old)) await adapter.remove(old);
      await adapter.rename(path, old);
    }
    await adapter.rename(tmp, path);
    if (await adapter.exists(old)) await adapter.remove(old);
  } catch (e) {
    // Put the previous version back rather than leaving the user with nothing.
    try {
      if (!(await adapter.exists(path)) && (await adapter.exists(old))) {
        try {
          await adapter.rename(old, path);
        } catch {
          // Renaming *to this name* is what just failed, so retrying it is not a
          // recovery. Fall back to a plain write, a different operation that
          // often succeeds where the rename did not.
          const previous = await adapter.readBinary(old);
          await adapter.writeBinary(path, previous);
          await adapter.remove(old);
        }
      }
      if (await adapter.exists(tmp)) await adapter.remove(tmp);
    } catch (cleanupError) {
      log.error("could not clean up after a failed write", cleanupError);
    }
    throw e;
  }
}

/**
 * Repair the aftermath of a write interrupted by a crash or a kill.
 * Runs at plugin load. Returns the paths it touched, for the diagnostics screen.
 */
export async function recoverInterrupted(
  adapter: DataAdapter,
  listFolder: string,
): Promise<string[]> {
  const repaired: string[] = [];
  let listing: { files: string[]; folders: string[] };
  try {
    listing = await adapter.list(listFolder);
  } catch {
    return repaired;
  }
  for (const file of listing.files) {
    if (file.endsWith(OLD_SUFFIX)) {
      const target = file.slice(0, -OLD_SUFFIX.length);
      try {
        if (!(await adapter.exists(target))) {
          await adapter.rename(file, target);
          repaired.push(target);
        } else {
          await adapter.remove(file);
        }
      } catch (e) {
        log.warn("could not recover a file after an interrupted write", e);
      }
    } else if (file.endsWith(TMP_SUFFIX)) {
      // A temp file alone means the write never reached the rename; the
      // original is still in place, so the temp is garbage. It may hold
      // ciphertext, never plaintext, but remove it regardless.
      try {
        await adapter.remove(file);
      } catch (e) {
        log.warn("could not remove a leftover temp file", e);
      }
    }
  }
  for (const folder of listing.folders) {
    if (folder.startsWith(".")) continue;
    repaired.push(...(await recoverInterrupted(adapter, folder)));
  }
  return repaired;
}

/** Path that does not collide with anything already in the vault. */
export async function uniquePath(adapter: DataAdapter, desired: string): Promise<string> {
  if (!(await adapter.exists(desired))) return desired;
  const dot = desired.lastIndexOf(".");
  const stem = dot > 0 ? desired.slice(0, dot) : desired;
  const ext = dot > 0 ? desired.slice(dot) : "";
  for (let i = 1; i < 1000; i++) {
    const candidate = `${stem} ${i}${ext}`;
    if (!(await adapter.exists(candidate))) return candidate;
  }
  throw new Error("could not find a free file name");
}

export function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i <= 0 ? "" : path.slice(0, i);
}

export function basename(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? path : path.slice(i + 1);
}
