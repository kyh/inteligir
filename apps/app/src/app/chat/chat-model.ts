// Framework-free chat/delegation vocabulary: which thread the bottom
// composer addresses, what status a doc chip shows, and the bytes a
// delegation's first message is composed from. Pure functions so the
// composer, the checkbox fast path and the tests share one answer.

import type { ThreadChipStatus } from "@repo/editor/thread-chip";
import { checkboxMarkerAt } from "@repo/notes/knowledge/source-lines";
import { threadMarkerText } from "@repo/notes/markdown/thread-marker";
import type { DocThreadActivity, Thread } from "@repo/server-contract/threads";

/**
 * The one active chat conversation: the newest unarchived thread with no doc
 * origin. Derived, never stored — `listThreads` orders live threads
 * newest-updated first, so the first match IS the designation. None means
 * the first send creates one; "New chat" archives it, which un-designates
 * it by the same rule.
 */
export function designatedChatThread(threads: readonly Thread[]): Thread | null {
  return (
    threads.find((thread) => thread.archivedAt === null && thread.originDocPath === null) ?? null
  );
}

export function chipStatusFor(activity: DocThreadActivity): ThreadChipStatus {
  const { thread } = activity;
  if (thread.archivedAt !== null) {
    return "archived";
  }
  if (activity.openInteractionCount > 0) {
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
      return activity.queuedCount > 0 ? "queued" : "done";
  }
}

export type DelegationIntent = "do" | "ask";

/** A delegation the editor armed and the composer will finish: what was
 *  selected, with a closure that can still splice the anchor into the live
 *  buffer when the prompt finally arrives. */
export interface DelegationDraft {
  intent: DelegationIntent;
  docPath: string;
  selectionText: string;
  /** Splices the marker into the buffer; false when the editor is gone. */
  insertAnchor: (anchor: string) => boolean;
}

/** Client-minted, so the create call can bind (doc, anchor) atomically —
 *  the thread id it would otherwise embed does not exist until create
 *  returns. */
export function newAnchorToken(): string {
  return `anc_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
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
  docPath: string;
  anchor: string;
  selectionText: string;
  prompt: string;
}

const INTENT_PREAMBLE: Record<DelegationIntent, string> = {
  do: "This is a delegation from a note in the vault. Do the work and apply the result directly to the vault files.",
  ask: "This is a question about a note in the vault. Answer in this thread only — do not modify any files.",
};

export function composeDelegationMessage(args: ComposeDelegationArgs): string {
  const quoted = args.selectionText
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  const label = args.intent === "do" ? "Task" : "Question";
  return [
    INTENT_PREAMBLE[args.intent],
    `Context — this block from ${args.docPath} (its position is marked with ${threadMarkerText(args.anchor)}):`,
    quoted,
    `${label}: ${args.prompt}`,
  ].join("\n\n");
}
