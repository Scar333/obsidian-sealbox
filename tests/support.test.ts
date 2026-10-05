import { test } from "node:test";
import assert from "node:assert/strict";

import { fromBase64, toBase64, timingSafeEqual, randomBytes, zero } from "../src/crypto/bytes.ts";
import { scrub, describeError, userMessage } from "../src/log.ts";
import { normalizeSettings, resolveKdfParams, DEFAULT_SETTINGS } from "../src/settings.ts";
import { KDF_ARGON2ID, KDF_PBKDF2_SHA512 } from "../src/crypto/container.ts";
import {
  DEFAULT_GENERATOR,
  entropyBits,
  generatePassword,
  mergeDbs,
  newEntry,
  normalizeDb,
  remove,
  search,
  touchEntry,
  UNGROUPED,
  upsert,
  emptyDb,
  conflictCandidates,
  foldConflicts,
  entryFromTemplate,
  TEMPLATE_FIELDS,
} from "../src/secrets/model.ts";
import { writeAtomic, recoverInterrupted, uniquePath, toArrayBuffer } from "../src/fs/vaultio.ts";
import { estimateStrength } from "../src/ui/strength.ts";

// --- base64 ----------------------------------------------------------------

test("base64 round-trips every length and matches Node's implementation", () => {
  for (let len = 0; len < 40; len++) {
    const bytes = randomBytes(len);
    const encoded = toBase64(bytes);
    assert.equal(encoded, Buffer.from(bytes).toString("base64"), `length ${len}`);
    assert.deepEqual(fromBase64(encoded), bytes, `length ${len}`);
  }
});

test("base64 rejects junk but tolerates whitespace", () => {
  assert.deepEqual(fromBase64("AAEC"), new Uint8Array([0, 1, 2]));
  assert.deepEqual(fromBase64("AA EC\n"), new Uint8Array([0, 1, 2]));
  assert.throws(() => fromBase64("AA$EC"), /invalid base64/);
});

test("randomBytes works past the 65 536-byte getRandomValues limit", () => {
  for (const length of [0, 1, 65535, 65536, 65537, 200000]) {
    assert.equal(randomBytes(length).length, length, `length ${length}`);
  }

  // Every 64 KiB window must actually have been filled, including the last
  // partial one. Checked on a buffer whose shortest window is thousands of bytes:
  // asserting "not all zero" on a one-byte tail would fail once every 256 runs,
  // which is how this test was originally written and duly went red.
  const big = randomBytes(200000);
  for (let offset = 0; offset < big.length; offset += 65536) {
    const window = big.subarray(offset, Math.min(offset + 65536, big.length));
    assert.ok(window.length >= 3000, `window at ${offset} is too short to judge`);
    assert.ok(window.some((b) => b !== 0), `window at ${offset} was left zeroed`);
  }
});

test("timingSafeEqual compares contents, not references", () => {
  assert.equal(timingSafeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2])), true);
  assert.equal(timingSafeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3])), false);
  assert.equal(timingSafeEqual(new Uint8Array([1]), new Uint8Array([1, 2])), false);
});

// --- log scrubbing ---------------------------------------------------------

test("scrub redacts key material and labelled secrets", () => {
  const blob = toBase64(randomBytes(48));
  assert.ok(!scrub(`container ${blob} written`).includes(blob));
  assert.equal(scrub("password: hunter2"), "password=<redacted>");
  assert.equal(scrub("recovery_key = ABCDE-FGHIJ"), "recovery_key=<redacted>");
  assert.ok(!scrub("key 0123456789abcdef0123456789abcdef").includes("0123456789abcdef"));
  assert.ok(!scrub("ABCDE-FGHJK-MNPQR-STVWX").includes("ABCDE-FGHJK"));
  // Ordinary messages must survive unchanged, or the logs become useless.
  assert.equal(scrub("could not seal notes/report.pdf"), "could not seal notes/report.pdf");
});

test("describeError never stringifies an unknown thrown value", () => {
  const secret = new Uint8Array([1, 2, 3]);
  assert.equal(describeError(secret), "an unknown error occurred");
  assert.match(describeError(new RangeError("too big")), /^RangeError: too big/);
  assert.equal(userMessage(new Error("password: swordfish")), "password=<redacted>");
});

