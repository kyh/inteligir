import type { ViewContext } from "@repo/domain/view-context";
import type { Thread } from "@repo/api/local/threads/threads-schema";

export type ThreadActivity = "running" | "done" | "failed" | "archived";

export const threadActivity = (thread: Thread): ThreadActivity => {
  if (thread.archivedAt !== null) {
    return "archived";
  }
  switch (thread.status) {
    case "starting":
    case "active":
    case "stopping": {
      return "running";
    }
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

export const THREAD_ACTIVITY_LABELS = {
  archived: "archived",
  done: "done",
  failed: "failed",
  running: "running",
} satisfies Record<ThreadActivity, string>;

// A getter pulled at submit, not a subscription: reading the view must
// re-render nothing. Async because producing it flushes the buffer first.
export type ViewContextSource = () => Promise<ViewContext | null>;
