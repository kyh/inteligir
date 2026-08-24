// Framework-free action vocabulary: which unattached thread a send reuses,
// what activity an actions-panel row shows, and the view-context source
// shape. Pure functions so the composer, the panel and the tests share one
// answer.

import type { ViewContext } from "@repo/domain/view-context";
import type { Thread } from "@repo/api/local/threads/threads-schema";

/**
 * Which unattached thread a send REUSES: the newest unarchived thread with
 * no doc origin (`listThreads` orders live threads newest-updated first, so
 * the first match is it).
 *
 * This chooses an INITIAL target and nothing more — the caller holds the id
 * from then on. Re-deriving would make the thread a send lands in a function
 * of `updatedAt`, which every lifecycle event on every thread moves: a
 * background action settling would silently redirect the next send. A
 * conversation ends because the user ended it, never because another thread
 * was touched.
 */
export function initialChatThread(threads: readonly Thread[]): Thread | null {
  return (
    threads.find((thread) => thread.archivedAt === null && thread.originDocPath === null) ?? null
  );
}

/**
 * WHAT A THREAD IS DOING, as every surface shows it. The lifecycle statuses
 * the contract carries are not it: three of them mean "running" to a reader,
 * and two of the six answers here (`needs-approval`, `queued`) are not thread
 * columns at all but counts of rows in other tables.
 *
 * ONE derivation, because the alternative is visible: the same thread read
 * "running" in the palette while the actions panel painted it amber, and
 * every new surface added another vocabulary.
 */
export type ThreadActivity =
  | "queued"
  | "running"
  | "needs-approval"
  | "needs-review"
  | "done"
  | "failed"
  | "archived";

/** The counts a `Thread` alone cannot answer — each is rows in another table. */
export interface ThreadActivityCounts {
  openInteractionCount: number;
  queuedCount: number;
  pendingProposalCount: number;
}

/** For a surface holding a bare `Thread`: the list route answers no counts,
 *  so such a row reads the thread's own lifecycle and never claims an
 *  approval, a queue or a suggestion it was not told about. */
export const NO_ACTIVITY_COUNTS: ThreadActivityCounts = {
  openInteractionCount: 0,
  queuedCount: 0,
  pendingProposalCount: 0,
};

export function threadActivity(thread: Thread, counts: ThreadActivityCounts): ThreadActivity {
  if (thread.archivedAt !== null) {
    return "archived";
  }
  if (counts.openInteractionCount > 0) {
    return "needs-approval";
  }
  switch (thread.status) {
    case "starting":
    case "active":
    case "stopping":
      return "running";
    case "error":
      return "failed";
    case "idle":
      if (counts.queuedCount > 0) {
        return "queued";
      }
      // Ranked BELOW an approval and a queue, because those block the agent
      // while this one waits on the user with the turn already finished — but
      // above `done`, which would leave a suggestion nobody is told about.
      return counts.pendingProposalCount > 0 ? "needs-review" : "done";
  }
}

/** The one word every surface names an activity with. */
export const THREAD_ACTIVITY_LABELS = {
  queued: "queued",
  running: "running",
  "needs-approval": "needs approval",
  "needs-review": "suggested edit",
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
