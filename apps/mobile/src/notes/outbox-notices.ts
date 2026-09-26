// What the notes screens show of the phone's unsent edits that need the user: a change the vault
// refused, which waits with its bytes until the user picks what happens to it, and a conflict the
// queue settled, told in the sentence the outbox kept from describeSyncConflict. Pure, so the words
// and the actions each row offers run under test; outbox-banner.tsx draws them.

import { isCommentsStorePath } from "@repo/notes/comments/sidecar-schema";
import { docStem, isDocPath } from "@repo/notes/knowledge/doc-file";
import { basenamePath } from "@repo/notes/knowledge/vault-path";
import type { OutboxStatus } from "./vault-outbox";

export type ParkedAction = "retry" | "save-as-new" | "discard";

export const PARKED_ACTION_LABELS = {
  discard: "Discard",
  retry: "Retry",
  "save-as-new": "Save as new note",
} satisfies Record<ParkedAction, string>;

export type OutboxNotice =
  | {
      kind: "parked";
      key: string;
      seq: number;
      title: string;
      reason: string;
      actions: readonly ParkedAction[];
    }
  // `open`: the copy a conflict made, where the other version is, else the note it kept
  | { kind: "conflict"; key: string; id: number; message: string; open: string };

const nameOf = (path: string): string => (isDocPath(path) ? docStem(path) : basenamePath(path));

// a reply or a resolve changes the comment store alone, whose file name is the note's id
const titleOf = (path: string | undefined): string => {
  if (path === undefined) {
    return "A change";
  }
  return isCommentsStorePath(path)
    ? "A comment is not in your vault yet"
    : `${nameOf(path)} is not in your vault yet`;
};

export const outboxNotices = (status: OutboxStatus): OutboxNotice[] => [
  ...status.parked.map((parked): OutboxNotice => ({
    actions: parked.canSaveAsNew ? ["retry", "save-as-new", "discard"] : ["retry", "discard"],
    key: `parked:${String(parked.seq)}`,
    kind: "parked",
    reason: parked.reason,
    seq: parked.seq,
    title: titleOf(parked.paths[0]),
  })),
  ...status.conflicts.map((notice): OutboxNotice => ({
    id: notice.id,
    key: `conflict:${String(notice.id)}`,
    kind: "conflict",
    message: notice.message,
    open: notice.copyPath ?? notice.path,
  })),
];