// --- settings --------------------------------------------------------------

test("normalizeSettings clamps and sanitises whatever was on disk", () => {
  assert.deepEqual(normalizeSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(normalizeSettings("nonsense"), DEFAULT_SETTINGS);

  const s = normalizeSettings({
    autoLockMinutes: -5,
    chunkKiB: 99999,
    clipboardClearSeconds: 1e9,
    maxMobileMiB: 0,
    kdfProfile: "bogus",
    originalHandling: "nope",
    secretsPath: "/../../etc/passwd",
  });
  assert.equal(s.autoLockMinutes, 0);
  assert.equal(s.chunkKiB, 8192);
  assert.equal(s.clipboardClearSeconds, 3600);
  assert.equal(s.maxMobileMiB, 1);
  assert.equal(s.kdfProfile, "auto");
  assert.equal(s.originalHandling, "trash");
  // Must not escape the vault, and must stay a sealed container.
  assert.equal(s.secretsPath.includes(".."), false);
  assert.equal(s.secretsPath.startsWith("/"), false);
  assert.ok(s.secretsPath.endsWith(".sealed"));
});

test("resolveKdfParams falls back to PBKDF2 when Argon2id is unavailable", () => {
  const settings = { ...DEFAULT_SETTINGS };
  assert.equal(resolveKdfParams(settings, false, true).id, KDF_ARGON2ID);
  assert.equal(resolveKdfParams(settings, false, false).id, KDF_PBKDF2_SHA512);
  assert.equal(
    resolveKdfParams({ ...settings, kdfProfile: "pbkdf2" }, false, true).id,
    KDF_PBKDF2_SHA512,
  );
  // The mobile profile must cost less memory than the desktop one.
  assert.ok(
    resolveKdfParams(settings, true, true).memoryKiB <
      resolveKdfParams(settings, false, true).memoryKiB,
  );
});

test("the strength meter rates obvious passwords as weak", () => {
  assert.equal(estimateStrength("").tone, "weak");
  assert.equal(estimateStrength("password1").tone, "weak");
  assert.equal(estimateStrength("12345678").tone, "weak");
  assert.equal(estimateStrength("aaaaaaaaaaaaaaaa").tone, "weak");
  assert.equal(estimateStrength("correct horse battery staple!7").tone, "strong");
});

// --- secrets model ---------------------------------------------------------

test("entries are created, updated, searched and removed", () => {
  let db = emptyDb();
  const a = newEntry({
    title: "GitHub",
    username: "scar",
    urls: ["https://github.com"],
    group: "Dev",
  });
  const b = newEntry({ title: "Bank", username: "12345", note: "branch code 7" });
  db = upsert(upsert(db, a), b);
  assert.equal(db.entries.length, 2);

  assert.deepEqual(search(db, "github", null).map((e) => e.title), ["GitHub"]);
  assert.deepEqual(search(db, "branch", null).map((e) => e.title), ["Bank"]);
  assert.deepEqual(search(db, "", "Dev").map((e) => e.title), ["GitHub"]);
  assert.deepEqual(search(db, "", UNGROUPED).map((e) => e.title), ["Bank"]);

  db = remove(db, a.id);
  assert.equal(db.entries.length, 1);
});

test("searching never matches on the password itself", () => {
  const entry = newEntry({ title: "Thing", password: "zzzUNIQUEzzz" });
  const db = upsert(emptyDb(), entry);
  assert.equal(search(db, "zzzUNIQUEzzz", null).length, 0);
});

test("replacing a password keeps the old one in history", () => {
  const entry = newEntry({ title: "X", password: "first" });
  const updated = touchEntry(entry, { password: "second" });
  assert.equal(updated.password, "second");
  assert.equal(updated.history.length, 1);
  assert.equal(updated.history[0].password, "first");

  // Editing another field must not add a history item.
  const renamed = touchEntry(updated, { title: "Y" });
  assert.equal(renamed.history.length, 1);
});

test("normalizeDb survives a damaged database", () => {
  const db = normalizeDb({
    entries: [
      null,
      "nope",
      { id: "dup", title: "A" },
      { id: "dup", title: "duplicate id" },
      { title: "no id at all" },
      { id: "weird", tags: ["ok", 5, null], history: ["junk", { password: "p", replaced: 1 }] },
    ],
  });
  assert.equal(db.entries.length, 3, "bad rows dropped, duplicate id ignored");
  const weird = db.entries.find((e) => e.id === "weird");
  assert.deepEqual(weird?.tags, ["ok"]);
  assert.equal(weird?.history.length, 1);
  assert.equal(db.entries.find((e) => e.id === "dup")?.title, "A");
});

test("mergeDbs keeps both sides and lets the newer edit win", () => {
  const shared = newEntry({ title: "Shared", password: "old" });
  const mineOnly = newEntry({ title: "Mine" });
  const theirsOnly = newEntry({ title: "Theirs" });

  const mine = upsert(upsert(emptyDb(), shared), mineOnly);
  const theirsEdited = { ...shared, password: "new", updated: shared.updated + 1000 };
  const theirs = upsert(upsert(emptyDb(), theirsEdited), theirsOnly);

  const result = mergeDbs(mine, theirs);
  assert.equal(result.db.entries.length, 3, "nothing may be lost in a merge");
  assert.equal(result.added, 1);
  assert.deepEqual(result.conflicts, ["Shared"]);
  assert.equal(result.db.entries.find((e) => e.id === shared.id)?.password, "new");

  // And the other direction: an older remote edit must not overwrite a newer local one.
  const reverse = mergeDbs(theirs, mine);
  assert.equal(reverse.db.entries.find((e) => e.id === shared.id)?.password, "new");
});

test("mergeDbs reports no conflict for identical entries", () => {
  const entry = newEntry({ title: "Same" });
  const result = mergeDbs(upsert(emptyDb(), entry), upsert(emptyDb(), { ...entry }));
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.db.entries.length, 1);
});

