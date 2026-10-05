/**
 * Serialising saves.
 *
 * An autosave timer, a blur handler and Ctrl-S can all fire within a few
 * milliseconds of each other. Letting them run concurrently has produced two
 * separate user-visible bugs: two writes racing into one container, and a status
 * line reporting the wrong outcome because a queued write finished after the
 * state it was judged against had already moved on.
 *
 * The contract:
 *
 *  - only one write runs at a time;
 *  - a request made while a write is in flight causes one more write afterwards,
 *    rather than being dropped or starting a second one in parallel;
 *  - **every caller's promise resolves only once the queue is empty**, which is
 *    what lets the caller trust its own dirty flag immediately afterwards.
 *
 * No imports on purpose: this is the piece worth testing directly.
 */

export class SaveQueue {
  private running: Promise<void> | null = null;
  private requested = false;
  // An explicit field rather than a constructor parameter property: Node runs
  // the test suite by stripping types, and parameter properties are real syntax
  // it cannot strip.
  private readonly write: () => Promise<void>;

  constructor(write: () => Promise<void>) {
    this.write = write;
  }

  /** A write is in progress right now. */
  get isRunning(): boolean {
    return this.running !== null;
  }

  /** A write is running or queued. */
  get hasWork(): boolean {
    return this.requested || this.running !== null;
  }

  /**
   * Ask for a write, and wait until nothing is left to write.
   *
   * The loop also covers the awkward edge where a request arrives between a
   * drain finishing and its bookkeeping running — rechecking is cheaper than
   * reasoning about that window.
   *
   * This cannot spin: every iteration performs a real write, so continuing means
   * the content genuinely kept changing.
   */
  async request(): Promise<void> {
    this.requested = true;
    while (this.requested || this.running) {
      if (this.running) {
        await this.running;
        continue;
      }
      this.running = this.drain().finally(() => {
        this.running = null;
      });
      await this.running;
    }
  }

  /** Called from inside `write` when the content changed while it was writing. */
  requestAnother(): void {
    this.requested = true;
  }

  private async drain(): Promise<void> {
    while (this.requested) {
      this.requested = false;
      await this.write();
    }
  }
}
