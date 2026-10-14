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

// new work an archive supersedes. settles and stops are left out on purpose: refused on an
// archived thread, they would leave a mid-run status stuck forever.
const REFUSED_WHEN_ARCHIVED: ReadonlySet<ThreadLifecycleEventType> = new Set([
  "run.preparing",
  "run.started",
]);

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
  | { kind: "move"; to: ThreadStatus; activeTurnId: string | null }
  | { kind: "noop"; reason: ThreadLifecycleNoopReason; detail: string };

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
  if (REFUSED_WHEN_ARCHIVED.has(event.type) && thread.archivedAt !== null) {
    return { detail: "archivedAt set", kind: "noop", reason: "superseded" };
  }

  const settling = settlingTurnId(event);
  if (settling.settles && settling.turnId !== thread.activeTurnId) {
    return {
      detail: `${event.type} names turn ${settling.turnId ?? "<none>"} but the active turn is ${thread.activeTurnId ?? "<none>"}`,
      kind: "noop",
      reason: "stale-turn",
    };
  }

  const to = THREAD_LIFECYCLE[thread.status][event.type];
  if (to === undefined) {
    return {
      detail: `no transition for ${event.type} from status ${thread.status}`,
      kind: "noop",
      reason: "illegal-transition",
    };
  }
  let { activeTurnId } = thread;
  if (event.type === "run.started") {
    activeTurnId = event.turnId;
  } else if (settling.settles) {
    activeTurnId = null;
  }
  return { activeTurnId, kind: "move", to };
};
