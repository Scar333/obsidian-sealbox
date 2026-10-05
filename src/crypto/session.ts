/**
 * The unlocked-vault session.
 *
 * Holds the master key for as long as the vault is unlocked and no longer. The
 * key is a non-extractable `CryptoKey`, so even code running in this process
 * cannot read its bytes back out — it can only ask WebCrypto to use it, and
 * only until `lock()` drops the reference.
 */

export type SessionState = "locked" | "unlocked";

export interface SessionOptions {
  /** Idle milliseconds before the vault locks itself. 0 disables the timer. */
  autoLockMs: number;
}

export class VaultLockedError extends Error {
  constructor() {
    super("the vault is locked");
  }
}

export class VaultSession {
  private masterKey: CryptoKey | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<(state: SessionState) => void>();
  private autoLockMs: number;

  constructor(options: SessionOptions) {
    this.autoLockMs = options.autoLockMs;
  }

  get state(): SessionState {
    return this.masterKey ? "unlocked" : "locked";
  }

  get isUnlocked(): boolean {
    return this.masterKey !== null;
  }

  unlock(masterKey: CryptoKey): void {
    this.masterKey = masterKey;
    this.restartTimer();
    this.emit();
  }

  /**
   * Drop the key and tell every listener to clear whatever it decrypted. Safe to
   * call when already locked, which matters because it runs from `onunload`,
   * from the idle timer and from the user's own command.
   */
  lock(): void {
    const wasUnlocked = this.masterKey !== null;
    this.masterKey = null;
    this.clearTimer();
    if (wasUnlocked) this.emit();
  }

  /** Get the key, or fail loudly. Callers must not cache the result. */
  requireKey(): CryptoKey {
    if (!this.masterKey) throw new VaultLockedError();
    this.restartTimer();
    return this.masterKey;
  }

  /** Register activity without needing the key, e.g. the user typed something. */
  touch(): void {
    if (this.masterKey) this.restartTimer();
  }

  setAutoLockMs(ms: number): void {
    this.autoLockMs = ms;
    if (this.masterKey) this.restartTimer();
  }

  onChange(listener: (state: SessionState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    const state = this.state;
    for (const listener of [...this.listeners]) {
      try {
        listener(state);
      } catch {
        // A listener that throws must not keep the vault unlocked, and must not
        // stop the other listeners from clearing their own plaintext.
      }
    }
  }

  private restartTimer(): void {
    this.clearTimer();
    if (this.autoLockMs > 0) {
      this.timer = setTimeout(() => this.lock(), this.autoLockMs);
    }
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

/**
 * Rate limiting for password attempts, held in memory only.
 *
 * Persisting it would be worse than useless: an attacker with the vault files
 * could edit the counter, while a legitimate user would be locked out after a
 * crash. In-memory delay only slows down someone at the keyboard, which is
 * exactly the threat it is for.
 */
export class AttemptThrottle {
  private failures = 0;

  async beforeAttempt(): Promise<void> {
    const delay = this.delayMs();
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
  }

  recordFailure(): void {
    this.failures = Math.min(this.failures + 1, 32);
  }

  recordSuccess(): void {
    this.failures = 0;
  }

  get failureCount(): number {
    return this.failures;
  }

  delayMs(): number {
    if (this.failures < 3) return 0;
    if (this.failures < 5) return 1000;
    if (this.failures < 10) return 5000;
    return 30000;
  }
}
