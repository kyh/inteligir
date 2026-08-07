// ---------------------------------------------------------------------------
// The background lane — one unattended turn at a time, and the record of the
// one that is running.
//
// This is the desktop's BackgroundTurnLock, and the reason it is a TABLE rather
// than a field is the execution model, not the tenancy. On the desktop a run
// was an awaited in-process call, so "a turn is in flight" could live in a
// closure for exactly as long as the call did. Here a run spans MANY
// invocations: the object dispatches, returns, is evicted, and the turn's
// progress arrives minutes later as separate requests. An in-memory lock would
// read as FREE on the very next invocation and let a routine start on top of a
// running delegation. So the lock is durable, and the row that holds it is the
// run it is holding the lane for — the lock and the thing it protects are one
// fact rather than two that can disagree.
//
// (Module scope would be worse still: one isolate serves many tenants' objects,
// so a module-level lock would serialize one user's delegations against
// another's. The instance-per-object rule ./host/host-events states applies
// here for the same reason.)
//
// EVERY LEASE EXPIRES. A container that dies mid-turn never reports
// `turn_end`, and a lane held by a turn nobody is running is a lane no
// delegation ever leaves the queue for. The row therefore carries a deadline
// the host's alarm sweeps, which is also why the lane has a `nextDueAt`.
// ---------------------------------------------------------------------------

/** Which surface a background turn belongs to. The two share the lane on
 * purpose: they share a container, and an unattended turn interleaved with
 * another unattended turn is two agents editing one vault with nobody
 * watching. */
export type BackgroundOwner = "delegation" | "routine";

/**
 * How long a background turn may hold the lane before the sweep reclaims it and
 * the owner records a timeout.
 *
 * A BACKSTOP, not a budget: a turn that reports normally releases the lane the
 * moment it ends, so this only ever fires for a container that died without
 * saying so. Ten minutes is therefore chosen against the two failure modes it
 * sits between — shorter, and a legitimately long turn is killed and its work
 * lost; longer, and every queued delegation waits that much longer behind a
 * lane nobody is running. Tune it if real turns start being reclaimed mid-run;
 * that is the signal, not the wall-clock number.
 */
const BACKGROUND_RUN_TIMEOUT_MS = 10 * 60 * 1000;

/** The lane's current holder, as its row. */
export type BackgroundRun = {
  readonly turnId: string;
  readonly owner: BackgroundOwner;
  /** What the owner keyed this run by: a delegation id, or a routine run id. */
  readonly ref: string;
  readonly startedAt: number;
  readonly expiresAt: number;
  /** The user asked for this run to stop; the owner settles it as stopped once
   * the container reports the turn ended. */
  readonly stopRequested: boolean;
  /** The transcript accumulated so far — assistant text plus a line per tool
   * call, which is what the response dock renders live. */
  readonly transcript: string;
  /** The last complete assistant message. The transcript is for watching; this
   * is what the owner records as the run's result. */
  readonly result: string;
  /** An in-band failure the session reported, empty when there was none. Kept
   * apart from `result` because a turn can end without the container itself
   * failing — the model errored, and the reason is the outcome rather than
   * text to append to a note. */
  readonly failure: string;
};

type RunRow = {
  readonly turn_id: string;
  readonly owner: string;
  readonly ref: string;
  readonly started_at: number;
  readonly expires_at: number;
  readonly stop_requested: number;
  readonly transcript: string;
  readonly result: string;
  readonly failure: string;
};

/** What the owner resolved once it held the lane: the prompt to run, or the
 * reason this run must not happen (a checkbox that moved, a restore point that
 * could not be saved). */
export type BackgroundPrepared =
  | { readonly ok: true; readonly prompt: string }
  | { readonly ok: false; readonly error: string };

/**
 * Entering the lane, as an owner sees it.
 *
 * `busy` and `refused` stay distinct because the owner answers them
 * differently: a busy lane leaves the work QUEUED for the next pump, while a
 * refusal is terminal and the record fails with the sentence.
 */
export type BackgroundDispatchOutcome =
  | { readonly ok: true; readonly run: BackgroundRun }
  | { readonly ok: false; readonly reason: "busy" }
  | { readonly ok: false; readonly reason: "refused"; readonly error: string };

/**
 * Take the lane, resolve the run against it, and hand the turn to the
 * container.
 *
 * `prepare` runs AFTER the lane is claimed and BEFORE the dispatch — which is
 * the whole ordering the desktop's managers keep: the checkbox is re-resolved
 * and the restore point captured while nothing else can start a turn, and a
 * failure at either step releases the lane instead of stranding it.
 */
export type BackgroundDispatch = (
  owner: BackgroundOwner,
  ref: string,
  prepare: (run: BackgroundRun) => Promise<BackgroundPrepared>,
) => Promise<BackgroundDispatchOutcome>;

/** How a background turn ended, as the owner records it. */
export type BackgroundOutcome =
  | { readonly kind: "done"; readonly text: string }
  | { readonly kind: "failed"; readonly error: string }
  | { readonly kind: "stopped" };

export class BackgroundRuns {
  private readonly sql: SqlStorage;

