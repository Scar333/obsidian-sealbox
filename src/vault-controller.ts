/**
 * Ties the keyring on disk to the in-memory session: first-run setup, unlocking,
 * password changes and recovery.
 */

import { App, Notice, Platform } from "obsidian";
import { utf8, zero } from "./crypto/bytes.ts";
import { SealedAuthError } from "./crypto/container.ts";
import {
  attachRecoveryKey,
  changeMasterPassword,
  createKeyring,
  describeKeyringKdf,
  KEYRING_FILENAME,
  KeyringDamagedError,
  resetPasswordWithRecoveryKey,
  unlockKeyring,
  unlockWithRecoveryKey,
  validateKeyring,
  type KeyringFile,
} from "./crypto/keyring.ts";
import { describeKdf, probeArgon2, type KdfParams } from "./crypto/kdf.ts";
import { AttemptThrottle, VaultSession } from "./crypto/session.ts";
import { generateRecoveryKey, parseRecoveryKey } from "./crypto/recovery.ts";
import { writeAtomic } from "./fs/vaultio.ts";
import { log, userMessage } from "./log.ts";
import { resolveKdfParams, type SealboxSettings } from "./settings.ts";
import { askPassword } from "./ui/password-modal.ts";
import { t } from "./i18n/index.ts";

/** Raised when a keyring must not be touched because sync left a second copy. */
class SyncConflictError extends Error {}

export interface SetUpResult {
  /** False when the user cancelled the password dialog. */
  created: boolean;
  /** Set only when setup was asked to produce a recovery key as well. */
  recoveryKey?: string;
}

export class VaultController {
  readonly session: VaultSession;
  private throttle = new AttemptThrottle();
  private keyring: KeyringFile | null = null;
  private argon2Available: boolean | null = null;
  private unlockInFlight: Promise<CryptoKey | null> | null = null;

  constructor(
    private app: App,
    private manifestDir: string,
    private getSettings: () => SealboxSettings,
  ) {
    this.session = new VaultSession({
      autoLockMs: this.getSettings().autoLockMinutes * 60_000,
    });
  }

  get keyringPath(): string {
    return `${this.manifestDir}/${KEYRING_FILENAME}`;
  }

  get isUnlocked(): boolean {
    return this.session.isUnlocked;
  }

  async hasKeyring(): Promise<boolean> {
    return this.app.vault.adapter.exists(this.keyringPath);
  }

  /**
   * Whether Argon2id actually works on this device. Probed once with cheap
   * parameters; the real cost comes from the settings.
   */
  async isArgon2Available(): Promise<boolean> {
    if (this.argon2Available === null) {
      const probe = await probeArgon2({
        id: 1,
        memoryKiB: 1024,
        time: 1,
        lanes: 1,
        iterations: 0,
      });
      this.argon2Available = probe.available;
      if (!probe.available) {
        log.warn("Argon2id is unavailable here; falling back to PBKDF2", probe.error);
      }
    }
    return this.argon2Available;
  }

  async kdfParams(): Promise<KdfParams> {
    return resolveKdfParams(
      this.getSettings(),
      Platform.isMobile,
      await this.isArgon2Available(),
    );
  }

