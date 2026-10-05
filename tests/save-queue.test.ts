/**
 * Tests for the save queue.
 *
 * This logic produced two user-visible bugs before it was pulled out into
 * something testable: a status line that claimed "saved" for text that had
 * already changed, and a follow-up write that silently did nothing and left the
 * note marked dirty in Preview mode. Both were races between an autosave, a blur
 * handler and Ctrl-S, so the tests below are all about ordering.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { SaveQueue } from "../src/views/editor/save-queue.ts";

/** A write that resolves when the test says so. */
function controllable() {
  const calls: Array<{ resolve: () => void; reject: (e: Error) => void }> = [];
  const write = () =>
    new Promise<void>((resolve, reject) => {
      calls.push({ resolve, reject });
    });
  return { write, calls };
}

const tick = () => new Promise<void>((r) => setImmediate(r));

test("one write at a time, however many requests arrive", async () => {
  const { write, calls } = controllable();
  const queue = new SaveQueue(write);

  const a = queue.request();
  const b = queue.request();
  const c = queue.request();
  await tick();

  assert.equal(calls.length, 1, "concurrent requests must not start parallel writes");
  assert.equal(queue.isRunning, true);

  calls[0].resolve();
  await tick();
  // The three requests collapsed into that one write plus one follow-up for the
  // requests that arrived while it was running.
  assert.equal(calls.length, 2);
  calls[1].resolve();
  await Promise.all([a, b, c]);

  assert.equal(queue.isRunning, false);
  assert.equal(queue.hasWork, false);
  assert.equal(calls.length, 2, "nothing further should have been queued");
});

test("every caller resolves only once the queue is empty", async () => {
  const { write, calls } = controllable();
  const queue = new SaveQueue(write);

  let firstDone = false;
  const first = queue.request().then(() => {
    firstDone = true;
  });
  await tick();

  // Someone asks again while the first write is still in flight — the case that
  // used to be dropped on the floor.
  const second = queue.request();
  await tick();
  assert.equal(firstDone, false, "must not resolve while work remains");

  calls[0].resolve();
  await tick();
  assert.equal(calls.length, 2, "the queued request must produce a second write");
  assert.equal(firstDone, false, "still not done: the follow-up is running");

  calls[1].resolve();
  await Promise.all([first, second]);
  assert.equal(firstDone, true);
  assert.equal(queue.hasWork, false, "the caller can now trust its own dirty flag");
});

test("requestAnother from inside a write schedules exactly one more pass", async () => {
  let passes = 0;
  let queue: SaveQueue;
  queue = new SaveQueue(async () => {
    passes++;
    // Simulates the user typing while the write was in flight.
    if (passes === 1) queue.requestAnother();
  });

  await queue.request();
  assert.equal(passes, 2);
  assert.equal(queue.hasWork, false);
});

test("hasWork is true from the moment a request is made", async () => {
  const { write, calls } = controllable();
  const queue = new SaveQueue(write);
  assert.equal(queue.hasWork, false);

  const done = queue.request();
  assert.equal(queue.hasWork, true, "a request must be visible before it starts");
  await tick();
  calls[0].resolve();
  await done;
  assert.equal(queue.hasWork, false);
});

test("a failed write rejects its callers and does not wedge the queue", async () => {
  const { write, calls } = controllable();
  const queue = new SaveQueue(write);

  const failing = queue.request();
  await tick();
  calls[0].reject(new Error("disk full"));
  await assert.rejects(failing, /disk full/);

  // The queue must still accept work afterwards, or one failed autosave would
  // make the note unsaveable until the view is reopened.
  assert.equal(queue.isRunning, false);
  const second = queue.request();
  await tick();
  assert.equal(calls.length, 2);
  calls[1].resolve();
  await second;
  assert.equal(queue.hasWork, false);
});

test("sequential requests each perform their own write", async () => {
  let passes = 0;
  const queue = new SaveQueue(async () => {
    passes++;
  });
  await queue.request();
  await queue.request();
  await queue.request();
  assert.equal(passes, 3);
});
