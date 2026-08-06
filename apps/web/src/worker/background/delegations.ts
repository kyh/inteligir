// ---------------------------------------------------------------------------
// Checkbox delegation, in the user's own Durable Object.
//
// A delegation is created when the user (or the chat agent) hands one `- [ ]`
// line to the background agent. It is persisted, queued, and run one at a time
// on the background lane (./background-runs) — which the routines manager
// shares, so an unattended turn never interleaves with another one.
//
// THREE THINGS FROM THE DESKTOP ARE PRESERVED BECAUSE THEY ENCODE PRODUCT
// MEANING, not because they were there:
//
//   • The checkbox is re-resolved against the file's CURRENT bytes at dispatch
//     and refused when the anchor text no longer matches. The ordinal is a
//     position, so a checkbox inserted above this one while it sat queued would
//     silently point the agent at a different task — and a delegated action can
//     be irreversible.
//   • The restore point is captured BEFORE the turn dispatches, fail-closed. The
//     agent edits the file with its own tools, so the host cannot intercept the
//     write; an agent edit the user cannot revert must never happen, and a
//     capture failure is therefore the reason the run does not start.
//   • The queue is serialized and event-driven. A settled run pumps the next
//     one; nothing polls.
//
// The RECORD is the wire shape, stored as validated JSON. The registry's
// `DelegationSchema` is a discriminated union over `status` whose illegal
// combinations cannot be constructed, and re-deriving it from columns would be
// a second shape to keep in step. A row that does not check is projected as a
// FAILED record naming itself rather than repaired with invented fields —
// delegations are documented transient, and a record nothing can read is not
// one to guess at.
// ---------------------------------------------------------------------------

import {
  DelegationSchema,
  type CreateDelegationParams,
  type CreateDelegationResult,
  type Delegation,
  type ListDelegationsResult,
  type RestoreSnapshotResult,
} from "@repo/bridge/delegation";
import { toErrorMessage } from "@repo/bridge/wire-helpers";
import { findTaskLine } from "@repo/notes/knowledge/find-task-line";
import { Value } from "@sinclair/typebox/value";

import type { AgentSnapshots } from "../agent/agent-snapshots";
import type {
  BackgroundDispatch,
  BackgroundOutcome,
  BackgroundRun,
  BackgroundRuns,
} from "./background-runs";

/** Records kept. Past this the OLDEST TERMINAL rows go — never a queued or
 * running one, because dropping work the user is waiting on makes its badge
 * vanish with no feedback. */
const MAX_DELEGATIONS = 200;

/** Longest result summary kept on the record. */
const SUMMARY_LEN = 200;

type DelegationRow = {
  readonly id: string;
  readonly created_at: number;
  readonly status: string;
  readonly snapshot_id: string | null;
  readonly record: string;
};

/** The vault reads a delegation needs. Structural so the tests drive the real
 * queue over the object's real vault. */
type DelegationVault = {
  readText(path: string): Promise<string>;
};

export type DelegationsDeps = {
  readonly sql: SqlStorage;
  readonly vault: DelegationVault;
  readonly snapshots: AgentSnapshots;
  /** The shared lane, read for "is MY delegation the one running". */
  readonly runs: BackgroundRuns;
  readonly dispatch: BackgroundDispatch;
  /** Ask the in-flight turn to stop — the cancel path's half that reaches the
   * container. */
  readonly interrupt: () => Promise<void>;
  /** Why a run cannot be attempted at all right now (no provider connected),
   * or null. Read per attempt rather than latched: connecting a provider must
   * make the next create work without anything resetting a flag. */
  readonly refusalReason: () => string | null;
  readonly onChanged: (result: ListDelegationsResult) => void;
  readonly onStreamed: (id: string, text: string) => void;
};

export class Delegations {
  private readonly deps: DelegationsDeps;

  constructor(deps: DelegationsDeps) {
    this.deps = deps;
    deps.sql.exec(
      `CREATE TABLE IF NOT EXISTS agent_delegations (
         id TEXT PRIMARY KEY,
         created_at INTEGER NOT NULL,
         status TEXT NOT NULL,
         turn_id TEXT,
         snapshot_id TEXT,
         record TEXT NOT NULL
       )`,
    );
    deps.sql.exec(
      "CREATE INDEX IF NOT EXISTS agent_delegations_queue ON agent_delegations (status, created_at)",
    );
  }

  // ---- reads ---------------------------------------------------------------

  list(): ListDelegationsResult {
    return { delegations: this.rows().map((row) => this.toDelegation(row)) };
  }

