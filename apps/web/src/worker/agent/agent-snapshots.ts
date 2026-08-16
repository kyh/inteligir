// ---------------------------------------------------------------------------
// Restore points for agent writes — the ONE module every AI-edit undo goes
// through.
//
// THE RULE: a mutation the agent makes captures a restore point BEFORE it
// touches the file, and a capture that fails BLOCKS the write. An AI edit with
// no undo point must never happen, so the capture is fail-closed and its
// failure is the tool's refusal — or, for a background run, the reason it never
// dispatched.
//
// The bytes go where the vault's already are. R2 holds the file's current bytes
// under a content-addressed manifest, so a capture is an R2 copy to a snapshot
// key plus a row here, and a restore is a write of those bytes back THROUGH the
// vault — which means the manifest, the knowledge index and the deletion gate
// all see an ordinary write and stay authoritative.
//
// SCOPE IS (ORIGIN, REF), and the three origins are the three surfaces that
// write:
//   - `chat`   — ref is the chat thread. Every allowed write captures one, and
//                each is announced so the post-turn undo toast can offer it.
//   - `delegation` / `routine` — ref is the RUN. The pre-run capture is taken
//                before the turn dispatches, and the surface's "Restore
//                original" reads it back by the id it recorded.
// The origin is what keeps them apart: a chatty conversation can never evict a
// background run's undo point, and a background run never appears in the chat
// toast.
//
// A CREATE IS NOT AN EMPTY FILE. When the target does not exist yet, the
// restore point is "it did not exist", and undoing it TOMBSTONES the file
// rather than writing zero bytes — a tombstone is what "gone" means here, so an
// undone create ends the same way any other delete does.
// ---------------------------------------------------------------------------

/** Snapshots kept PER ORIGIN. A count cap rather than an age window: snapshots
 * are whole-file copies, so "50 × a note" is a bounded footprint, while an idle
 * vault never loses its recent undo points to a calendar. Per origin, so a long
 * chat cannot evict a background run's. */
const SNAPSHOT_RETENTION = 50;

/** Which surface captured a snapshot — and the retention bucket it counts
 * against. */
export type SnapshotOrigin = "chat" | "delegation" | "routine";

/** What the pre-write state WAS. `edit` = the file existed and the blob holds
 * its exact prior bytes; `create` = it did not, so undo removes it. */
type SnapshotKind = "edit" | "create";

/** The surface + the thing within it a capture belongs to (see the header). */
export type SnapshotScope = { readonly origin: SnapshotOrigin; readonly ref: string };

type SnapshotRow = {
  readonly snapshot_id: string;
  readonly origin: string;
  readonly ref: string;
  readonly path: string;
  readonly kind: string;
  readonly object_key: string | null;
  readonly created_at: number;
};

/** What a capture needs from the vault, and what a restore gives back to it.
 * Structural so the tests drive the real store against a fake bucket. */
export type SnapshotVault = {
  /** The live row at `path`, or null. */
  lookup(path: string): { readonly state: "live" | "trashed"; readonly key: string } | null;
  /** Write bytes back at `path` — an ordinary vault write, gate and index
   * included. */
  writeText(path: string, content: string): Promise<{ readonly ok: boolean }>;
  /** Tombstone `path` — how a created file is un-created. */
  trash(paths: readonly string[]): Promise<{ readonly ok: boolean }>;
};

export type SnapshotDeps = {
  readonly sql: SqlStorage;
  readonly bucket: R2Bucket;
  /** R2 key prefix for this user's blobs — the same one the vault uses, so a
   * snapshot lives beside the file it copies. */
  readonly prefix: string;
  readonly vault: SnapshotVault;
  /** A chat capture landed. Fired for that origin ONLY: the post-turn undo
   * toast must never offer to undo a background run, which has its own
   * affordance and its own run-state guard. */
  readonly onChatCaptured: (capture: CapturedEdit) => void;
};

