// ---------------------------------------------------------------------------
// UserVault — the user's markdown vault, owned by their UserHost Durable
// Object. One vault per user, and the host IS it: the manifest is a table in
// this object's own SQLite, the bytes are R2 objects under this object's own
// name. One object, one lock, one transaction domain — there is no second
// object to coordinate with, so there is no distributed write to get wrong.
//
// LIVENESS NEEDS NO WATCHER. The Durable Object is the ONLY writer: the
// manifest IS the listing, it is always current, and every mutation fires
// `onChanged` for the host to broadcast. There is nothing to crawl and nothing
// to watch.
//
// CONCURRENCY:
// mutations run through `runExclusive`, an in-memory promise-chain mutex, and
// SQLite's synchronous API makes a version read + bump atomic inside it. Reads
// stay concurrent, and no storage gate is ever held across R2 I/O.
//
// WRITE ORDERING (crash consistency): bytes reach R2 BEFORE the manifest row
// commits, and a permanent purge removes the manifest row BEFORE the R2 object.
// Either way the manifest never points at a missing blob — the tolerable
// failure is an orphan blob, never a dangling pointer.
//
// DELETE IS A TOMBSTONE, not a removal. There is no OS trash to hand a file to,
// and something has to take its place: undoing an agent-CREATED note is a
// delete, so with no trash tier every such undo would be permanent. A
// tombstoned row keeps its bytes for `TRASH_RETENTION_MS` and is purged by the
// host's alarm.
// ---------------------------------------------------------------------------

import type { HeldDeletions, VaultEntry, VaultFileFacts } from "@repo/bridge/ipc-registry";
import { isDocPath } from "@repo/notes/knowledge/doc-file";
import { basenamePath } from "@repo/notes/knowledge/vault-path";

import { sha256Hex } from "../../hash";
import { parseVaultPath, type VaultKey } from "./vault-key";

/**
 * What the workspace boot bundle answers, and what rides on every
 * `onVaultChanged`.
 *
 * There is one vault per account and no folder to choose, so this is a LABEL
 * rather than a path. The workspace derives the sidebar's folder name from its
 * last segment, which is the only thing it does with the value.
 */
export const VAULT_ROOT = "/Vault";

/** How long a tombstone survives before the sweep purges it for good. Long
 * enough that a mistaken delete is still recoverable a month later, short
 * enough that deleted bytes are not billed forever. */
const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Deletion gate — ONE guard, in the object every writer goes through.
//
// It asks the one question no listing can answer wrongly: is the SIZE of this
// deletion consistent with a human having asked for it? Because it sits in the
// object rather than on a device, the browser, the agent and the HTTP upload
// route are all held by one gate with one number, and a confirmation is one act
// rather than one per client.
//
// It reads a COUNT, never a cause. A bug that sheds one path per call sits far
// below the floor and passes straight through. This layer BOUNDS the blast
// radius of a mass delete; it does not detect one — say it that way and never
// as detection.
//
// The count is accumulated over a rolling window rather than judged per call,
// because a caller deleting one file at a time in a loop is the shape this
// deployment can actually produce and a per-call gate would never see it. The
// window drains on its own, so a user who is genuinely purging waits it out or
// confirms; a restore removes its file from the window, so undoing pressure
// releases it.
// ---------------------------------------------------------------------------
const MIN_HELD_DELETIONS = 25;
const HELD_DELETION_SHARE = 0.05;
const DELETION_WINDOW_MS = 10 * 60 * 1000;

/** Largest asset the host will read back inline as base64. Past this an
 * inline preview is the wrong affordance anyway. */
const MAX_INLINE_READ_BYTES = 10 * 1024 * 1024;

/** A manifest row exactly as SQLite holds it. */
type FileRow = {
  readonly path_key: string;
  readonly path: string;
  readonly version: number;
  readonly content_hash: string;
  readonly size: number;
  readonly updated_at: number;
  readonly deleted_at: number | null;
};

/** The facts every manifest row carries, whichever state it is in. */
type FileFacts = {
  readonly path: string;
  readonly key: string;
  readonly version: number;
  readonly contentHash: string;
  readonly size: number;
  readonly updatedAt: number;
};