  /** How many delegations one agent turn has already queued — the cap's
   * counter. Durable, because the turn it counts spans invocations. */
  queuedInTurn(turnId: string): number {
    const row = this.deps.sql
      .exec<{ n: number }>("SELECT COUNT(*) AS n FROM agent_delegations WHERE turn_id = ?", turnId)
      .toArray()[0];
    return row?.n ?? 0;
  }

  // ---- the user's (and the agent's) verbs -----------------------------------

  /**
   * Create and enqueue a delegation.
   *
   * The checkbox is resolved from the file FIRST, so a stale or already-checked
   * line is refused before anything is persisted — immediate feedback rather
   * than a record that fails a minute later.
   *
   * `turnId` marks the agent turn that asked, and is what the per-turn cap
   * counts; a delegation the user created carries none.
   */
  async create(
    params: CreateDelegationParams,
    turnId: string | null = null,
  ): Promise<CreateDelegationResult> {
    const refusal = this.deps.refusalReason();
    if (refusal !== null) return { ok: false, error: refusal };

    let raw: string;
    try {
      raw = await this.deps.vault.readText(params.sourceFile);
    } catch (error) {
      return { ok: false, error: `Couldn't read ${params.sourceFile}: ${toErrorMessage(error)}` };
    }
    const match = findTaskLine(raw, params.ordinal);
    if (match === null) {
      return {
        ok: false,
        error: "That checkbox is no longer in the file — save your edits first.",
      };
    }

    const delegation: Delegation = {
      id: crypto.randomUUID(),
      sourceFile: params.sourceFile,
      anchor: { ordinal: params.ordinal, text: match.text, heading: match.heading },
      lineText: match.lineText.trim(),
      status: "queued",
      createdAt: Date.now(),
      startedAt: null,
      finishedAt: null,
      resultSummary: null,
      error: null,
      hasSnapshot: false,
      restoredAt: null,
    };
    this.deps.sql.exec(
      `INSERT INTO agent_delegations (id, created_at, status, turn_id, snapshot_id, record)
       VALUES (?, ?, 'queued', ?, NULL, ?)`,
      delegation.id,
      delegation.createdAt,
      turnId,
      JSON.stringify(delegation),
    );
    this.evict();
    this.notify();
    await this.pump();
    return { ok: true, delegation };
  }

  /** Stop a delegation: interrupt it when it is the run holding the lane (the
   * run settles as stopped once the container reports the turn ended), or drop
   * it from the queue. */
  async cancel(id: string): Promise<{ ok: boolean }> {
    const running = this.runningFor(id);
    if (running !== null) {
      this.deps.runs.requestStop(running.turnId);
      await this.deps.interrupt();
      return { ok: true };
    }
    const row = this.rowAt(id);
    if (row === null || row.status !== "queued") return { ok: false };
    this.deps.sql.exec("DELETE FROM agent_delegations WHERE id = ?", id);
    this.notify();
    return { ok: true };
  }

  /**
   * Put the source file back to the bytes captured before this delegation ran.
   *
   * The RECORD side is here and the byte side is the snapshot store's: a
   * restore while the run is still queued or running is refused, because it
   * would race the agent's own edits, and `restoredAt` is stamped on success —
   * a no-op restore counts, since the user's intent succeeded.
   */
  async restoreSnapshot(id: string): Promise<RestoreSnapshotResult> {
    const row = this.rowAt(id);
    if (row === null) return { ok: false, error: "Unknown delegation." };
    if (row.status === "queued" || row.status === "running") {
      return { ok: false, error: "Wait for the delegation to finish before restoring." };
    }
    if (row.snapshot_id === null || !this.deps.snapshots.holds(row.snapshot_id)) {
      return { ok: false, error: "No saved copy exists for this delegation." };
    }
    const restored = await this.deps.snapshots.restore([row.snapshot_id], "delegation");
    if (!restored.ok) return { ok: false, error: restored.reason };
    this.patch(id, (current) =>
      current.status === "done" || current.status === "failed"
        ? { ...current, restoredAt: Date.now() }
        : current,
    );
    return { ok: true };
  }

  // ---- the queue -----------------------------------------------------------