/** What `onChatCaptured` announces — the wire shape's own fields, resolved. */
export type CapturedEdit = {
  readonly id: string;
  readonly path: string;
  readonly kind: SnapshotKind;
  readonly capturedAt: number;
};

export type RestoreOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

export class AgentSnapshots {
  private readonly sql: SqlStorage;
  private readonly bucket: R2Bucket;
  private readonly prefix: string;
  private readonly vault: SnapshotVault;
  private readonly onChatCaptured: (capture: CapturedEdit) => void;

  constructor(deps: SnapshotDeps) {
    this.sql = deps.sql;
    this.bucket = deps.bucket;
    this.prefix = deps.prefix;
    this.vault = deps.vault;
    this.onChatCaptured = deps.onChatCaptured;
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS agent_snapshots (
         snapshot_id TEXT PRIMARY KEY,
         origin TEXT NOT NULL,
         ref TEXT NOT NULL,
         path TEXT NOT NULL,
         kind TEXT NOT NULL,
         object_key TEXT,
         created_at INTEGER NOT NULL
       )`,
    );
    this.sql.exec(
      "CREATE INDEX IF NOT EXISTS agent_snapshots_scope ON agent_snapshots (origin, ref, path, created_at)",
    );
  }

  /**
   * Copy the current bytes at `path` aside, and answer with the id that undoes
   * it — or `null`, which the caller must treat as "do not write".
   *
   * A path that does not exist yet captures a `create` with no blob: there are
   * no bytes to copy, and the undo is a tombstone rather than an empty write.
   */
  async capture(scope: SnapshotScope, path: string): Promise<string | null> {
    const current = this.vault.lookup(path);
    const live = current !== null && current.state === "live";
    const objectKey = live ? `${this.prefix}/.snapshots/${crypto.randomUUID()}` : null;
    if (objectKey !== null && current !== null) {
      try {
        const object = await this.bucket.get(`${this.prefix}/${current.key}`);
        if (object === null) return null;
        await this.bucket.put(objectKey, object.body);
      } catch {
        return null;
      }
    }
    const id = crypto.randomUUID();
    const capturedAt = Date.now();
    this.sql.exec(
      `INSERT INTO agent_snapshots (snapshot_id, origin, ref, path, kind, object_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      id,
      scope.origin,
      scope.ref,
      path,
      live ? "edit" : "create",
      objectKey,
      capturedAt,
    );
    await this.prune();
    if (scope.origin === "chat") {
      // Best-effort: the capture is already durable, and a broadcast failure
      // must not turn into a blocked agent write.
      try {
        this.onChatCaptured({ id, path, kind: live ? "edit" : "create", capturedAt });
      } catch {
        // Nothing here can recover a socket; the undo point stands either way.
      }
    }
    return id;
  }

  /**
   * Put every named snapshot's file back, aggregating failures into one
   * sentence — whatever could be restored was.
   *
   * `origin` is a GUARD, not a lookup hint: each surface holds ids from its own
   * captures, so an id from another one arriving here means a caller reached
   * past its own undo — the chat toast trying to rewind a background task's
   * work, which that task's own affordance owns behind its run-state check.
   *
   * IDEMPOTENT, and deliberately not consuming: "Restore original" is an
   * affordance a user may click twice, and the second click landing on the same
   * bytes is the answer they asked for. `consume` is the exception the agent's
   * own undo takes.
   */
  async restore(ids: readonly string[], origin: SnapshotOrigin): Promise<RestoreOutcome> {
    const failures: string[] = [];
    for (const id of ids) {
      const row = this.rowAt(id);
      if (row === null) {
        failures.push("No saved copy exists for that edit.");
        continue;
      }
      if (row.origin !== origin) {
        failures.push(`${row.path} was not edited by this surface, so it cannot be undone here.`);
        continue;
      }
      const applied = await this.applyRestore(row);
      if (!applied.ok) failures.push(applied.reason);
    }
    return failures.length === 0 ? { ok: true } : { ok: false, reason: failures.join(" ") };
  }

