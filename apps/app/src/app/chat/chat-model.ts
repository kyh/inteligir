// Framework-free chat/delegation vocabulary: which thread the bottom
// composer addresses, what status a doc chip shows, and the bytes a
// delegation's first message is composed from. Pure functions so the
// composer, the checkbox fast path and the tests share one answer.

import type { AgentWriteMode } from "@repo/domain/agent-write-mode";
import type { ThreadChipTone } from "@repo/editor/thread-chip";
import { checkboxMarkerAt } from "@repo/notes/knowledge/source-lines";
import { threadMarkerText } from "@repo/notes/markdown/thread-marker";
import type { Thread } from "@repo/server-contract/threads";

/**
 * Which chat thread a fresh session OPENS ON: the newest unarchived thread
 * with no doc origin (`listThreads` orders live threads newest-updated first,
 * so the first match is it).
 *
 * This chooses an INITIAL target and nothing more — the dock holds the id from
 * then on. Re-deriving would make the surface the user is typing into a
 * function of `updatedAt`, which every lifecycle event on every thread moves:
 * a background delegation settling would silently swap the visible
 * conversation AND redirect the next send. A conversation ends because the
 * user ended it, never because another thread was touched.
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
 * "running" in the palette while the dock painted it amber and the doc chip
 * said "queued", and every new surface added a fourth vocabulary.
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
export const THREAD_ACTIVITY_LABELS: Record<ThreadActivity, string> = {
  queued: "queued",
  running: "running",
  "needs-approval": "needs approval",
  "needs-review": "suggested edit",
  done: "done",
  failed: "failed",
  archived: "archived",
};

/** The status dot beside a thread, in the chrome Tailwind paints. */
export const THREAD_ACTIVITY_DOT_CLASSES: Record<ThreadActivity, string> = {
  queued: "bg-muted-foreground/40",
  running: "bg-sky-500 animate-pulse",
  "needs-approval": "bg-amber-500",
  "needs-review": "bg-emerald-500",
  done: "bg-muted-foreground/40",
  failed: "bg-destructive",
  archived: "bg-muted-foreground/40",
};

/** The same activity in the editor chip's own palette vocabulary. */
export const THREAD_ACTIVITY_TONES: Record<ThreadActivity, ThreadChipTone> = {
  queued: "neutral",
  running: "busy",
  "needs-approval": "attention",
  "needs-review": "attention",
  done: "positive",
  failed: "negative",
  archived: "muted",
};

/** Only a settled thread's marker may be removed from the buffer. */
export function isSettledActivity(activity: ThreadActivity): boolean {
  return activity === "archived";
}

export type DelegationIntent = "do" | "ask";

/**
 * Why an anchor could not be placed. Each one means the SAME thing to the
 * caller — no thread is created — because a delegation whose anchor is not on
 * disk is one the agent can read the doc without seeing, and one a reload
 * turns into an orphan thread pointing at a block nothing marks.
 */
export type AnchorFailure =
  /** The block the draft named was deleted while the prompt was being typed. */
  | "block-gone"
  /** The note closed (or was never mounted) before the prompt arrived. */
  | "no-editor"
  /** The splice would not save — the CAS refused, or the request failed. */
  | "save-failed";

export type AnchorOutcome = { ok: true } | { ok: false; reason: AnchorFailure };

export const ANCHOR_FAILURE_MESSAGES: Record<AnchorFailure, string> = {
  "block-gone": "That block is gone, so the delegation was not created.",
  "no-editor": "The note closed before the delegation could be anchored.",
  "save-failed": "The note could not be saved, so the delegation was not created.",
};

/** A delegation the editor armed and the composer will finish: what was
 *  selected, plus the two closures that own the editor side of it. */
export interface DelegationDraft {
  intent: DelegationIntent;
  /** Where this delegation's writes land. `ask` writes nothing, so the field
   *  is carried but inert there — the thread still records what it was
   *  created as, and a later message on it obeys the same rule. */
  writeMode: AgentWriteMode;
  docPath: string;
  selectionText: string;
  /** Splices the marker at the TRACKED position and makes it durable. Resolves
   *  only once the bytes are saved — the caller creates no thread otherwise. */
  anchor: (anchor: string) => Promise<AnchorOutcome>;
  /** The draft was abandoned; drop the tracked position. */
  cancel: () => void;
}

/** Client-minted, so the create call can bind (doc, anchor) atomically — the
 *  thread id it would otherwise embed does not exist until create returns.
 *  The shape is the token grammar @repo/notes states and the contract
 *  validates: `anc_` + 12 lowercase hex. */
export function newAnchorToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `anc_${hex}`;
}

export function delegationTitle(prompt: string): string {
  const firstLine = prompt.split("\n", 1)[0]?.trim() ?? "";
  const title = firstLine === "" ? "Delegation" : firstLine;
  return title.length > 60 ? `${title.slice(0, 59)}…` : title;
}

/** The prompt the checkbox fast path sends: the task text without its
 *  `- [ ]` prefix. */
export function taskPrompt(lineText: string): string {
  const marker = checkboxMarkerAt(lineText);
  if (marker === null) {
    return lineText.trim();
  }
  return lineText.slice(marker.checkboxIndex + 2).trim();
}

export interface ComposeDelegationArgs {
  intent: DelegationIntent;
  writeMode: AgentWriteMode;
  docPath: string;
  anchor: string;
  selectionText: string;
  prompt: string;
}

const INTENT_PREAMBLE: Record<DelegationIntent, string> = {
  do: "This is a delegation from a note in the vault. Do the work and apply the result directly to the vault files.",
  ask: "This is a question about a note in the vault. Answer in this thread only — do not modify any files.",
};

/**
 * What review mode adds to the prompt. The agent's tools and working
 * directory are UNCHANGED — it edits the vault exactly as it always does, and
 * the host lifts those writes out afterwards — so this is orientation, not
 * instruction: without it the model would report that it applied changes the
 * user cannot yet see.
 */
const REVIEW_MODE_NOTE =
  "Your file edits will be held as a suggestion for the user to accept or reject, " +
  "so make them as you normally would and say what you changed rather than claiming it is live.";

export function composeDelegationMessage(args: ComposeDelegationArgs): string {
  const quoted = args.selectionText
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  const label = args.intent === "do" ? "Task" : "Question";
  return [
    INTENT_PREAMBLE[args.intent],
    ...(args.intent === "do" && args.writeMode === "propose" ? [REVIEW_MODE_NOTE] : []),
    `Context — this block from ${args.docPath} (its position is marked with ${threadMarkerText(args.anchor)}):`,
    quoted,
    `${label}: ${args.prompt}`,
  ].join("\n\n");
}