  /**
   * Run the oldest queued delegation if the background lane is free.
   *
   * Never awaits the turn — the dispatch returns as soon as the container has
   * accepted it, and the run settles later through the report path. A refusal
   * fails the record and pumps again, so one bad anchor cannot wedge the queue.
   */
  async pump(): Promise<void> {
    for (;;) {
      const next = this.deps.sql
        .exec<DelegationRow>(
          `SELECT id, created_at, status, snapshot_id, record FROM agent_delegations
           WHERE status = 'queued' ORDER BY created_at, id LIMIT 1`,
        )
        .toArray()[0];
      if (next === undefined) return;

      // The restore point is recorded on the ROW inside prepare rather than in
      // a closure: the settle that reads it back happens in a later
      // invocation, so nothing that only exists in memory can carry it.
      const outcome = await this.deps.dispatch("delegation", next.id, async () => {
        const resolved = await this.resolveForRun(next.id);
        if (!resolved.ok) return resolved;
        // Fail-closed: no restore point, no run (see the header).
        const snapshotId = await this.deps.snapshots.capture(
          { origin: "delegation", ref: next.id },
          resolved.delegation.sourceFile,
        );
        if (snapshotId === null) {
          return {
            ok: false,
            error: `Couldn't save a restore point for ${resolved.delegation.sourceFile}, so the task did not run.`,
          };
        }
        this.deps.sql.exec(
          "UPDATE agent_delegations SET snapshot_id = ? WHERE id = ?",
          snapshotId,
          next.id,
        );
        return { ok: true, prompt: buildPrompt(resolved.delegation) };
      });

      if (outcome.ok) {
        this.patch(next.id, (current) =>
          current.status === "queued"
            ? { ...current, status: "running", startedAt: Date.now(), hasSnapshot: true }
            : current,
        );
        this.notify();
        return;
      }
      if (outcome.reason === "busy") return;
      this.fail(next.id, outcome.error);
      this.notify();
    }
  }

  /** Fold one background report's streamed text into the live badge. */
  stream(run: BackgroundRun, transcript: string): void {
    this.deps.onStreamed(run.ref, transcript);
  }

  /** Record how a run ended. Only a RUNNING record is settled: a run can end
   * after a cancel already failed it, and without this guard the late patch
   * would resurrect it as done. */
  settle(run: BackgroundRun, outcome: BackgroundOutcome): void {
    const row = this.rowAt(run.ref);
    if (row === null || row.status !== "running") return;
    if (outcome.kind === "done") {
      const summary = outcome.text.trim().slice(0, SUMMARY_LEN);
      this.patch(run.ref, (current) =>
        current.status === "running"
          ? {
              ...current,
              status: "done",
              finishedAt: Date.now(),
              resultSummary: summary === "" ? "Done" : summary,
            }
          : current,
      );
    } else {
      this.fail(run.ref, outcome.kind === "stopped" ? "Stopped." : outcome.error);
    }
    this.notify();
  }

  // ---- internals -----------------------------------------------------------

  /**
   * Re-resolve the checkbox against the file's current bytes.
   *
   * The anchor is an ORDINAL: a checkbox inserted or removed above this one
   * while it sat queued lands it on a DIFFERENT task. Both texts come from the
   * same locator (at create time and now), so comparing them is consistent, and
   * a mismatch fails safe rather than acting on the wrong line.
   */
  private async resolveForRun(
    id: string,
  ): Promise<{ ok: true; delegation: Delegation } | { ok: false; error: string }> {
    const row = this.rowAt(id);
    if (row === null) return { ok: false, error: "Unknown delegation." };
    const delegation = this.toDelegation(row);
    let raw: string;
    try {
      raw = await this.deps.vault.readText(delegation.sourceFile);
    } catch (error) {
      return {
        ok: false,
        error: `Couldn't read ${delegation.sourceFile}: ${toErrorMessage(error)}`,
      };
    }
    const match = findTaskLine(raw, delegation.anchor.ordinal);
    if (match === null) return { ok: false, error: "That checkbox is no longer in the file." };
    if (match.text !== delegation.anchor.text) {
      return {
        ok: false,
        error: "The note changed since you delegated this — re-delegate the task.",
      };
    }
    // UNTRIMMED: this is the exact raw line the run was resolved against, which
    // is the guard bytes any later host-side write-back would quote.
    const fresh: Delegation = {
      ...delegation,
      lineText: match.lineText,
      anchor: { ...delegation.anchor, heading: match.heading },
    };
    if (
      fresh.lineText !== delegation.lineText ||
      fresh.anchor.heading !== delegation.anchor.heading
    ) {
      this.write(fresh, row.snapshot_id);
    }
    return { ok: true, delegation: fresh };
  }

  /** The lane's run for `id`, when it is this delegation's. */
  private runningFor(id: string): BackgroundRun | null {
    const run = this.deps.runs.holder();
    return run !== null && run.owner === "delegation" && run.ref === id ? run : null;
  }

  private rows(): DelegationRow[] {
    return this.deps.sql
      .exec<DelegationRow>(
        `SELECT id, created_at, status, snapshot_id, record FROM agent_delegations
         ORDER BY created_at, id`,
      )
      .toArray();
  }

