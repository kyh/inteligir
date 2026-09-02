import type { ViewContext } from "@repo/domain/view-context";
import type { Thread } from "@repo/api/local/threads/threads-schema";

export type ThreadActivity = "running" | "done" | "failed" | "archived";

export function threadActivity(thread: Thread): ThreadActivity {
  if (thread.archivedAt !== null) {
    return "archived";
  }
  switch (thread.status) {
    case "starting":
    case "active":
    case "stopping":
      return "running";
    case "error":
      return "failed";
    case "idle":
      return "done";
  }
}

export const THREAD_ACTIVITY_LABELS = {
  running: "running",
  done: "done",
  failed: "failed",
  archived: "archived",
} satisfies Record<ThreadActivity, string>;

// A getter pulled at submit, not a subscription: reading the view must
// re-render nothing. Async because producing it flushes the buffer first.
export type ViewContextSource = () => Promise<ViewContext | null>;