  async loadKeyring(): Promise<KeyringFile> {
    if (this.keyring) return this.keyring;
    const raw = await this.app.vault.adapter.read(this.keyringPath);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new KeyringDamagedError(t("crypto.keyringNotJson"));
    }
    this.keyring = validateKeyring(parsed);
    return this.keyring;
  }

  private async saveKeyring(file: KeyringFile): Promise<void> {
    await this.guardKeyringConflicts();
    await writeAtomic(
      this.app.vault.adapter,
      this.keyringPath,
      utf8(JSON.stringify(file, null, 2)),
    );
    this.keyring = file;
  }

  /**
   * Syncthing and git both resolve a keyring conflict by leaving a second file
   * next to it. Overwriting without looking could destroy the only copy that
   * still wraps the real master key, so we refuse and let the user decide.
   */
  private async guardKeyringConflicts(): Promise<void> {
    const adapter = this.app.vault.adapter;
    try {
      const listing = await adapter.list(this.manifestDir);
      const conflicts = listing.files.filter(
        (f) => f.includes("sync-conflict") && f.includes(KEYRING_FILENAME.replace(".json", "")),
      );
      if (conflicts.length > 0) {
        throw new SyncConflictError(t("keyring.conflict", { count: conflicts.length }));
      }
    } catch (e) {
      if (e instanceof SyncConflictError) throw e;
      // A failed listing is not a reason to block a legitimate save.
    }
  }

  /**
   * Create the keyring on first use.
   *
   * `withRecoveryKey` makes the recovery key here, while the password is still
   * in hand. Asking for the password again one dialog after setting it reads
   * like a bug, and this is the path taken when the user's first action is
   * "create a recovery key" on a vault that has no master password yet.
   */
  async setUp(options: { withRecoveryKey?: boolean } = {}): Promise<SetUpResult> {
    const params = await this.kdfParams();
    const password = await askPassword(this.app, {
      title: t("setup.title"),
      description: t("setup.description", { kdf: describeKdf(params) }),
      confirm: true,
      showStrength: true,
      submitLabel: t("setup.submit"),
    });
    if (!password) return { created: false };
    try {
      const { file, masterKey } = await createKeyring(password, params);
      let toStore = file;
      let recoveryKey: string | undefined;
      if (options.withRecoveryKey) {
        const generated = await generateRecoveryKey();
        try {
          toStore = await attachRecoveryKey(file, password, generated.raw);
          recoveryKey = generated.display;
        } finally {
          zero(generated.raw);
        }
      }
      await this.saveKeyring(toStore);
      this.session.unlock(masterKey);
      new Notice(t("setup.done"));
      return recoveryKey === undefined
        ? { created: true }
        : { created: true, recoveryKey };
    } finally {
      zero(password);
    }
  }

  /**
   * Return a usable master key, prompting if needed.
   *
   * Concurrent callers share one prompt: opening three sealed files at once
   * must not stack three password dialogs.
   */
  async ensureUnlocked(): Promise<CryptoKey | null> {
    if (this.session.isUnlocked) return this.session.requireKey();
    if (this.unlockInFlight) return this.unlockInFlight;
    this.unlockInFlight = this.doUnlock().finally(() => {
      this.unlockInFlight = null;
    });
    return this.unlockInFlight;
  }

  private async doUnlock(): Promise<CryptoKey | null> {
    if (!(await this.hasKeyring())) {
      return (await this.setUp()).created ? this.session.requireKey() : null;
    }
    const keyring = await this.loadKeyring();
    const params = describeKeyringKdf(keyring);

    for (;;) {
      const delay = this.throttle.delayMs();
      const password = await askPassword(this.app, {
        title: t("unlock.title"),
        description: t("unlock.kdf", { kdf: describeKdf(params) }),
        ...(delay > 0
          ? {
              warning: t("unlock.throttled", {
                count: this.throttle.failureCount,
                seconds: Math.round(delay / 1000),
              }),
            }
          : {}),
      });
      if (!password) return null;
      await this.throttle.beforeAttempt();
      try {
        const masterKey = await unlockKeyring(keyring, password);
        this.throttle.recordSuccess();
        this.session.unlock(masterKey);
        return masterKey;
      } catch (e) {
        if (e instanceof SealedAuthError) {
          this.throttle.recordFailure();
          new Notice(t("unlock.wrongPassword"));
          continue;
        }
        throw e;
      } finally {
        zero(password);
      }
    }
  }

  lock(): void {
    this.session.lock();
  }

  applySettings(settings: SealboxSettings): void {
    this.session.setAutoLockMs(settings.autoLockMinutes * 60_000);
  }

  /** Forget the cached keyring, e.g. after it changed underneath us via sync. */
  invalidateKeyringCache(): void {
    this.keyring = null;
  }

  /**
   * Change the master password, and rotate the recovery key with it.
   *
   * Returns the new recovery key to display, or null if there was none to
   * replace or the user backed out. The rotation is not optional: a recovery key
   * is a second way into the same master key, so a password change that left it
   * alone would not actually revoke anyone's access.
   */
  async changePassword(): Promise<string | null> {
    if (!(await this.hasKeyring())) {
      new Notice(t("notice.notSetUp"), 10000);
      return null;
    }
    const keyring = await this.loadKeyring();
    const params = await this.kdfParams();
    const hadRecoveryKey = keyring.recovery !== undefined;

    const oldPassword = await askPassword(this.app, {
      title: t("password.current.title"),
      submitLabel: t("common.continue"),
    });
    if (!oldPassword) return null;

    let newPassword: Uint8Array | null = null;
    const replacement = hadRecoveryKey ? await generateRecoveryKey() : null;
    try {
      newPassword = await askPassword(this.app, {
        title: t("password.new.title"),
        description: t("password.new.description"),
        ...(hadRecoveryKey ? { warning: t("password.new.revokesRecovery") } : {}),
        confirm: true,
        showStrength: true,
        submitLabel: t("password.new.submit"),
      });
      if (!newPassword) return null;

      const updated = await changeMasterPassword(
        keyring,
        oldPassword,
        newPassword,
        params,
        replacement ? { newRecoveryKeyRaw: replacement.raw } : {},
      );
      await this.saveKeyring(updated);
      new Notice(t("password.changed"));
      if (replacement) {
        new Notice(t("recovery.rotated"), 12000);
        return replacement.display;
      }
      return null;
    } catch (e) {
      new Notice(t("password.changeFailed", { error: userMessage(e) }));
      log.warn("password change failed", e);
      return null;
    } finally {
      zero(oldPassword, newPassword, replacement?.raw);
    }
  }

  /**
   * Create (or replace) the recovery key and show it once.
   *
   * Returns the display string so the caller can render the "write this down"
   * screen; it is never written to disk by us. Replacing an existing key is how
   * a leaked one is revoked, which is why this stays repeatable — it just needs
   * the master password every time.
   */
  async createRecoveryKey(): Promise<string | null> {
    // A vault with no master password yet has no master key to wrap. Creating it
    // is the natural first step rather than an error: this is the most likely
    // very first thing a new user clicks.
    if (!(await this.hasKeyring())) {
      return (await this.setUp({ withRecoveryKey: true })).recoveryKey ?? null;
    }
    const keyring = await this.loadKeyring();
    const password = await askPassword(this.app, {
      title: t("recovery.confirmPassword.title"),
      description: t("recovery.confirmPassword.description"),
      submitLabel: t("common.continue"),
    });
    if (!password) return null;
    const generated = await generateRecoveryKey();
    try {
      const updated = await attachRecoveryKey(keyring, password, generated.raw);
      await this.saveKeyring(updated);
      return generated.display;
    } catch (e) {
      new Notice(t("recovery.createFailed", { error: userMessage(e) }));
      return null;
    } finally {
      zero(password, generated.raw);
    }
  }

  /**
   * Whether a recovery key is configured.
   *
   * Async on purpose: the keyring may not have been read yet, and answering
   * "no recovery key" from an unloaded cache would tell the user the opposite of
   * the truth on exactly the screen where it matters most.
   */
  async hasRecoveryKey(): Promise<boolean> {
    if (!(await this.hasKeyring())) return false;
    try {
      return (await this.loadKeyring()).recovery !== undefined;
    } catch {
      return false;
    }
  }

  async unlockWithRecovery(recoveryKeyText: string): Promise<boolean> {
    if (!(await this.hasKeyring())) {
      new Notice(t("notice.notSetUp"), 10000);
      return false;
    }
    const keyring = await this.loadKeyring();
    let raw: Uint8Array | null = null;
    try {
      raw = await parseRecoveryKey(recoveryKeyText);
      const masterKey = await unlockWithRecoveryKey(keyring, raw);
      this.session.unlock(masterKey);
      new Notice(t("recovery.unlocked"));
      return true;
    } catch (e) {
      new Notice(userMessage(e));
      return false;
    } finally {
      zero(raw);
    }
  }

  async resetPasswordWithRecovery(recoveryKeyText: string): Promise<boolean> {
    if (!(await this.hasKeyring())) {
      new Notice(t("notice.notSetUp"), 10000);
      return false;
    }
    const keyring = await this.loadKeyring();
    const params = await this.kdfParams();
    let raw: Uint8Array | null = null;
    let newPassword: Uint8Array | null = null;
    try {
      raw = await parseRecoveryKey(recoveryKeyText);
      newPassword = await askPassword(this.app, {
        title: t("password.new.title"),
        confirm: true,
        showStrength: true,
        submitLabel: t("recovery.newPassword.submit"),
      });
      if (!newPassword) return false;
      const updated = await resetPasswordWithRecoveryKey(keyring, raw, newPassword, params);
      await this.saveKeyring(updated);
      new Notice(t("recovery.passwordReset"));
      return true;
    } catch (e) {
      new Notice(userMessage(e));
      return false;
    } finally {
      zero(raw, newPassword);
    }
  }
}
