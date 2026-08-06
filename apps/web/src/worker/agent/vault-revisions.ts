// ---------------------------------------------------------------------------
// A bounded change log over the vault, so materializing `./vault` on a wake is
// usually a delta rather than the whole manifest.
//
// It exists because of one platform fact: the container's filesystem is deleted
// every time it sleeps, and a sleep is the NORMAL state of an agent nobody is
// currently talking to. So the vault is pushed in on every wake, and a user
// with a few thousand notes would otherwise pay a full re-push for every
// message after a coffee break.
//
// The log is bounded and the fallback is total. Past the window there is no
// attempt to reconstruct a delta from timestamps or hashes — the answer is
// "send everything", which is always correct and is what a cold container needs
// anyway. A delta that might be missing a path is worse than no delta at all:
// the agent would read a note the user has since changed and have no way to
// know.
// ---------------------------------------------------------------------------

import type { VaultChange } from "../host/vault/user-vault";

/** Entries kept. Past this the next wake re-materializes the whole vault, which
 * is the same work a cold container does and is never wrong. */
const MAX_LOG_ENTRIES = 5_000;

export type VaultDelta = {
  readonly upserted: readonly string[];
  readonly removed: readonly string[];
};

export class VaultRevisions {
  private readonly sql: SqlStorage;

  constructor(sql: SqlStorage) {
    this.sql = sql;
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS agent_vault_log (
         rev INTEGER PRIMARY KEY,
         path TEXT NOT NULL,
         removed INTEGER NOT NULL
       )`,
    );
  }

  /** The revision the vault is at right now. Zero means nothing has ever been
   * logged, which a container can never have materialized — so a container
   * reporting zero always gets the whole vault. */
  current(): number {
    const row = this.sql
      .exec<{ rev: number | null }>("SELECT MAX(rev) AS rev FROM agent_vault_log")
      .toArray()[0];
    return row?.rev ?? 0;
  }

  /** Log one mutation. Called from the vault's own change callback, so every
   * writer — the browser, the agent, the upload route — moves the revision. */
  record(change: VaultChange): void {
    for (const file of change.upserted) this.append(file.path, false);
    for (const path of change.removed) this.append(path, true);
    this.prune();
  }

  /**
   * What changed since `from`, or `null` when the log no longer reaches back
   * that far — in which case the caller must push the whole vault.
   *
   * A path that was written and then deleted inside the window appears only as
   * a removal, and one deleted and rewritten only as an upsert: the container
   * needs the END STATE, not the history, and replaying both would have it
   * apply the wrong one depending on iteration order.
   */
  since(from: number): VaultDelta | null {
    if (from <= 0) return null;
    const oldest = this.sql
      .exec<{ rev: number | null }>("SELECT MIN(rev) AS rev FROM agent_vault_log")
      .toArray()[0];
    // `from` is the last revision the container HAS, so the log must still hold
    // the entry after it. An empty log with a non-zero `from` means every entry
    // was pruned.
    if (oldest?.rev == null || oldest.rev > from + 1) return null;
    const rows = this.sql
      .exec<{ path: string; removed: number }>(
        "SELECT path, removed FROM agent_vault_log WHERE rev > ? ORDER BY rev",
        from,
      )
      .toArray();
    const state = new Map<string, boolean>();
    for (const row of rows) state.set(row.path, row.removed === 1);
    const upserted: string[] = [];
    const removed: string[] = [];
    for (const [path, isRemoved] of state) (isRemoved ? removed : upserted).push(path);
    return { upserted, removed };
  }

  private append(path: string, removed: boolean): void {
    // One row per path per revision: the log is a sequence of facts, and
    // collapsing them here would lose the ordering `since` folds over.
    this.sql.exec(
      "INSERT INTO agent_vault_log (rev, path, removed) VALUES (?, ?, ?)",
      this.current() + 1,
      path,
      removed ? 1 : 0,
    );
  }

  private prune(): void {
    const cutoff = this.sql
      .exec<{ rev: number }>(
        "SELECT rev FROM agent_vault_log ORDER BY rev DESC LIMIT 1 OFFSET ?",
        MAX_LOG_ENTRIES,
      )
      .toArray()[0];
    if (cutoff === undefined) return;
    this.sql.exec("DELETE FROM agent_vault_log WHERE rev <= ?", cutoff.rev);
  }
}
