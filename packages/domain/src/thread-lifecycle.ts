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
  "run.failed": {},
  "run.preparing": { notArchived: true },
  "run.started": { notArchived: true },
  "run.succeeded": {},
  "stop.requested": {},
  "stop.settled": {},
};

// an absent cell is a no-op in that status.
type ThreadLifecycleTransitions = Partial<Record<ThreadLifecycleEventType, ThreadStatus>>;

type ThreadLifecycleTable = { [K in ThreadStatus]: ThreadLifecycleTransitions };

// `stopping` has no run.started / run.preparing cell on purpose: a queued turn must not
// reactivate a stopping thread.
export const THREAD_LIFECYCLE: ThreadLifecycleTable = {
  active: {
    "run.failed": "error",
    "run.succeeded": "idle",
    "stop.requested": "stopping",
  },
  error: {
    "run.preparing": "starting",
    "run.started": "active",
  },
  idle: {
    "run.preparing": "starting",
    "run.started": "active",
  },
  starting: {
    "run.failed": "error",
    "run.started": "active",
    // the provider can report turn/completed while the start command is still settling.
    "run.succeeded": "idle",
    "stop.requested": "stopping",
  },
  stopping: {
    "run.failed": "error",
    "run.succeeded": "idle",
    "stop.settled": "idle",
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

const settlingTurnId = (event: ThreadLifecycleEvent): SettlingTurn => {
  switch (event.type) {
    case "run.succeeded":
    case "run.failed":
    case "stop.settled": {
      return { settles: true, turnId: event.turnId };
    }
    case "run.preparing":
    case "run.started":
    case "stop.requested": {
      return { settles: false, turnId: null };
    }
    // no default
  }
};

// supersession and turn identity are checked before the table so a stale event reports its true
// diagnosis even when the status has no cell for it.
export const evaluateThreadLifecycleEvent = (
  args: EvaluateThreadLifecycleEventArgs,
): ThreadLifecycleEvaluation => {
  const { event, thread } = args;
  const predicates = THREAD_LIFECYCLE_EVENT_PREDICATES[event.type];
  if (predicates.notArchived && thread.archivedAt !== null) {
    return { detail: "archivedAt set", noop: "superseded" };
  }

  const settling = settlingTurnId(event);
  if (settling.settles && settling.turnId !== thread.activeTurnId) {
    return {
      detail: `${event.type} names turn ${settling.turnId ?? "<none>"} but the active turn is ${thread.activeTurnId ?? "<none>"}`,
      noop: "stale-turn",
    };
  }

  const to = THREAD_LIFECYCLE[thread.status][event.type];
  if (to === undefined) {
    return {
      detail: `no transition for ${event.type} from status ${thread.status}`,
      noop: "illegal-transition",
    };
  }
  let { activeTurnId } = thread;
  if (event.type === "run.started") {
    activeTurnId = event.turnId;
  } else if (settling.settles) {
    activeTurnId = null;
  }
  return { activeTurnId, to };
};
