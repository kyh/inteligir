// What the notes screens show of the phone's unsent edits that need the user: a change the vault
// refused, which waits with its bytes until the user picks what happens to it, and a conflict the
// queue settled, told in the sentence the outbox kept from describeSyncConflict. Pure, so the words
// and the actions each row offers run under test; outbox-banner.tsx draws them.

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

export const outboxNotices = (status: OutboxStatus): OutboxNotice[] => [
  ...status.parked.map((parked): OutboxNotice => {
    const [first] = parked.paths;
    return {
      actions: parked.canSaveAsNew ? ["retry", "save-as-new", "discard"] : ["retry", "discard"],
      key: `parked:${String(parked.seq)}`,
      kind: "parked",
      reason: parked.reason,
      seq: parked.seq,
      title: first === undefined ? "A change" : `${nameOf(first)} is not in your vault yet`,
    };
  }),
  ...status.conflicts.map((notice): OutboxNotice => ({
    id: notice.id,
    key: `conflict:${String(notice.id)}`,
    kind: "conflict",
    message: notice.message,
    open: notice.copyPath ?? notice.path,
  })),
];