  private rowAt(id: string): DelegationRow | null {
    return (
      this.deps.sql
        .exec<DelegationRow>(
          "SELECT id, created_at, status, snapshot_id, record FROM agent_delegations WHERE id = ?",
          id,
        )
        .toArray()[0] ?? null
    );
  }

  /**
   * The record as the wire declares it, with `hasSnapshot` resolved against the
   * store rather than stored.
   *
   * Computed, because retention prunes bytes out from under a record: a stored
   * flag would offer a restore whose bytes are gone, which is the thing the
   * desktop needed a whole prune-fanout pass to avoid.
   */
  private toDelegation(row: DelegationRow): Delegation {
    const parsed: unknown = JSON.parse(row.record);
    if (!Value.Check(DelegationSchema, parsed)) {
      // Unreachable through this class — every write goes through `write`,
      // which serializes a checked union. A row that does not check belongs to
      // a shape this build cannot read, and reporting it as failed is the only
      // honest projection: it names itself instead of vanishing from the list.
      return unreadable(row);
    }
    const held = row.snapshot_id !== null && this.deps.snapshots.holds(row.snapshot_id);
    return parsed.status === "queued" ? parsed : { ...parsed, hasSnapshot: held };
  }

  private write(delegation: Delegation, snapshotId: string | null): void {
    this.deps.sql.exec(
      "UPDATE agent_delegations SET status = ?, snapshot_id = ?, record = ? WHERE id = ?",
      delegation.status,
      snapshotId,
      JSON.stringify(delegation),
      delegation.id,
    );
  }

  private patch(id: string, transform: (current: Delegation) => Delegation): void {
    const row = this.rowAt(id);
    if (row === null) return;
    this.write(transform(this.toDelegation(row)), row.snapshot_id);
  }

  private fail(id: string, error: string): void {
    this.patch(id, (current) =>
      current.status === "queued" || current.status === "running"
        ? { ...current, status: "failed", finishedAt: Date.now(), error }
        : current,
    );
  }

  /** Trim the oldest TERMINAL records past the cap. Active work is never
   * dropped, so a vault over the cap keeps slightly more than it. */
  private evict(): void {
    const doomed = this.deps.sql
      .exec<{ id: string }>(
        `SELECT id FROM agent_delegations WHERE status IN ('done','failed')
         ORDER BY created_at DESC, id DESC LIMIT -1 OFFSET ?`,
        Math.max(MAX_DELEGATIONS - this.activeCount(), 0),
      )
      .toArray();
    for (const row of doomed) {
      this.deps.sql.exec("DELETE FROM agent_delegations WHERE id = ?", row.id);
    }
  }

  private activeCount(): number {
    const row = this.deps.sql
      .exec<{ n: number }>(
        "SELECT COUNT(*) AS n FROM agent_delegations WHERE status IN ('queued','running')",
      )
      .toArray()[0];
    return row?.n ?? 0;
  }

  private notify(): void {
    this.deps.onChanged(this.list());
  }
}

/** The projection of a record this build cannot read — see `toDelegation`. */
function unreadable(row: DelegationRow): Delegation {
  return {
    id: row.id,
    sourceFile: "",
    anchor: { ordinal: 0, text: "", heading: null },
    lineText: "",
    status: "failed",
    createdAt: row.created_at,
    startedAt: null,
    finishedAt: row.created_at,
    resultSummary: null,
    error: "This delegation was recorded in a format this version cannot read.",
    hasSnapshot: false,
    restoredAt: null,
  };
}

/** The instruction the background agent runs. It edits the file directly. */
function buildPrompt(delegation: Delegation): string {
  const where = delegation.anchor.heading
    ? ` under the "${delegation.anchor.heading}" section`
    : "";
  return [
    `You've been delegated a single to-do item from a markdown note. Do it, then record the outcome in the file.`,
    ``,
    `File: ./vault/${delegation.sourceFile}`,
    `Task${where}: ${delegation.anchor.text}`,
    ``,
    `Steps:`,
    `1. Do the task. Use your file tools and any connected tools as needed.`,
    `2. In ./vault/${delegation.sourceFile}, find the line "${delegation.lineText}" and change its checkbox from "[ ]" to "[x]".`,
    `3. Immediately under that line, add a nested sub-item with a one-line result, indented two spaces DEEPER than the checkbox line's own indentation (its "-" should sit under the checkbox's text — so a top-level task gets a 2-space indent, a once-nested task 4, and so on), e.g. "  - ✅ <what you did>". If you couldn't complete it, note why instead and leave the checkbox unchecked.`,
    `Keep edits minimal — change only those lines. Don't reformat the rest of the file. Reply with a one-sentence summary of what you did.`,
  ].join("\n");
}
