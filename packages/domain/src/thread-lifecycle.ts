// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

import type { ThreadStatus } from "./thread-status";

/**
 * What happened to a thread, in product terms. Callers report events instead
 * of choosing target statuses; THREAD_LIFECYCLE maps (status, event) → next
 * status and THREAD_LIFECYCLE_EVENT_PREDICATES declares which staleness
 * signals supersede each event.
 *
 * The execution status is the single source of truth for "what is this thread
 * doing": `idle` (quiescent), `starting` (preparing a run), `active` (agent
 * work is in progress), `stopping` (the current run/start is winding down),
 * and `error` (quiescent after failure). In-progress intent lives in the
 * status, not in side-fields: a requested stop IS `status = stopping`, not a
 * separate `stopRequestedAt`. The orthogonal record dimension (`archivedAt`)
 * is a field, surfaced here as a supersession predicate; `activeTurnId` names
 * WHICH run the status describes, so a settle for a turn that is no longer the
 * active one is a stale no-op rather than a wrong-turn transition.
 *
 * Vocabulary:
 * - `run.preparing` — new work needs preparation before it can run.
 * - `run.started` — the named turn is in progress.
 * - `run.succeeded` — the named run completed successfully.
 * - `run.failed` — the named run/start failed (null = a dispatch that never
 *   produced a turn).
 * - `stop.requested` — the user/system asked to stop the current run/start.
 * - `stop.settled` — stop/interruption of the named run finished.
 */
export type ThreadLifecycleEvent =
  | { type: "run.preparing" }
  | { type: "run.started"; turnId: string }
  | { type: "run.succeeded"; turnId: string | null }
  | { type: "run.failed"; turnId: string | null }
  | { type: "stop.requested" }
  | { type: "stop.settled"; turnId: string | null };

export type ThreadLifecycleEventType = ThreadLifecycleEvent["type"];

/**
 * Declarative supersession predicates: row-level staleness signals that turn
 * an otherwise-legal event into a "superseded" no-op. Only the orthogonal
 * record dimension remains — stop intent is not a predicate because it is the
 * `stopping` status (the table simply has no "begin new work" transition out
 * of `stopping`).
 */
export interface ThreadLifecycleSupersessionPredicates {
  notArchived?: true;
}

/** A closed table over the event vocabulary: every event names its predicates,
 *  so adding an event is a compile error here rather than a silent gap. */
type ThreadLifecycleEventPredicateTable = {
  [K in ThreadLifecycleEventType]: ThreadLifecycleSupersessionPredicates;
};

export const THREAD_LIFECYCLE_EVENT_PREDICATES: ThreadLifecycleEventPredicateTable = {
  "run.preparing": { notArchived: true },
  "run.started": { notArchived: true },
  "run.succeeded": {},
  "run.failed": {},
  "stop.requested": {},
  "stop.settled": {},
};

/**
 * The thread execution state machine. `stopping` is a first-class status that
 * captures the "stop requested" intent durably; dispatching new work into it
 * is structurally impossible (no `run.started` cell), which is what makes a
 * scheduled/queued turn unable to reactivate a stopping thread. Absent cell =
 * the event is a no-op in that status.
 */
/** Which events move a thread out of a status, and to where. An absent cell is
 *  an event that is a no-op in that status. */
type ThreadLifecycleTransitions = Partial<Record<ThreadLifecycleEventType, ThreadStatus>>;

/** Closed over the status vocabulary: a new status must declare its row. */
type ThreadLifecycleTable = { [K in ThreadStatus]: ThreadLifecycleTransitions };

export const THREAD_LIFECYCLE: ThreadLifecycleTable = {
  idle: {
    "run.preparing": "starting",
    "run.started": "active",
  },
  starting: {
    "run.started": "active",
    // A completed run may settle before run.started lands (the provider can
    // report turn/completed while the start command is still settling); the
    // completed run still lands the thread idle.
    "run.succeeded": "idle",
    "run.failed": "error",
    "stop.requested": "stopping",
  },
  active: {
    "run.succeeded": "idle",
    "run.failed": "error",
    "stop.requested": "stopping",
  },
  stopping: {
    "stop.settled": "idle",
    "run.succeeded": "idle",
    "run.failed": "error",
  },
  error: {
    "run.preparing": "starting",
    "run.started": "active",
  },
};

/** The thread-row fields lifecycle evaluation reads. */
export interface ThreadLifecycleRowState {
  /** The turn the current status describes; null whenever no run is bound. */
  activeTurnId: string | null;
  archivedAt: number | null;
  status: ThreadStatus;
}

export type ThreadLifecycleNoopReason = "illegal-transition" | "superseded" | "stale-turn";

export type ThreadLifecycleEvaluation =
  | { to: ThreadStatus; activeTurnId: string | null }
  | { noop: ThreadLifecycleNoopReason; detail: string };

export interface EvaluateThreadLifecycleEventArgs {
  event: ThreadLifecycleEvent;
  thread: ThreadLifecycleRowState;
}

/** Whether an event settles the thread's active turn, and which turn it names. */
interface SettlingTurn {
  settles: boolean;
  turnId: string | null;
}

/** The turn a settling event names, or a marker that the event settles nothing. */
function settlingTurnId(event: ThreadLifecycleEvent): SettlingTurn {
  switch (event.type) {
    case "run.succeeded":
    case "run.failed":
    case "stop.settled":
      return { settles: true, turnId: event.turnId };
    case "run.preparing":
    case "run.started":
    case "stop.requested":
      return { settles: false, turnId: null };
  }
}

/**
 * Pure evaluation of a lifecycle event against a loaded thread row.
 * Supersession and turn identity are checked before table lookup, so a stale
 * event on an archived thread — or a settle for a turn that is no longer the
 * active one — reports its true diagnosis even when the current status has no
 * cell for it. An applied evaluation carries the next
 * `activeTurnId` alongside the next status: run.started binds the named
 * turn, every settle unbinds it, everything else carries it over.
 */
export function evaluateThreadLifecycleEvent(
  args: EvaluateThreadLifecycleEventArgs,
): ThreadLifecycleEvaluation {
  const { event, thread } = args;
  const predicates = THREAD_LIFECYCLE_EVENT_PREDICATES[event.type];
  if (predicates.notArchived && thread.archivedAt !== null) {
    return { noop: "superseded", detail: "archivedAt set" };
  }

  const settling = settlingTurnId(event);
  if (settling.settles && settling.turnId !== thread.activeTurnId) {
    return {
      noop: "stale-turn",
      detail: `${event.type} names turn ${settling.turnId ?? "<none>"} but the active turn is ${thread.activeTurnId ?? "<none>"}`,
    };
  }

  const to = THREAD_LIFECYCLE[thread.status][event.type];
  if (to === undefined) {
    return {
      noop: "illegal-transition",
      detail: `no transition for ${event.type} from status ${thread.status}`,
    };
  }
  return {
    to,
    activeTurnId:
      event.type === "run.started" ? event.turnId : settling.settles ? null : thread.activeTurnId,
  };
}
