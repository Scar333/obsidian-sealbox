/**
 * The secrets database: pure data handling, no Obsidian and no crypto.
 *
 * Everything here runs against a plain object that is only ever persisted inside
 * a `.sealed` container, so the file on disk is just another encrypted payload.
 */

export interface SecretHistoryItem {
  password: string;
  replaced: number;
}

/**
 * An extra field on an entry. `secret` fields are masked in the UI and kept out
 * of search, the same way the main password is.
 */
export interface SecretField {
  label: string;
  value: string;
  secret: boolean;
}

/**
 * What kind of thing an entry describes. Purely presentational: it picks the
 * icon, the labels and which extra fields a new entry starts with. The stored
 * shape is identical for all of them, so changing a template never invalidates
 * data, and an unknown id from a newer version degrades to "custom".
 */
export type SecretTemplateId = "site" | "card" | "server" | "custom";

export interface SecretEntry {
  id: string;
  template: SecretTemplateId;
  title: string;
  username: string;
  password: string;
  /** Several links per entry: a service often has a login page and a console. */
  urls: string[];
  note: string;
  group: string;
  tags: string[];
  extra: SecretField[];
  created: number;
  updated: number;
  history: SecretHistoryItem[];
}

export interface SecretsDb {
  v: 1;
  entries: SecretEntry[];
  updated: number;
}

export const UNGROUPED = "Ungrouped";

export function emptyDb(): SecretsDb {
  return { v: 1, entries: [], updated: Date.now() };
}

export function newId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function newEntry(partial: Partial<SecretEntry> = {}): SecretEntry {
  const now = Date.now();
  return {
    id: newId(),
    template: "custom",
    title: "",
    username: "",
    password: "",
    urls: [],
    note: "",
    group: UNGROUPED,
    tags: [],
    extra: [],
    created: now,
    updated: now,
    history: [],
    ...partial,
  };
}

/** The extra fields a new entry of each kind starts with. */
export const TEMPLATE_FIELDS: Record<SecretTemplateId, SecretField[]> = {
  site: [],
  card: [
    { label: "cardNumber", value: "", secret: true },
    { label: "cardExpiry", value: "", secret: false },
    { label: "cardCvc", value: "", secret: true },
    { label: "cardHolder", value: "", secret: false },
  ],
  server: [
    { label: "host", value: "", secret: false },
    { label: "port", value: "", secret: false },
    { label: "sshKey", value: "", secret: true },
  ],
  custom: [],
};

export const TEMPLATE_IDS: SecretTemplateId[] = ["site", "card", "server", "custom"];

export function isTemplateId(value: unknown): value is SecretTemplateId {
  return TEMPLATE_IDS.includes(value as SecretTemplateId);
}

