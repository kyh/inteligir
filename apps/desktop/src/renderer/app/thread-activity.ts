import { isThreadRunning, threadStopControlFor } from "@repo/domain/thread-status";
import type { ThreadStopControl } from "@repo/domain/thread-status";
import type { Thread } from "@repo/contract/local/threads/threads-schema";

export type ThreadActivity = "running" | "done" | "failed" | "archived";

export const threadActivity = (thread: Thread): ThreadActivity => {
  if (thread.archivedAt !== null) {
    return "archived";
  }
  if (isThreadRunning(thread.status)) {
    return "running";
  }
  switch (thread.status) {
    case "error": {
      return "failed";
    }
    case "idle": {
      return "done";
    }
    default: {
      const exhaustive: never = thread.status;
      return exhaustive;
    }
  }
};

// archived threads are not exempt: a turn still running on one is still at work. a turn another
// device runs is that device's to stop.
export const threadStopControl = (thread: Thread): ThreadStopControl =>
  thread.runsElsewhere ? "none" : threadStopControlFor(thread.status);

export const THREAD_ACTIVITY_LABELS = {
  archived: "archived",
  done: "done",
  failed: "failed",
  running: "running",
} satisfies Record<ThreadActivity, string>;
