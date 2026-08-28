// Framework-free action vocabulary: what activity an actions-panel row shows,
// and the view-context source shape. Pure functions so the composer, the panel
// and the tests share one answer.

import type { ViewContext } from "@repo/domain/view-context";
import type { Thread } from "@repo/api/local/threads/threads-schema";

/**
 * WHAT A THREAD IS DOING, as every surface shows it. The lifecycle statuses
 * the contract carries are not it: three of them mean "running" to a reader.
 *
 * ONE derivation, because the alternative is visible: the same thread read
 * "running" in the palette while the actions panel painted it amber, and
 * every new surface added another vocabulary.
 */
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

/** The one word every surface names an activity with. */
export const THREAD_ACTIVITY_LABELS = {
  running: "running",
  done: "done",
  failed: "failed",
  archived: "archived",
} satisfies Record<ThreadActivity, string>;

/**
 * How the composer learns what the user is looking at: ONE slot the workspace
 * holds, filled by whichever surface is open and PULLED at submit.
 *
 * A getter rather than a subscription, deliberately — a selection change must
 * re-render nothing, in a surface whose chat state is kept beside the editor
 * precisely so nothing remounts it. Async because producing the value flushes
 * the buffer first (`note-view-context.ts` says why). null when nothing is
 * open, which is also every send from the palette or the CLI.
 */
export type ViewContextSource = () => Promise<ViewContext | null>;