export function entryFromTemplate(template: SecretTemplateId): SecretEntry {
  // Fresh copies: the table above must never be mutated through an entry.
  return newEntry({
    template,
    extra: TEMPLATE_FIELDS[template].map((field) => ({ ...field })),
  });
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** Accept whatever was in the container; never throw on a single bad entry. */
export function normalizeDb(raw: unknown): SecretsDb {
  if (typeof raw !== "object" || raw === null) return emptyDb();
  const r = raw as Record<string, unknown>;
  const entries: SecretEntry[] = [];
  const seen = new Set<string>();
  if (Array.isArray(r.entries)) {
    for (const item of r.entries) {
      if (typeof item !== "object" || item === null) continue;
      const e = item as Record<string, unknown>;
      const id = str(e.id) || newId();
      if (seen.has(id)) continue;
      seen.add(id);
      const now = Date.now();
      // `url` was a single string before an entry could hold several links;
      // carry it across rather than dropping what people already typed.
      const urls = Array.isArray(e.urls)
        ? e.urls.filter((u): u is string => typeof u === "string" && u.length > 0)
        : typeof e.url === "string" && e.url.length > 0
          ? [e.url]
          : [];
      entries.push({
        id,
        template: isTemplateId(e.template) ? e.template : "custom",
        title: str(e.title),
        username: str(e.username),
        password: str(e.password),
        urls,
        note: str(e.note),
        group: str(e.group, UNGROUPED) || UNGROUPED,
        tags: Array.isArray(e.tags) ? e.tags.filter((t): t is string => typeof t === "string") : [],
        extra: Array.isArray(e.extra)
          ? e.extra
              .filter((f): f is Record<string, unknown> => typeof f === "object" && f !== null)
              .map((f) => ({
                label: str(f.label),
                value: str(f.value),
                secret: f.secret === true,
              }))
          : [],
        created: num(e.created, now),
        updated: num(e.updated, now),
        history: Array.isArray(e.history)
          ? e.history
              .filter((h): h is Record<string, unknown> => typeof h === "object" && h !== null)
              .map((h) => ({ password: str(h.password), replaced: num(h.replaced, 0) }))
          : [],
      });
    }
  }
  return { v: 1, entries, updated: num(r.updated, Date.now()) };
}

export function touchEntry(entry: SecretEntry, changes: Partial<SecretEntry>): SecretEntry {
  const next: SecretEntry = { ...entry, ...changes, updated: Date.now() };
  // Keep the old password recoverable — overwriting one by accident is a common
  // and otherwise unrecoverable mistake.
  if (changes.password !== undefined && changes.password !== entry.password && entry.password) {
    next.history = [{ password: entry.password, replaced: Date.now() }, ...entry.history].slice(0, 10);
  }
  return next;
}

export function upsert(db: SecretsDb, entry: SecretEntry): SecretsDb {
  const index = db.entries.findIndex((e) => e.id === entry.id);
  const entries = [...db.entries];
  if (index >= 0) entries[index] = entry;
  else entries.push(entry);
  return { ...db, entries, updated: Date.now() };
}

export function remove(db: SecretsDb, id: string): SecretsDb {
  return { ...db, entries: db.entries.filter((e) => e.id !== id), updated: Date.now() };
}

export function groupsOf(db: SecretsDb): string[] {
  const groups = new Set<string>();
  for (const e of db.entries) groups.add(e.group || UNGROUPED);
  return [...groups].sort((a, b) => a.localeCompare(b));
}

export function search(db: SecretsDb, query: string, group: string | null): SecretEntry[] {
  const q = query.trim().toLowerCase();
  return db.entries
    .filter((e) => (group === null ? true : (e.group || UNGROUPED) === group))
    .filter((e) => {
      if (q.length === 0) return true;
      // Note bodies are searched too, but passwords deliberately are not: typing
      // a query should never be a way to confirm a password by elimination.
      return (
        e.title.toLowerCase().includes(q) ||
        e.username.toLowerCase().includes(q) ||
        e.urls.some((u) => u.toLowerCase().includes(q)) ||
        e.note.toLowerCase().includes(q) ||
        e.tags.some((t) => t.toLowerCase().includes(q)) ||
        // Labels always; values only when not marked secret. A masked field must
        // not become confirmable by typing guesses into the search box.
        e.extra.some(
          (f) =>
            f.label.toLowerCase().includes(q) ||
            (!f.secret && f.value.toLowerCase().includes(q)),
        )
      );
    })
    .sort((a, b) => a.title.localeCompare(b.title) || b.updated - a.updated);
}

export interface MergeResult {
  db: SecretsDb;
  /** Entries that differed on both sides; the newer one won. */
  conflicts: string[];
  added: number;
}

/**
 * Merge two databases entry by entry.
 *
 * This is what makes a Syncthing or git conflict survivable: the two files are
 * opaque ciphertext to the sync tool, so it cannot merge them, but once both are
 * decrypted the entries have ids and timestamps and can be reconciled. Without
 * this, resolving a conflict means picking one file and silently losing whatever
 * was only in the other.
 */
export function mergeDbs(mine: SecretsDb, theirs: SecretsDb): MergeResult {
  const byId = new Map<string, SecretEntry>();
  for (const e of mine.entries) byId.set(e.id, e);

  const conflicts: string[] = [];
  let added = 0;
  for (const other of theirs.entries) {
    const existing = byId.get(other.id);
    if (!existing) {
      byId.set(other.id, other);
      added++;
      continue;
    }
    if (entriesEqual(existing, other)) continue;
    conflicts.push(existing.title || other.title || other.id);
    if (other.updated > existing.updated) byId.set(other.id, other);
  }

  return {
    db: { v: 1, entries: [...byId.values()], updated: Date.now() },
    conflicts,
    added,
  };
}

/** A comparable rendering of the extra fields, separator-safe. */
function fieldsKey(fields: SecretField[]): string {
  return fields
    .map((f) => [f.label, f.value, String(f.secret)].join("\u001f"))
    .join("\u001e");
}

function entriesEqual(a: SecretEntry, b: SecretEntry): boolean {
  return (
    a.template === b.template &&
    a.title === b.title &&
    a.username === b.username &&
    a.password === b.password &&
    a.urls.join("\u001f") === b.urls.join("\u001f") &&
    a.note === b.note &&
    a.group === b.group &&
    a.tags.join(" ") === b.tags.join(" ") &&
    fieldsKey(a.extra) === fieldsKey(b.extra)
  );
}

export interface GeneratorOptions {
  length: number;
  lower: boolean;
  upper: boolean;
  digits: boolean;
  symbols: boolean;
  avoidAmbiguous: boolean;
}

export const DEFAULT_GENERATOR: GeneratorOptions = {
  length: 24,
  lower: true,
  upper: true,
  digits: true,
  symbols: true,
  avoidAmbiguous: true,
};

const AMBIGUOUS = new Set([..."Il1O0o|`'\"{}[]()/\\"]);

export function generatePassword(options: GeneratorOptions): string {
  let alphabet = "";
  if (options.lower) alphabet += "abcdefghijklmnopqrstuvwxyz";
  if (options.upper) alphabet += "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  if (options.digits) alphabet += "0123456789";
  if (options.symbols) alphabet += "!@#$%^&*()-_=+[]{};:,.?/";
  if (options.avoidAmbiguous) {
    alphabet = [...alphabet].filter((c) => !AMBIGUOUS.has(c)).join("");
  }
  if (alphabet.length === 0) throw new Error("no character classes selected");
  const length = Math.max(4, Math.min(256, Math.round(options.length)));

  // Rejection sampling: taking `random % alphabet.length` would bias the first
  // few characters of the alphabet, which is a real (if small) entropy loss.
  const limit = Math.floor(256 / alphabet.length) * alphabet.length;
  const out: string[] = [];
  const buffer = new Uint8Array(length * 2);
  while (out.length < length) {
    crypto.getRandomValues(buffer);
    for (const byte of buffer) {
      if (out.length >= length) break;
      if (byte >= limit) continue;
      out.push(alphabet[byte % alphabet.length]);
    }
  }
  return out.join("");
}

export function entropyBits(options: GeneratorOptions): number {
  let size = 0;
  if (options.lower) size += 26;
  if (options.upper) size += 26;
  if (options.digits) size += 10;
  if (options.symbols) size += 24;
  if (options.avoidAmbiguous) size = Math.max(10, size - 12);
  return Math.round(options.length * Math.log2(Math.max(size, 2)));
}

// --- sync-conflict folding ---------------------------------------------------

/**
 * Pick out the sync-conflict copies of a database file.
 *
 * Pure, and tested, because the consequence of a wrong answer here is deleting a
 * file that holds entries nothing else has. In particular the database's own path
 * must never match.
 */
export function conflictCandidates(paths: string[], dbPath: string): string[] {
  const base = (p: string) => {
    const i = p.lastIndexOf("/");
    return i < 0 ? p : p.slice(i + 1);
  };
  const dbName = base(dbPath);
  const stem = dbName.replace(/\.sealed$/, "");
  return paths.filter((p) => {
    const name = base(p);
    if (p === dbPath || name === dbName) return false;
    if (!name.startsWith(stem) || !name.endsWith(".sealed")) return false;
    // Syncthing writes "…sync-conflict-<date>-<id>.sealed"; some cloud clients
    // write "… (conflicted copy …)". Anything else is a file of the user's own.
    return name.includes("sync-conflict") || name.includes("conflicted copy");
  });
}

export interface ConflictFoldResult {
  db: SecretsDb;
  /** Paths whose contents are now in `db`, and only those, are safe to delete. */
  merged: string[];
  /** Paths that could not be read; these must be left alone. */
  failed: string[];
  conflicts: string[];
  added: number;
}

/**
 * Fold every readable conflict copy into the database.
 *
 * Returning `merged` as a list rather than a count is the whole point: if the
 * first copy fails to decrypt and the second succeeds, deleting "the first N"
 * would destroy the copy that was never merged.
 */
export async function foldConflicts(
  base: SecretsDb,
  candidates: string[],
  read: (path: string) => Promise<SecretsDb>,
): Promise<ConflictFoldResult> {
  let db = base;
  const merged: string[] = [];
  const failed: string[] = [];
  const conflicts: string[] = [];
  let added = 0;

  for (const candidate of candidates) {
    let theirs: SecretsDb;
    try {
      theirs = await read(candidate);
    } catch {
      failed.push(candidate);
      continue;
    }
    const result = mergeDbs(db, theirs);
    db = result.db;
    conflicts.push(...result.conflicts);
    added += result.added;
    merged.push(candidate);
  }

  return { db, merged, failed, conflicts, added };
}
