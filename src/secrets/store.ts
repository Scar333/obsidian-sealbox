/**
 * Persistence for the secrets database.
 *
 * The database is one `.sealed` container like any other, so it gets the same
 * AES-256-GCM, the same per-file key and the same atomic writes. Two extra
 * safeguards exist because this single file is the most concentrated thing in the
 * vault: a `.bak` copy of the previous version, and conflict merging.
 */

import { Notice } from "obsidian";
import { fromUtf8, utf8, zero } from "../crypto/bytes.ts";
import { defaultMeta } from "../crypto/seal.ts";
import type { SealboxHost } from "../host.ts";
import { log } from "../log.ts";
import { basename, dirname } from "../fs/vaultio.ts";
import { t } from "../i18n/index.ts";
import {
  conflictCandidates,
  emptyDb,
  foldConflicts,
  normalizeDb,
  type SecretsDb,
} from "./model.ts";

const BACKUP_SUFFIX = ".bak";

export class SecretsStore {
  private db: SecretsDb | null = null;

  constructor(private host: SealboxHost) {}

  private get path(): string {
    return this.host.settings.secretsPath;
  }

  private get adapter() {
    return this.host.app.vault.adapter;
  }

  /** Drop the decrypted database. Wired to the session lock. */
  forget(): void {
    this.db = null;
  }

  async exists(): Promise<boolean> {
    return this.adapter.exists(this.path);
  }

  async load(): Promise<SecretsDb> {
    if (this.db) return this.db;
    if (!(await this.exists())) {
      this.db = emptyDb();
      return this.db;
    }
    const { data } = await this.host.ops.readSealedAtPath(this.path);
    try {
      this.db = normalizeDb(JSON.parse(fromUtf8(data)));
      return this.db;
    } catch (e) {
      log.error("the secrets database could not be parsed", e);
      throw new Error(t("store.unreadable", { path: this.path + BACKUP_SUFFIX }));
    } finally {
      zero(data);
    }
  }

  async save(db: SecretsDb): Promise<void> {
    const payload = utf8(JSON.stringify(db));
    try {
      // Keep the previous container before replacing it. One generation is
      // enough to undo a bad merge or a mistaken bulk delete.
      if (await this.exists()) {
        const current = await this.adapter.readBinary(this.path);
        await this.adapter.writeBinary(this.path + BACKUP_SUFFIX, current);
      }
      await this.host.ops.writeSealed(
        this.path,
        payload,
        defaultMeta(basename(this.path).replace(/\.sealed$/, "") + ".json", "application/json", payload.length),
      );
      this.db = db;
    } finally {
      zero(payload);
    }
  }

  /**
   * Find sync-conflict copies of the database and fold them in.
   *
   * Syncthing writes `Secrets.sync-conflict-20260103-120000-ABCDEFG.sealed`;
   * git leaves its own artefacts. Either way the sync tool sees ciphertext and
   * cannot merge, so the merge has to happen here, after decryption.
   */
  async mergeConflicts(): Promise<number> {
    const folder = dirname(this.path);
    let listing: { files: string[]; folders: string[] };
    try {
      listing = await this.adapter.list(folder || "/");
    } catch {
      return 0;
    }

    const candidates = conflictCandidates(listing.files, this.path);
    if (candidates.length === 0) return 0;

    const outcome = await foldConflicts(await this.load(), candidates, async (path) => {
      const { data } = await this.host.ops.readSealedAtPath(path);
      try {
        return normalizeDb(JSON.parse(fromUtf8(data)));
      } finally {
        zero(data);
      }
    });

    for (const path of outcome.failed) {
      log.warn("could not read a conflict copy of the secrets database");
      new Notice(t("store.conflictUnreadable", { name: basename(path) }), 8000);
    }

    if (outcome.merged.length === 0) return 0;

    // Write the merged result first, and only then remove the copies that are
    // actually represented in it. A failure above never costs an entry.
    await this.save(outcome.db);
    for (const path of outcome.merged) {
      try {
        await this.adapter.remove(path);
      } catch (e) {
        log.warn("could not remove a merged conflict copy", e);
      }
    }

    const { merged, added, conflicts } = outcome;
    const summary = t("store.merged", { count: merged.length, added });
    const detail =
      conflicts.length > 0
        ? t("store.mergedConflicts", {
            edited: conflicts.length,
            titles:
              conflicts.slice(0, 3).join(", ") + (conflicts.length > 3 ? "…" : ""),
          })
        : "";
    new Notice(summary + detail, 15000);
    return merged.length;
  }
}
