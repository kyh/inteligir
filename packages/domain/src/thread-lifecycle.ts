// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

import type { ThreadStatus } from "./thread-status";

// callers report events; THREAD_LIFECYCLE maps (status, event) to the next status. intent lives
// in the status (a requested stop is `stopping`, not a side field), and `activeTurnId` names
// which run the status describes, so a settle for another turn is a stale no-op. a null turnId
// on a settle is a dispatch that never produced a turn.
export type ThreadLifecycleEvent =
  | { type: "run.preparing" }
  | { type: "run.started"; turnId: string }
  | { type: "run.succeeded"; turnId: string | null }
  | { type: "run.failed"; turnId: string | null }
  | { type: "stop.requested" }
  | { type: "stop.settled"; turnId: string | null };

export type ThreadLifecycleEventType = ThreadLifecycleEvent["type"];

// stop intent is not a predicate: it is the `stopping` status. settles carry no predicate, or
// an archive mid-run would wedge the status forever.
export interface ThreadLifecycleSupersessionPredicates {
  notArchived?: true;
}

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

// an absent cell is a no-op in that status.
type ThreadLifecycleTransitions = Partial<Record<ThreadLifecycleEventType, ThreadStatus>>;

type ThreadLifecycleTable = { [K in ThreadStatus]: ThreadLifecycleTransitions };

// `stopping` has no run.started / run.preparing cell on purpose: a queued turn must not
// reactivate a stopping thread.
export const THREAD_LIFECYCLE: ThreadLifecycleTable = {
  idle: {
    "run.preparing": "starting",
    "run.started": "active",
  },
  starting: {
    "run.started": "active",
    // the provider can report turn/completed while the start command is still settling.
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

export interface ThreadLifecycleRowState {
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

interface SettlingTurn {
  settles: boolean;
  turnId: string | null;
}

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

// supersession and turn identity are checked before the table so a stale event reports its true
// diagnosis even when the status has no cell for it.
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