/**
 * A file the vault holds. LIVE and TRASHED are separate variants rather than a
 * nullable `deletedAt` on one shape, so no caller can read a tombstone as a
 * live file by forgetting to check — and ABSENT is `null` from the lookup,
 * which is a third thing again.
 */
export type StoredFile =
  | (FileFacts & { readonly state: "live" })
  | (FileFacts & { readonly state: "trashed"; readonly deletedAt: number });

/** One tombstone, as a trash view lists it. */
export type TrashedEntry = { readonly path: string; readonly deletedAt: number };

/** A write's verdict. A version conflict is a VALUE — the caller (a rename's
 * link rewrite) decides whether to skip the doc or retry, and neither is an
 * exceptional condition. */
export type WriteOutcome =
  | { readonly ok: true; readonly file: StoredFile }
  | { readonly ok: false; readonly reason: "version-conflict"; readonly current: StoredFile | null }
  | { readonly ok: false; readonly reason: "bad-path" };

/** A delete's verdict. `held` carries everything a confirmation prompt needs,
 * and it is `@repo/bridge`'s own shape so the value a channel answers with is
 * the value this class produced rather than a re-spelling of it. */
export type TrashOutcome =
  | { readonly ok: true; readonly trashed: readonly string[] }
  | { readonly ok: false; readonly reason: "held"; readonly held: HeldDeletions };

/** A streamed upload's verdict. Over-size is a value: a chunked body declares
 * no length, so the only place the cap can be enforced is after the fact. */
export type UploadOutcome =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly reason: "too-large"; readonly size: number };

/** A move's verdict — the primitive rename, before any link rewriting. */
export type MoveOutcome = { readonly ok: true } | { readonly ok: false; readonly error: string };

/** The docs a rename-rewrite pass will read, plus the universe it resolves
 * against. */
export type DocSnapshot = {
  /** Doc contents keyed by vault path. */
  readonly docs: ReadonlyMap<string, string>;
  /** Versions the docs were read at, so a rewrite can write conditionally. */
  readonly versions: ReadonlyMap<string, number>;
  /** Every live path — the resolution universe links resolve against. */
  readonly files: readonly string[];
};

/**
 * A doc's bytes as a mutation had them in hand, with the hash the manifest
 * recorded them under.
 *
 * The pair is inseparable on purpose: the hash is what lets a later reader
 * prove these bytes are still the ones the manifest names, so text without its
 * hash — bytes nobody can date — is unrepresentable.
 */
export type ChangedBody = { readonly text: string; readonly contentHash: string };

/**
 * What one mutation did, in the terms a derived index needs: which paths now
 * hold different bytes, and which are gone.
 *
 * Not a per-operation union, because no consumer branches on the operation —
 * a rename and a delete-then-write leave the index with the same work to do,
 * and modelling them apart would only invite a consumer to handle one and
 * forget the other. `refresh()` announces an empty change: the manifest was
 * never stale, so there is nothing to reproject.
 */
export type VaultChange = {
  /** Files this mutation created or overwrote. `body` is null when the
   * mutation never held the bytes (a move, a restore, a streamed upload) or
   * when the path is not a doc — the reader fetches them if it needs them. */
  readonly upserted: readonly { readonly path: string; readonly body: ChangedBody | null }[];
  readonly removed: readonly string[];
};

export type UserVaultDeps = {
  readonly sql: SqlStorage;
  readonly bucket: R2Bucket;
  /** R2 key prefix — this object's own name, so two users' blobs cannot
   * collide and a vault's objects are enumerable under one prefix. */
  readonly prefix: string;
  /** Fired after every mutation, and by `refresh()`. The host turns it into
   * one `onVaultChanged` broadcast and hands it to the knowledge index; this
   * class never touches the wire. */
  readonly onChanged: (change: VaultChange) => void;
};

const NO_CHANGE: VaultChange = { upserted: [], removed: [] };

export class UserVault {
  private readonly sql: SqlStorage;
  private readonly bucket: R2Bucket;
  private readonly prefix: string;
  private readonly onChanged: (change: VaultChange) => void;

  /** Serializes mutations (see the CONCURRENCY note above). */
  private mutationTail: Promise<void> = Promise.resolve();