test("the password generator honours its options and stays unbiased", () => {
  const pw = generatePassword(DEFAULT_GENERATOR);
  assert.equal(pw.length, DEFAULT_GENERATOR.length);
  assert.ok(!/[Il1O0o]/.test(pw), "ambiguous characters must be excluded");

  const digits = generatePassword({ ...DEFAULT_GENERATOR, lower: false, upper: false, symbols: false });
  assert.match(digits, /^[2-9]+$/);

  assert.throws(() =>
    generatePassword({ ...DEFAULT_GENERATOR, lower: false, upper: false, digits: false, symbols: false }),
  );

  // Distribution sanity check: with rejection sampling no character should take
  // a wildly disproportionate share.
  const counts = new Map<string, number>();
  for (let i = 0; i < 200; i++) {
    for (const ch of generatePassword({ ...DEFAULT_GENERATOR, length: 32 })) {
      counts.set(ch, (counts.get(ch) ?? 0) + 1);
    }
  }
  const values = [...counts.values()];
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  assert.ok(Math.max(...values) < mean * 2.5, "character distribution looks skewed");
  assert.ok(entropyBits(DEFAULT_GENERATOR) > 100);
});

// --- atomic writes ---------------------------------------------------------

/** In-memory stand-in for Obsidian's DataAdapter, enough for the write path. */
class FakeAdapter {
  files = new Map<string, Uint8Array>();
  failRenameTo: string | null = null;

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }
  async writeBinary(path: string, data: ArrayBuffer): Promise<void> {
    this.files.set(path, new Uint8Array(data));
  }
  async readBinary(path: string): Promise<ArrayBuffer> {
    const f = this.files.get(path);
    if (!f) throw new Error(`missing ${path}`);
    return toArrayBuffer(f);
  }
  async remove(path: string): Promise<void> {
    this.files.delete(path);
  }
  async rename(from: string, to: string): Promise<void> {
    if (this.failRenameTo === to) throw new Error("simulated rename failure");
    const f = this.files.get(from);
    if (!f) throw new Error(`missing ${from}`);
    this.files.set(to, f);
    this.files.delete(from);
  }
  async list(folder: string): Promise<{ files: string[]; folders: string[] }> {
    const prefix = folder === "/" || folder === "" ? "" : `${folder}/`;
    const files: string[] = [];
    const folders = new Set<string>();
    for (const path of this.files.keys()) {
      if (!path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length);
      const slash = rest.indexOf("/");
      if (slash < 0) files.push(path);
      else folders.add(prefix + rest.slice(0, slash));
    }
    return { files, folders: [...folders] };
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asAdapter = (a: FakeAdapter) => a as any;

test("writeAtomic replaces a file and leaves no debris", async () => {
  const adapter = new FakeAdapter();
  await writeAtomic(asAdapter(adapter), "a.sealed", new Uint8Array([1, 2, 3]));
  assert.deepEqual(adapter.files.get("a.sealed"), new Uint8Array([1, 2, 3]));

  await writeAtomic(asAdapter(adapter), "a.sealed", new Uint8Array([9]));
  assert.deepEqual(adapter.files.get("a.sealed"), new Uint8Array([9]));
  assert.deepEqual([...adapter.files.keys()], ["a.sealed"], "temp files must be cleaned up");
});

test("a failed write restores the previous version instead of losing it", async () => {
  const adapter = new FakeAdapter();
  await writeAtomic(asAdapter(adapter), "a.sealed", new Uint8Array([1]));
  adapter.failRenameTo = "a.sealed";

  await assert.rejects(() => writeAtomic(asAdapter(adapter), "a.sealed", new Uint8Array([2])));
  assert.deepEqual(
    adapter.files.get("a.sealed"),
    new Uint8Array([1]),
    "the old version must still be there after a failed write",
  );
  assert.equal(adapter.files.has("a.sealed.sealbox-tmp"), false);
  assert.equal(adapter.files.has("a.sealed.sealbox-old"), false);
});

test("recoverInterrupted restores a crash that happened mid-rename", async () => {
  const adapter = new FakeAdapter();
  // Simulate the window between "old aside" and "temp into place".
  adapter.files.set("notes/a.sealed.sealbox-old", new Uint8Array([7]));
  adapter.files.set("notes/a.sealed.sealbox-tmp", new Uint8Array([8]));

  const repaired = await recoverInterrupted(asAdapter(adapter), "/");
  assert.deepEqual(repaired, ["notes/a.sealed"]);
  assert.deepEqual(adapter.files.get("notes/a.sealed"), new Uint8Array([7]));
  assert.equal(adapter.files.has("notes/a.sealed.sealbox-tmp"), false);
});

test("recoverInterrupted keeps the live file when both exist", async () => {
  const adapter = new FakeAdapter();
  adapter.files.set("a.sealed", new Uint8Array([1]));
  adapter.files.set("a.sealed.sealbox-old", new Uint8Array([2]));
  await recoverInterrupted(asAdapter(adapter), "/");
  assert.deepEqual(adapter.files.get("a.sealed"), new Uint8Array([1]));
  assert.equal(adapter.files.has("a.sealed.sealbox-old"), false);
});

test("uniquePath never overwrites an existing file", async () => {
  const adapter = new FakeAdapter();
  adapter.files.set("doc.pdf.sealed", new Uint8Array());
  adapter.files.set("doc.pdf 1.sealed", new Uint8Array());
  assert.equal(await uniquePath(asAdapter(adapter), "doc.pdf.sealed"), "doc.pdf 2.sealed");
  assert.equal(await uniquePath(asAdapter(adapter), "fresh.sealed"), "fresh.sealed");
});

// --- sync-conflict folding -------------------------------------------------

test("conflictCandidates never matches the database itself", () => {
  const db = "notes/Secrets.sealed";
  const files = [
    "notes/Secrets.sealed",
    "notes/Secrets.sealed.bak",
    "notes/Secrets.sync-conflict-20260103-120000-ABCDEFG.sealed",
    "notes/Secrets (conflicted copy 2026-01-03).sealed",
    "notes/Secrets notes.sealed",
    "notes/Other.sync-conflict-20260103-120000-ABCDEFG.sealed",
  ];
  assert.deepEqual(conflictCandidates(files, db), [
    "notes/Secrets.sync-conflict-20260103-120000-ABCDEFG.sealed",
    "notes/Secrets (conflicted copy 2026-01-03).sealed",
  ]);
  // A vault whose only file is the database must produce nothing to delete.
  assert.deepEqual(conflictCandidates([db], db), []);
});

test("foldConflicts only reports copies it actually merged", async () => {
  const mine = newEntry({ title: "Mine" });
  const fromA = newEntry({ title: "From A" });
  const fromB = newEntry({ title: "From B" });
  const base = upsert(emptyDb(), mine);

  // The FIRST copy fails and the second succeeds. Reporting a count instead of
  // the list would delete the unreadable copy and keep the merged one — exactly
  // backwards, and it would lose whatever only the first copy had.
  const result = await foldConflicts(base, ["a.sealed", "b.sealed"], async (path) => {
    if (path === "a.sealed") throw new Error("cannot decrypt");
    return upsert(emptyDb(), fromB);
  });

  assert.deepEqual(result.merged, ["b.sealed"]);
  assert.deepEqual(result.failed, ["a.sealed"]);
  assert.equal(result.added, 1);
  assert.deepEqual(
    result.db.entries.map((e) => e.title).sort(),
    ["From B", "Mine"],
  );
  assert.ok(!result.merged.includes("a.sealed"), "an unmerged copy must never be deletable");

  // And when every copy reads, all of them are merged and reported.
  const allGood = await foldConflicts(base, ["a.sealed", "b.sealed"], async (path) =>
    upsert(emptyDb(), path === "a.sealed" ? fromA : fromB),
  );
  assert.deepEqual(allGood.merged, ["a.sealed", "b.sealed"]);
  assert.deepEqual(allGood.failed, []);
  assert.equal(allGood.db.entries.length, 3);
});

test("foldConflicts leaves the database untouched when nothing can be read", async () => {
  const base = upsert(emptyDb(), newEntry({ title: "Only" }));
  const result = await foldConflicts(base, ["x.sealed"], async () => {
    throw new Error("nope");
  });
  assert.deepEqual(result.merged, []);
  assert.deepEqual(result.failed, ["x.sealed"]);
  assert.deepEqual(result.db.entries.map((e) => e.title), ["Only"]);
});

test("the sidebar icon toggles default to on and survive a bad config", () => {
  assert.equal(DEFAULT_SETTINGS.ribbonSecrets, true);
  assert.equal(DEFAULT_SETTINGS.ribbonLock, true);
  assert.equal(DEFAULT_SETTINGS.ribbonEncrypt, true);

  // Only an explicit false turns an icon off, so a config written by an older
  // version (which has no such keys) keeps every icon rather than losing them.
  assert.equal(normalizeSettings({}).ribbonLock, true);
  assert.equal(normalizeSettings({ ribbonLock: false }).ribbonLock, false);
  assert.equal(normalizeSettings({ ribbonLock: "nonsense" }).ribbonLock, true);
  assert.equal(normalizeSettings({ ribbonEncrypt: false }).ribbonEncrypt, false);
});

// --- zero() is a cleanup primitive and must never throw ---------------------

test("zero wipes what it owns", () => {
  const a = new Uint8Array([1, 2, 3]);
  const b = new Uint8Array([4, 5]);
  zero(a, null, undefined, b);
  assert.deepEqual(a, new Uint8Array([0, 0, 0]));
  assert.deepEqual(b, new Uint8Array([0, 0]));
  zero(new Uint8Array(0)); // must not throw on an empty buffer
});

test("zero survives a buffer that was transferred to a worker", () => {
  // This is the real failure that shipped: pdf.js transfers the buffer it is
  // given to its worker, which detaches the ArrayBuffer on this side. `fill`
  // then throws, and because this runs on the teardown path it took down both
  // the plaintext wipe on lock and Obsidian's file switch — the tab could not
  // be left at all.
  const transferred = new Uint8Array([1, 2, 3, 4]);
  structuredClone(transferred.buffer, { transfer: [transferred.buffer] });
  assert.equal(transferred.byteLength, 0, "the buffer should now be detached");
  assert.throws(() => transferred.fill(0), TypeError, "fill must still throw directly");

  // zero() must absorb that, and must keep wiping the buffers after it.
  const alsoSecret = new Uint8Array([9, 9, 9]);
  zero(transferred, alsoSecret);
  assert.deepEqual(
    alsoSecret,
    new Uint8Array([0, 0, 0]),
    "a detached buffer must not stop the rest of the wipe",
  );
});

// --- entry templates, links and custom fields -------------------------------

test("an entry created from a template starts with that template's fields", () => {
  const card = entryFromTemplate("card");
  assert.equal(card.template, "card");
  assert.deepEqual(
    card.extra.map((f) => f.label),
    ["cardNumber", "cardExpiry", "cardCvc", "cardHolder"],
  );
  // The number and CVC are masked; the expiry and holder are not.
  assert.deepEqual(
    card.extra.map((f) => f.secret),
    [true, false, true, false],
  );
  assert.deepEqual(entryFromTemplate("site").extra, []);
  assert.deepEqual(entryFromTemplate("custom").extra, []);

  // Each entry gets its own copies, or editing one would edit the template and
  // every entry made from it afterwards.
  const a = entryFromTemplate("server");
  const b = entryFromTemplate("server");
  a.extra[0].value = "example.com";
  assert.equal(b.extra[0].value, "");
  assert.equal(TEMPLATE_FIELDS.server[0].value, "");
});

test("a database written before multiple links keeps the single url", () => {
  const db = normalizeDb({
    entries: [
      { id: "old", title: "Legacy", url: "https://example.com" },
      { id: "empty", title: "No link", url: "" },
      { id: "new", title: "Modern", urls: ["https://a.test", "https://b.test"] },
      { id: "junk", title: "Bad", urls: ["https://ok.test", 5, null] },
    ],
  });
  const byId = (id: string) => db.entries.find((e) => e.id === id);
  assert.deepEqual(byId("old")?.urls, ["https://example.com"]);
  assert.deepEqual(byId("empty")?.urls, []);
  assert.deepEqual(byId("new")?.urls, ["https://a.test", "https://b.test"]);
  assert.deepEqual(byId("junk")?.urls, ["https://ok.test"]);
  // An unknown template id from a future version must not throw.
  assert.equal(normalizeDb({ entries: [{ id: "x", template: "spaceship" }] }).entries[0].template, "custom");
});

test("search covers links and open custom fields, but never masked values", () => {
  const entry = newEntry({
    title: "Server",
    urls: ["https://console.example.com"],
    extra: [
      { label: "Host", value: "db.internal", secret: false },
      { label: "Recovery phrase", value: "zzzSECRETzzz", secret: true },
    ],
  });
  const db = upsert(emptyDb(), entry);

  assert.equal(search(db, "console.example", null).length, 1, "links are searchable");
  assert.equal(search(db, "db.internal", null).length, 1, "open field values are searchable");
  assert.equal(search(db, "Recovery", null).length, 1, "field labels are searchable");
  assert.equal(
    search(db, "zzzSECRETzzz", null).length,
    0,
    "a masked value must not be confirmable through the search box",
  );
});

test("merging notices changes to links, fields and template", () => {
  const base = newEntry({ title: "Thing", urls: ["https://a.test"] });
  const mine = upsert(emptyDb(), base);

  const sameContent = upsert(emptyDb(), { ...base });
  assert.deepEqual(mergeDbs(mine, sameContent).conflicts, [], "identical entries are not conflicts");

  for (const changed of [
    { ...base, urls: ["https://b.test"], updated: base.updated + 1 },
    { ...base, extra: [{ label: "PIN", value: "1234", secret: true }], updated: base.updated + 1 },
    { ...base, template: "site" as const, updated: base.updated + 1 },
  ]) {
    const result = mergeDbs(mine, upsert(emptyDb(), changed));
    assert.deepEqual(result.conflicts, ["Thing"], `change to ${Object.keys(changed).join()} must be seen`);
    assert.equal(result.db.entries.length, 1);
  }
});

test("the quick-add ribbon icon is on by default and survives an old config", () => {
  assert.equal(DEFAULT_SETTINGS.ribbonQuickAdd, true);
  // A config written before this icon existed has no such key: it must appear,
  // not silently stay hidden.
  assert.equal(normalizeSettings({ ribbonLock: false }).ribbonQuickAdd, true);
  assert.equal(normalizeSettings({ ribbonQuickAdd: false }).ribbonQuickAdd, false);
});