  constructor(sql: SqlStorage) {
    this.sql = sql;
    // Synchronous, so the table exists before anything else in the object's
    // construction can reach it. `agent_` prefixed because this object's
    // SQLite is shared with the vault manifest and the knowledge index.
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS agent_background_runs (
         turn_id TEXT PRIMARY KEY,
         owner TEXT NOT NULL,
         ref TEXT NOT NULL,
         started_at INTEGER NOT NULL,
         expires_at INTEGER NOT NULL,
         stop_requested INTEGER NOT NULL,
         transcript TEXT NOT NULL,
         result TEXT NOT NULL,
         failure TEXT NOT NULL
       )`,
    );
  }

  /** The run holding the lane, or null when it is free. */
  holder(): BackgroundRun | null {
    const row = this.sql
      .exec<RunRow>(
        `SELECT turn_id, owner, ref, started_at, expires_at, stop_requested,
                transcript, result, failure
         FROM agent_background_runs ORDER BY started_at LIMIT 1`,
      )
      .toArray()[0];
    return row === undefined ? null : toRun(row);
  }

  /**
   * Take the lane for `owner`/`ref`, or answer null because another turn holds
   * it.
   *
   * Non-blocking, exactly as the desktop's `tryAcquire` is: both owners already
   * have a queue and a pump, so contention re-uses them. A waiter queue here
   * would add an ordering problem and a deadlock surface to buy nothing.
   *
   * SQLite's synchronous API is what makes the read-then-insert atomic — no
   * other caller can interleave inside one JS turn.
   */
  claim(owner: BackgroundOwner, ref: string, now: number): BackgroundRun | null {
    if (this.holder() !== null) return null;
    const run: BackgroundRun = {
      turnId: crypto.randomUUID(),
      owner,
      ref,
      startedAt: now,
      expiresAt: now + BACKGROUND_RUN_TIMEOUT_MS,
      stopRequested: false,
      transcript: "",
      result: "",
      failure: "",
    };
    this.sql.exec(
      `INSERT INTO agent_background_runs
         (turn_id, owner, ref, started_at, expires_at, stop_requested, transcript, result, failure)
       VALUES (?, ?, ?, ?, ?, 0, '', '', '')`,
      run.turnId,
      run.owner,
      run.ref,
      run.startedAt,
      run.expiresAt,
    );
    return run;
  }

  /** Give the lane back. A turn id that is not the holder is a no-op — a
   * reclaimed lease settles late, and its release must not free the lane a
   * successor now holds. */
  release(turnId: string): void {
    this.sql.exec("DELETE FROM agent_background_runs WHERE turn_id = ?", turnId);
  }

  /** The run `turnId` names, or null when it is no longer the holder. The
   * report path's own check: a report for a reclaimed turn folds into nothing
   * rather than into whatever is running now. */
  runAt(turnId: string): BackgroundRun | null {
    const run = this.holder();
    return run !== null && run.turnId === turnId ? run : null;
  }

  /** Add to the live transcript — an assistant delta, or a line naming a tool
   * the run just invoked. */
  appendTranscript(turnId: string, text: string): string | null {
    const run = this.runAt(turnId);
    if (run === null) return null;
    const transcript = run.transcript + text;
    this.sql.exec(
      "UPDATE agent_background_runs SET transcript = ? WHERE turn_id = ?",
      transcript,
      turnId,
    );
    return transcript;
  }

  /** Record the run's latest complete assistant message. */
  setResult(turnId: string, text: string): void {
    if (this.runAt(turnId) === null) return;
    this.sql.exec("UPDATE agent_background_runs SET result = ? WHERE turn_id = ?", text, turnId);
  }

  /** Record an in-band session failure — the reason the run reports instead of
   * a result. */
  setFailure(turnId: string, reason: string): void {
    if (this.runAt(turnId) === null) return;
    this.sql.exec("UPDATE agent_background_runs SET failure = ? WHERE turn_id = ?", reason, turnId);
  }

  /** Mark that the user asked this run to stop. The owner reads it back when
   * the turn ends, so a stop beats a timeout in the recorded outcome. */
  requestStop(turnId: string): void {
    this.sql.exec("UPDATE agent_background_runs SET stop_requested = 1 WHERE turn_id = ?", turnId);
  }

  /** When the lane next needs the host's attention: the holder's lease
   * deadline, or null when nothing holds it. Folded into the object's ONE
   * alarm (see ./host/user-host). */
  nextDueAt(): number | null {
    return this.holder()?.expiresAt ?? null;
  }

  /** The holder whose lease has run out, or null. */
  expired(now: number): BackgroundRun | null {
    const run = this.holder();
    return run !== null && run.expiresAt <= now ? run : null;
  }
}

function toRun(row: RunRow): BackgroundRun {
  return {
    turnId: row.turn_id,
    owner: row.owner === "routine" ? "routine" : "delegation",
    ref: row.ref,
    startedAt: row.started_at,
    expiresAt: row.expires_at,
    stopRequested: row.stop_requested !== 0,
    transcript: row.transcript,
    result: row.result,
    failure: row.failure,
  };
}
