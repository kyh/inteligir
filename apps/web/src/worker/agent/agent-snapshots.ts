// ---------------------------------------------------------------------------
// Restore points for agent writes — what makes `undo_my_edits` a real answer
// rather than a tool that apologises.
//
// The rule the desktop set stands: a mutation the agent makes captures a
// restore point BEFORE it touches the file, and a capture that fails BLOCKS the
// write. An AI edit with no undo point must never happen, so the capture is
// fail-closed and its failure is the tool's refusal.
//
// The mechanics differ because the storage does. There is no `~/.inteligir` to
// copy bytes into; there is R2, which already holds the file's current bytes
// under a content-addressed manifest. So a capture is an R2 copy to a snapshot
// key plus a row here, and a restore is a write of those bytes back through the
// vault — which means the manifest, the knowledge index and the deletion gate
// all see an ordinary write and stay authoritative.
//
// Scope is the CURRENT THREAD, matching the grant table's promise: `undo_my_edits`
// reaches edits made in this conversation, and anything older is the user's own
// undo, not the agent's.
// ---------------------------------------------------------------------------

/** Snapshots kept per user. Each is one copy of one note; the cap bounds what a
 * long agent session can accumulate in R2. */
const MAX_SNAPSHOTS = 200;

type SnapshotRow = {
  readonly id: number;
  readonly path: string;
  readonly session_id: string;
  readonly object_key: string;
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
};

export type SnapshotDeps = {
  readonly sql: SqlStorage;
  readonly bucket: R2Bucket;
  /** R2 key prefix for this user's blobs — the same one the vault uses, so a
   * snapshot lives beside the file it copies. */
  readonly prefix: string;
  readonly vault: SnapshotVault;
};

export type RestoreOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

export class AgentSnapshots {
  private readonly sql: SqlStorage;
  private readonly bucket: R2Bucket;
  private readonly prefix: string;
  private readonly vault: SnapshotVault;

  constructor(deps: SnapshotDeps) {
    this.sql = deps.sql;
    this.bucket = deps.bucket;
    this.prefix = deps.prefix;
    this.vault = deps.vault;
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS agent_snapshots (
         id INTEGER PRIMARY KEY,
         path TEXT NOT NULL,
         session_id TEXT NOT NULL,
         object_key TEXT NOT NULL,
         created_at INTEGER NOT NULL
       )`,
    );
    this.sql.exec(
      "CREATE INDEX IF NOT EXISTS agent_snapshots_path ON agent_snapshots (session_id, path, id)",
    );
  }

  /**
   * Copy the current bytes at `path` aside.
   *
   * Answers `true` when there is now a restore point — including for a path
   * that does not exist yet, where the restore point is "it did not exist" and
   * is recorded as an empty snapshot with no blob. `false` means the copy
   * failed, and the caller must refuse the write.
   */
  async capture(sessionId: string, path: string): Promise<boolean> {
    const current = this.vault.lookup(path);
    const objectKey = `${this.prefix}/.snapshots/${crypto.randomUUID()}`;
    try {
      if (current !== null && current.state === "live") {
        const object = await this.bucket.get(`${this.prefix}/${current.key}`);
        if (object === null) return false;
        await this.bucket.put(objectKey, object.body);
      } else {
        // A file the agent is about to CREATE has an empty restore point: the
        // undo is "put it back to nothing", which is an empty write rather than
        // a delete — the vault's own trash owns removal.
        await this.bucket.put(objectKey, new Uint8Array(0));
      }
    } catch {
      return false;
    }
    this.sql.exec(
      "INSERT INTO agent_snapshots (path, session_id, object_key, created_at) VALUES (?, ?, ?, ?)",
      path,
      sessionId,
      objectKey,
      Date.now(),
    );
    await this.prune();
    return true;
  }

  /** Put `path` back to the newest snapshot taken in `sessionId`. */
  async restore(sessionId: string, path: string): Promise<RestoreOutcome> {
    const row = this.sql
      .exec<SnapshotRow>(
        `SELECT id, path, session_id, object_key, created_at FROM agent_snapshots
         WHERE session_id = ? AND path = ? ORDER BY id DESC LIMIT 1`,
        sessionId,
        path,
      )
      .toArray()[0];
    if (row === undefined) {
      return { ok: false, reason: `I have not edited ${path} in this conversation.` };
    }
    const object = await this.bucket.get(row.object_key);
    if (object === null) {
      return { ok: false, reason: `The saved copy of ${path} is no longer available.` };
    }
    const written = await this.vault.writeText(path, await object.text());
    if (!written.ok) return { ok: false, reason: `Could not write ${path}.` };
    // The snapshot is CONSUMED: a second undo of the same edit would otherwise
    // rewind to the same bytes and report success while changing nothing.
    this.sql.exec("DELETE FROM agent_snapshots WHERE id = ?", row.id);
    await this.bucket.delete(row.object_key);
    return { ok: true };
  }

  /** Whether this conversation has anything to undo for `path`. */
  hasSnapshot(sessionId: string, path: string): boolean {
    const row = this.sql
      .exec<{ n: number }>(
        "SELECT COUNT(*) AS n FROM agent_snapshots WHERE session_id = ? AND path = ?",
        sessionId,
        path,
      )
      .toArray()[0];
    return (row?.n ?? 0) > 0;
  }

  /** Drop the oldest snapshots past the cap, blobs and all. */
  private async prune(): Promise<void> {
    const doomed = this.sql
      .exec<{ id: number; object_key: string }>(
        "SELECT id, object_key FROM agent_snapshots ORDER BY id DESC LIMIT -1 OFFSET ?",
        MAX_SNAPSHOTS,
      )
      .toArray();
    if (doomed.length === 0) return;
    for (const row of doomed) this.sql.exec("DELETE FROM agent_snapshots WHERE id = ?", row.id);
    await this.bucket.delete(doomed.map((row) => row.object_key));
  }
}