  /** Drop a snapshot and its blob. The agent's own `undo_my_edits` calls this
   * after restoring: a second undo of the same edit would otherwise rewind to
   * the same bytes and report success while changing nothing. */
  async consume(id: string): Promise<void> {
    const row = this.rowAt(id);
    if (row === null) return;
    this.sql.exec("DELETE FROM agent_snapshots WHERE snapshot_id = ?", id);
    if (row.object_key !== null) await this.bucket.delete(row.object_key);
  }

  /** The newest snapshot for one scope + path, or null. The lookup behind the
   * agent's own undo, which keys on a PATH: a model has no capture ids. */
  latest(scope: SnapshotScope, path: string): string | null {
    const row = this.sql
      .exec<{ snapshot_id: string }>(
        `SELECT snapshot_id FROM agent_snapshots
         WHERE origin = ? AND ref = ? AND path = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`,
        scope.origin,
        scope.ref,
        path,
      )
      .toArray()[0];
    return row?.snapshot_id ?? null;
  }

  /** Whether `id` still names bytes something can be restored from — what a
   * `hasSnapshot` flag on a delegation or a routine run reports. */
  holds(id: string): boolean {
    return this.rowAt(id) !== null;
  }

  // ---- internals ------------------------------------------------------------

  private rowAt(id: string): SnapshotRow | null {
    return (
      this.sql
        .exec<SnapshotRow>(
          `SELECT snapshot_id, origin, ref, path, kind, object_key, created_at
           FROM agent_snapshots WHERE snapshot_id = ?`,
          id,
        )
        .toArray()[0] ?? null
    );
  }

  /**
   * The byte-restore both undo surfaces share.
   *
   * A `create` snapshot undoes by TOMBSTONING the file — the vault has no OS
   * trash to hand it to, and a permanent delete would make undoing an
   * agent-created note the one irreversible step in an undo feature. An `edit`
   * writes its bytes back through the vault, recreating the file if it was
   * deleted since.
   */
  private async applyRestore(row: SnapshotRow): Promise<RestoreOutcome> {
    if (row.kind === "create") {
      const current = this.vault.lookup(row.path);
      // Already gone counts as done: the undo's whole claim is about the
      // file's absence, not about who removed it.
      if (current === null || current.state !== "live") return { ok: true };
      const trashed = await this.vault.trash([row.path]);
      return trashed.ok ? { ok: true } : { ok: false, reason: `Could not remove ${row.path}.` };
    }
    if (row.object_key === null) {
      return { ok: false, reason: `The saved copy of ${row.path} is no longer available.` };
    }
    const object = await this.bucket.get(row.object_key);
    if (object === null) {
      return { ok: false, reason: `The saved copy of ${row.path} is no longer available.` };
    }
    const written = await this.vault.writeText(row.path, await object.text());
    return written.ok ? { ok: true } : { ok: false, reason: `Could not write ${row.path}.` };
  }

  /** Drop the oldest snapshots past the cap in each origin, blobs and all. */
  private async prune(): Promise<void> {
    const doomed: SnapshotRow[] = [];
    for (const origin of ["chat", "delegation", "routine"] satisfies SnapshotOrigin[]) {
      doomed.push(
        ...this.sql
          .exec<SnapshotRow>(
            `SELECT snapshot_id, origin, ref, path, kind, object_key, created_at
             FROM agent_snapshots WHERE origin = ?
             ORDER BY created_at DESC, rowid DESC LIMIT -1 OFFSET ?`,
            origin,
            SNAPSHOT_RETENTION,
          )
          .toArray(),
      );
    }
    if (doomed.length === 0) return;
    for (const row of doomed) {
      this.sql.exec("DELETE FROM agent_snapshots WHERE snapshot_id = ?", row.snapshot_id);
    }
    const keys = doomed.flatMap((row) => (row.object_key === null ? [] : [row.object_key]));
    if (keys.length > 0) await this.bucket.delete(keys);
  }
}