  /**
   * Keys claimed by an upload that has not committed its manifest row yet.
   *
   * In memory on purpose, and safe there: an in-flight `fetch` keeps the object
   * resident, so a reservation cannot outlive the request that holds it. It
   * exists so a large upload streams to R2 OUTSIDE the mutation mutex — the
   * alternative is holding the vault's only write lock for the length of a
   * 20 MB upload, which would stall the editor's autosaves behind an image.
   */
  private readonly reserved = new Set<string>();

  constructor(deps: UserVaultDeps) {
    this.sql = deps.sql;
    this.bucket = deps.bucket;
    this.prefix = deps.prefix;
    this.onChanged = deps.onChanged;
    // Synchronous, so the table exists before anything else in this object's
    // construction can reach it.
    //
    // QUALIFIED, because this object's SQLite is shared: the knowledge index's
    // schema is core's (@repo/notes/knowledge/sql-knowledge-store) and claims
    // the unqualified `files`. Two tables cannot hold one name, and the shared
    // schema is the one that cannot yield.
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS vault_files (
         path_key TEXT PRIMARY KEY,
         path TEXT NOT NULL,
         version INTEGER NOT NULL,
         content_hash TEXT NOT NULL,
         size INTEGER NOT NULL,
         updated_at INTEGER NOT NULL,
         deleted_at INTEGER
       )`,
    );
    // Serves the trash view, the retention sweep, and the deletion gate's
    // window count — every query that asks about tombstones.
    this.sql.exec("CREATE INDEX IF NOT EXISTS vault_files_deleted_at ON vault_files (deleted_at)");
  }

  // ---- reads (no mutex; concurrent) ----------------------------------------

  /** The vault's live files, in path order — the sidebar's whole listing. */
  list(): VaultEntry[] {
    const rows = this.sql
      .exec<{ path: string }>("SELECT path FROM vault_files WHERE deleted_at IS NULL ORDER BY path")
      .toArray();
    return rows.map((row) => ({
      path: row.path,
      name: basenamePath(row.path),
      kind: isDocPath(row.path) ? "doc" : "other",
    }));
  }

  /** Tombstoned files, newest deletion first — what a trash view lists. */
  listTrash(): TrashedEntry[] {
    const rows = this.sql
      .exec<{ path: string; deleted_at: number }>(
        "SELECT path, deleted_at FROM vault_files WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC, path",
      )
      .toArray();
    return rows.map((row) => ({ path: row.path, deletedAt: row.deleted_at }));
  }

  /**
   * Every live file with the manifest facts a derived index reconciles
   * against.
   *
   * The content hash is the point: it is the sha-256 of the bytes R2 holds, so
   * an index that records the hash it projected can tell exactly which files
   * moved under it — with no stat heuristics, no crawl, and no reads at all
   * when nothing changed.
   */
  liveFiles(): StoredFile[] {
    return this.sql
      .exec<FileRow>(
        `SELECT path_key, path, version, content_hash, size, updated_at, deleted_at
         FROM vault_files WHERE deleted_at IS NULL ORDER BY path`,
      )
      .toArray()
      .map(toStoredFile);
  }

  /** True when nothing has ever been written here — the seed's precondition. */
  isEmpty(): boolean {
    return (
      this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM vault_files").toArray()[0]?.n === 0
    );
  }

  /** The row at `rawPath`, live or tombstoned, or `null` when there is none. */
  lookup(rawPath: string): StoredFile | null {
    const parsed = parseVaultPath(rawPath);
    return parsed === null ? null : this.rowAt(parsed.key);
  }

  /** Size + last-modified for one LIVE file, or `null` — the per-file facts the
   * listing deliberately does not carry. */
  fileFacts(rawPath: string): VaultFileFacts | null {
    const file = this.lookup(rawPath);
    if (file === null || file.state !== "live") return null;
    return { sizeBytes: file.size, modifiedMs: file.updatedAt };
  }

  /** Raw bytes of a live file. Throws when the path names nothing — the
   * manifest is authoritative, so a live row with no blob behind it is a
   * storage fault and must not read as an empty file. */
  async readBytes(rawPath: string): Promise<Uint8Array> {
    const file = this.lookup(rawPath);
    if (file === null || file.state !== "live") throw new Error(`Not found: ${rawPath}`);
    const object = await this.bucket.get(this.objectKey(file.key));
    if (object === null) throw new Error(`Vault bytes missing for ${file.path}`);
    return new Uint8Array(await object.arrayBuffer());
  }

  /**
   * A live file's bytes as a STREAM, or `null` when the path names nothing
   * live and when the blob behind a live row is gone.
   *
   * The export's read: it walks the whole vault, so a method that resolved a
   * body into memory would put the isolate's 128 MiB between the user and
   * their own notes. Missing bytes are a value rather than a throw here
   * because the caller is mid-archive and dropping one member beats aborting
   * a download in flight.
   */
  async openStream(rawPath: string): Promise<ReadableStream<Uint8Array> | null> {
    const file = this.lookup(rawPath);
    if (file === null || file.state !== "live") return null;
    const object = await this.bucket.get(this.objectKey(file.key));
    return object === null ? null : object.body;
  }

  /** A live file's text — what the editor reads. */
  async readText(rawPath: string): Promise<string> {
    const file = this.lookup(rawPath);
    if (file === null || file.state !== "live") throw new Error(`Not found: ${rawPath}`);
    const object = await this.bucket.get(this.objectKey(file.key));
    if (object === null) throw new Error(`Vault bytes missing for ${file.path}`);
    return object.text();
  }

  /** A live file's bytes as base64, or an `{ ok: false }` value when it is
   * missing or too large to send inline. Rendering a broken image is a UI
   * state, not an exception. */
  async readInlineBytes(
    rawPath: string,
  ): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; error: string }> {
    const file = this.lookup(rawPath);
    if (file === null || file.state !== "live")
      return { ok: false, error: `Not found: ${rawPath}` };
    if (file.size > MAX_INLINE_READ_BYTES) {
      return { ok: false, error: `File too large to preview (${file.size} bytes)` };
    }
    const object = await this.bucket.get(this.objectKey(file.key));
    if (object === null) return { ok: false, error: `Vault bytes missing for ${file.path}` };
    return { ok: true, bytes: new Uint8Array(await object.arrayBuffer()) };
  }

  /**
   * The bytes of the named docs, plus the full path universe — the input the
   * pure rename-rewrite pass needs.
   *
   * The caller names the docs because only it can: the knowledge index knows
   * which notes a rename can possibly touch, and reading any others would be
   * one R2 GET apiece to compute no edit at all. A named path that is missing
   * or unreadable is simply absent from the result — it will not be rewritten.
   */
  async snapshotDocs(paths: readonly string[]): Promise<DocSnapshot> {
    const rows = this.sql
      .exec<{ path: string; path_key: string; version: number }>(
        "SELECT path, path_key, version FROM vault_files WHERE deleted_at IS NULL ORDER BY path",
      )
      .toArray();
    const files = rows.map((row) => row.path);
    const wanted = new Set(paths);
    const docRows = rows.filter((row) => wanted.has(row.path) && isDocPath(row.path));
    const docs = new Map<string, string>();
    const versions = new Map<string, number>();
    // Bounded fan-out: R2 round trips dominate, and issuing them one at a time
    // makes a rename linear in latency rather than in work.
    const BATCH = 25;
    for (let start = 0; start < docRows.length; start += BATCH) {
      const batch = docRows.slice(start, start + BATCH);
      const texts = await Promise.all(
        batch.map(async (row) => {
          const object = await this.bucket.get(this.objectKey(row.path_key));
          return object === null ? null : object.text();
        }),
      );
      for (const [index, row] of batch.entries()) {
        const text = texts[index];
        // An unreadable doc is simply left out — it will not be rewritten.
        if (text === undefined || text === null) continue;
        docs.set(row.path, text);
        versions.set(row.path, row.version);
      }
    }
    return { docs, versions, files };
  }

  // ---- mutations (serialized through the mutex) ----------------------------

  /** Write text at `rawPath`, creating or overwriting. */
  writeText(rawPath: string, content: string, baseVersion?: number): Promise<WriteOutcome> {
    return this.write(rawPath, new TextEncoder().encode(content), baseVersion);
  }

  /**
   * Write bytes at `rawPath`.
   *
   * `baseVersion` is optimistic concurrency: supplied, the write lands only if
   * the manifest is still at that version, and a mismatch comes back as a
   * `version-conflict` VALUE carrying the current row. The editor's autosave
   * writes unconditionally (last write wins, as it always has); the rename's
   * link rewrite writes conditionally, which is what keeps it from clobbering a
   * doc that changed under it.
   *
   * Writing over a TOMBSTONE resurrects the row and consumes the tombstone: the
   * trash is a recovery affordance, not a namespace reservation, and a caller
   * that writes to a trashed path has said which of the two it wants.
   */
  async write(rawPath: string, bytes: Uint8Array, baseVersion?: number): Promise<WriteOutcome> {
    const parsed = parseVaultPath(rawPath);
    if (parsed === null) return { ok: false, reason: "bad-path" };
    // Hash outside the mutex — no storage is touched yet.
    const contentHash = await sha256Hex(bytes);
    return this.runExclusive(async (): Promise<WriteOutcome> => {
      const current = this.rowAt(parsed.key);
      if (baseVersion !== undefined && (current?.version ?? 0) !== baseVersion) {
        return { ok: false, reason: "version-conflict", current };
      }
      const file = await this.commit(parsed, current, contentHash, bytes.length, bytes);
      // Decoded here rather than threaded down from `writeText`, so EVERY
      // writer announces a doc the same way — including the byte-only ones,
      // where the caller has no text to thread.
      const body = isDocPath(parsed.path)
        ? { text: new TextDecoder().decode(bytes), contentHash }
        : null;
      this.onChanged({ upserted: [{ path: parsed.path, body }], removed: [] });
      return { ok: true, file };
    });
  }

  /**
   * Write asset bytes under `dir`, picking a collision-free name derived from
   * `baseName`, and return the path it landed at. The editor's paste/drop
   * ingestion, in its inline form.
   */
  async writeAsset(dir: string, baseName: string, bytes: Uint8Array): Promise<string> {
    const contentHash = await sha256Hex(bytes);
    const claim = await this.runExclusive(() => this.claimAssetPath(dir, baseName));
    try {
      await this.runExclusive(async () => {
        await this.commit(claim, null, contentHash, bytes.length, bytes);
        this.onChanged({ upserted: [{ path: claim.path, body: null }], removed: [] });
      });
    } finally {
      this.reserved.delete(claim.key);
    }
    return claim.path;
  }

  /**
   * Stream asset bytes under `dir` straight into R2 and commit a manifest row.
   *
   * The reason this exists rather than growing the inline path: the Bridge
   * carries asset bytes as base64 in ONE WebSocket frame, a Durable Object caps
   * a received message at 32 MiB, and base64 inflates by a third — so the
   * socket cannot carry the files a notes app is asked to hold. Here the bytes
   * never enter a frame and never enter the mutex: the path is claimed, the
   * body is teed to R2 and to a digest, and only the row commit takes the lock.
   */
  async uploadAsset(
    dir: string,
    baseName: string,
    body: ReadableStream<Uint8Array>,
    maxBytes: number,
  ): Promise<UploadOutcome> {
    const claim = await this.runExclusive(() => this.claimAssetPath(dir, baseName));
    try {
      // Bytes are durable before the lock is taken, so the exclusive section is
      // the manifest row alone — the ordering rule holds and the mutex is held
      // for microseconds rather than for the length of the upload.
      const stored = await this.putStream(this.objectKey(claim.key), body);
      if (stored.size > maxBytes) {
        // A chunked body declares no length, so the cap can only be enforced
        // once the stream ends. No row was written, so dropping the object
        // leaves the manifest exactly as it was.
        await this.bucket.delete(this.objectKey(claim.key));
        return { ok: false, reason: "too-large", size: stored.size };
      }
      await this.runExclusive(() => {
        this.insertRow(claim, null, stored.contentHash, stored.size);
        // No body: the bytes were streamed to R2 and never held here.
        this.onChanged({ upserted: [{ path: claim.path, body: null }], removed: [] });
      });
      return { ok: true, path: claim.path };
    } finally {
      this.reserved.delete(claim.key);
    }
  }

  /**
   * Tombstone `rawPaths`, subject to the deletion gate.
   *
   * `confirmDeletions` is the count a human was shown and approved. It waives
   * the gate for THIS call and at most that many deletions, and is never
   * stored: a confirmation can only ever authorize the deletion the user saw,
   * and a bigger one holds again with the new number.
   */
  trash(rawPaths: readonly string[], confirmDeletions?: number): Promise<TrashOutcome> {
    const parsed = rawPaths.map((raw) => parseVaultPath(raw)).filter(isVaultKey);
    return this.runExclusive((): TrashOutcome => {
      const now = Date.now();
      const targets = parsed.filter((key) => this.rowAt(key.key)?.state === "live");
      const held = this.gateDeletions(targets, now, confirmDeletions);
      if (held !== null) return { ok: false, reason: "held", held };
      for (const target of targets) {
        this.sql.exec(
          "UPDATE vault_files SET deleted_at = ?, updated_at = ? WHERE path_key = ?",
          now,
          now,
          target.key,
        );
      }
      const trashed = targets.map((target) => target.path);
      if (trashed.length > 0) this.onChanged({ upserted: [], removed: trashed });
      return { ok: true, trashed };
    });
  }

  /** Bring a tombstoned file back. `false` when there is no tombstone there. */
  restore(rawPath: string): Promise<boolean> {
    const parsed = parseVaultPath(rawPath);
    if (parsed === null) return Promise.resolve(false);
    return this.runExclusive(() => {
      const current = this.rowAt(parsed.key);
      if (current === null || current.state !== "trashed") return false;
      this.sql.exec(
        "UPDATE vault_files SET deleted_at = NULL, updated_at = ? WHERE path_key = ?",
        Date.now(),
        parsed.key,
      );
      this.onChanged({ upserted: [{ path: current.path, body: null }], removed: [] });
      return true;
    });
  }

  /**
   * Move a file, creating nothing and clobbering nothing. This is the rename
   * PRIMITIVE — link rewriting is a layer above it (./vault-rename).
   *
   * A CASE-ONLY rename is the interesting case and it is nearly free: the
   * folded key is unchanged, so the blob never moves and only the display
   * spelling is rewritten. That is the whole payoff of folding the key (see
   * ./vault-key) — the operation that a case-sensitive blob store turns into a
   * copy-and-delete race is here a single UPDATE.
   */
  async move(rawFrom: string, rawTo: string): Promise<MoveOutcome> {
    const from = parseVaultPath(rawFrom);
    const to = parseVaultPath(rawTo);
    if (from === null) return { ok: false, error: `Not found: ${rawFrom}` };
    if (to === null) return { ok: false, error: `Invalid path: ${rawTo}` };
    return this.runExclusive(async (): Promise<MoveOutcome> => {
      const source = this.rowAt(from.key);
      if (source === null || source.state !== "live") {
        return { ok: false, error: `Not found: ${rawFrom}` };
      }
      if (from.key === to.key) {
        if (from.path === to.path) return { ok: true };
        this.sql.exec(
          "UPDATE vault_files SET path = ?, version = version + 1, updated_at = ? WHERE path_key = ?",
          to.path,
          Date.now(),
          from.key,
        );
        this.onChanged({ upserted: [{ path: to.path, body: null }], removed: [from.path] });
        return { ok: true };
      }

      const occupant = this.rowAt(to.key);
      if (occupant !== null && occupant.state === "live") {
        return { ok: false, error: `${to.path} already exists` };
      }
      // A tombstone is not a namespace reservation — the move purges it, and
      // its bytes go with it, exactly as writing over one does.
      if (occupant !== null) await this.purge([occupant.key]);

      const object = await this.bucket.get(this.objectKey(from.key));
      if (object === null) return { ok: false, error: `Vault bytes missing for ${source.path}` };
      // Bytes at the destination BEFORE the row moves, old blob dropped after,
      // so the manifest never points at a missing blob in either direction.
      await this.bucket.put(this.objectKey(to.key), object.body, { sha256: source.contentHash });
      this.sql.exec(
        `UPDATE vault_files SET path_key = ?, path = ?, version = version + 1, updated_at = ?
         WHERE path_key = ?`,
        to.key,
        to.path,
        Date.now(),
        from.key,
      );
      await this.bucket.delete(this.objectKey(from.key));
      this.onChanged({ upserted: [{ path: to.path, body: null }], removed: [source.path] });
      return { ok: true };
    });
  }

  /** Re-announce the vault without changing it — the "Refresh vault" command.
   * There is no snapshot to rebuild here; the manifest was never stale. */
  refresh(): void {
    this.onChanged(NO_CHANGE);
  }

  // ---- retention -----------------------------------------------------------

  /** When the oldest tombstone comes due, or `null` when there are none. The
   * host folds this into its single alarm. */
  nextSweepAt(): number | null {
    const row = this.sql
      .exec<{ oldest: number | null }>(
        "SELECT MIN(deleted_at) AS oldest FROM vault_files WHERE deleted_at IS NOT NULL",
      )
      .toArray()[0];
    const oldest = row?.oldest ?? null;
    return oldest === null ? null : oldest + TRASH_RETENTION_MS;
  }

  /** Purge every tombstone past its retention. Returns how many went. */
  async sweepTrash(now: number): Promise<number> {
    return this.runExclusive(async () => {
      const due = this.sql
        .exec<{ path_key: string }>(
          "SELECT path_key FROM vault_files WHERE deleted_at IS NOT NULL AND deleted_at <= ?",
          now - TRASH_RETENTION_MS,
        )
        .toArray();
      if (due.length === 0) return 0;
      await this.purge(due.map((row) => row.path_key));
      return due.length;
    });
  }

  // ---- internals -----------------------------------------------------------

  private rowAt(key: string): StoredFile | null {
    const row = this.sql
      .exec<FileRow>(
        `SELECT path_key, path, version, content_hash, size, updated_at, deleted_at
         FROM vault_files WHERE path_key = ?`,
        key,
      )
      .toArray()[0];
    return row === undefined ? null : toStoredFile(row);
  }

  /** Bytes to R2 first, then the manifest row. The ordering is the invariant. */
  private async commit(
    target: VaultKey,
    current: StoredFile | null,
    contentHash: string,
    size: number,
    bytes: Uint8Array,
  ): Promise<StoredFile> {
    // Hand R2 the digest already computed: it verifies server-side and refuses
    // the put on a mismatch, so a corrupted transfer can never be committed
    // under a hash that does not describe it.
    await this.bucket.put(this.objectKey(target.key), bytes, { sha256: contentHash });
    return this.insertRow(target, current, contentHash, size);
  }

  /** The manifest half of a commit — synchronous, so the version read and bump
   * cannot be interleaved. */
  private insertRow(
    target: VaultKey,
    current: StoredFile | null,
    contentHash: string,
    size: number,
  ): StoredFile {
    const version = (current?.version ?? 0) + 1;
    const now = Date.now();
    this.sql.exec(
      `INSERT INTO vault_files (path_key, path, version, content_hash, size, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL)
       ON CONFLICT(path_key) DO UPDATE SET
         path = excluded.path,
         version = excluded.version,
         content_hash = excluded.content_hash,
         size = excluded.size,
         updated_at = excluded.updated_at,
         deleted_at = NULL`,
      target.key,
      target.path,
      version,
      contentHash,
      size,
      now,
    );
    return {
      state: "live",
      path: target.path,
      key: target.key,
      version,
      contentHash,
      size,
      updatedAt: now,
    };
  }

  /** Manifest row out first, then the blob — a purge's half of the ordering
   * rule. An interrupted purge leaves an orphan blob, never a dangling row. */
  private async purge(keys: readonly string[]): Promise<void> {
    for (const key of keys) this.sql.exec("DELETE FROM vault_files WHERE path_key = ?", key);
    await this.bucket.delete(keys.map((key) => this.objectKey(key)));
  }

  /** Stream a body into R2 while digesting it, so an upload is never buffered
   * whole in a Durable Object's memory. */
  private async putStream(
    key: string,
    body: ReadableStream<Uint8Array>,
  ): Promise<{ contentHash: string; size: number }> {
    const [toStore, toHash] = body.tee();
    const digest = new crypto.DigestStream("SHA-256");
    const hashing = toHash.pipeTo(digest);
    let object: R2Object | null;
    try {
      object = await this.bucket.put(key, toStore);
    } catch (error) {
      // The hashing leg fails with the same broken stream; swallow its
      // rejection so the store's error is the one that surfaces.
      await hashing.catch(() => undefined);
      throw error;
    }
    await hashing;
    // `null` is the API's answer to an unmet `onlyIf` precondition, and this
    // put has none — so it cannot happen, and saying so beats asserting it.
    if (object === null) throw new Error(`Vault upload was refused for ${key}`);
    return { contentHash: hexOf(await digest.digest), size: object.size };
  }

  /**
   * Reserve a free vault path for an asset. Collision-free against live rows,
   * tombstones AND in-flight reservations — a tombstone still owns its blob,
   * so handing its path to a new upload would overwrite bytes the trash is
   * holding.
   */
  private claimAssetPath(dir: string, baseName: string): VaultKey {
    const cleanDir = normalizeAssetDir(dir);
    const name = sanitizeAssetName(baseName);
    const dot = name.lastIndexOf(".");
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : "";
    for (let suffix = 0; ; suffix++) {
      const candidate = suffix === 0 ? name : `${stem}-${suffix}${ext}`;
      const parsed = parseVaultPath(`${cleanDir}/${candidate}`);
      // `normalizeAssetDir`/`sanitizeAssetName` already strip everything that
      // could make this fail; the guard is here so the loop cannot spin.
      if (parsed === null) throw new Error(`Cannot place an asset named "${baseName}"`);
      if (this.rowAt(parsed.key) === null && !this.reserved.has(parsed.key)) {
        this.reserved.add(parsed.key);
        return parsed;
      }
    }
  }

  /** The gate's verdict on this call, or `null` to let it through. */
  private gateDeletions(
    targets: readonly VaultKey[],
    now: number,
    confirmDeletions: number | undefined,
  ): HeldDeletions | null {
    if (targets.length === 0) return null;
    const recent =
      this.sql
        .exec<{ n: number }>(
          "SELECT COUNT(*) AS n FROM vault_files WHERE deleted_at IS NOT NULL AND deleted_at > ?",
          now - DELETION_WINDOW_MS,
        )
        .toArray()[0]?.n ?? 0;
    const liveCount =
      this.sql
        .exec<{ n: number }>("SELECT COUNT(*) AS n FROM vault_files WHERE deleted_at IS NULL")
        .toArray()[0]?.n ?? 0;
    const deletions = recent + targets.length;
    const limit = Math.max(MIN_HELD_DELETIONS, HELD_DELETION_SHARE * liveCount);
    if (deletions <= limit) return null;
    if (confirmDeletions !== undefined && deletions <= confirmDeletions) return null;
    return { deletions, liveCount, limit, sample: targets.slice(0, 5).map((key) => key.path) };
  }

  private objectKey(key: string): string {
    return `${this.prefix}/${key}`;
  }

  private runExclusive<T>(task: () => T | PromiseLike<T>): Promise<T> {
    const run = this.mutationTail.then(task);
    // Keep the chain alive regardless of this task's outcome (the caller still
    // receives the rejection through `run`).
    this.mutationTail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

/** Manifest row → the caller-facing record, with live and trashed split so
 * neither can be read as the other. */
function toStoredFile(row: FileRow): StoredFile {
  const facts: FileFacts = {
    path: row.path,
    key: row.path_key,
    version: row.version,
    contentHash: row.content_hash,
    size: row.size,
    updatedAt: row.updated_at,
  };
  return row.deleted_at === null
    ? { ...facts, state: "live" }
    : { ...facts, state: "trashed", deletedAt: row.deleted_at };
}

function isVaultKey(key: VaultKey | null): key is VaultKey {
  return key !== null;
}

/** Reduce a caller-supplied file name to a safe leaf: no path separators, no
 * traversal, no leading dots, only word/space/dot/dash characters. */
function sanitizeAssetName(raw: string): string {
  const leaf = raw.split(/[/\\]/).pop() ?? "";
  const cleaned = leaf
    .replaceAll(/[^\w .-]+/g, "")
    .replace(/^\.+/, "")
    .trim();
  return cleaned.length > 0 ? cleaned : "image";
}

/** Normalize a target directory to a clean vault-relative prefix; empty input
 * defaults to "assets". */
function normalizeAssetDir(raw: string): string {
  const segments = raw
    .split(/[/\\]/)
    .filter((segment) => segment !== "" && segment !== "." && segment !== "..");
  return segments.length > 0 ? segments.join("/") : "assets";
}

function hexOf(digest: ArrayBuffer): string {
  let hex = "";
  for (const byte of new Uint8Array(digest)) hex += byte.toString(16).padStart(2, "0");
  return hex;
}
