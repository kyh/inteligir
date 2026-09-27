// What the notes screens show of the phone's unsent edits that need the user: a change the vault
// refused, which waits with its bytes until the user picks what happens to it, and a conflict the
// queue settled, told in the sentence the outbox kept from describeSyncConflict. Pure, so the words
// and the actions each row offers run under test; outbox-banner.tsx draws them.

import { isCommentsStorePath } from "@repo/notes/comments/sidecar-schema";
import { docStem } from "@repo/notes/knowledge/doc-file";
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
      // what the discard confirmation says happens
      discard: string;
    }
  // `open`: the copy a conflict made, where the other version is, else the note it kept
  | { kind: "conflict"; key: string; id: number; message: string; open: string };

type ParkedChange = OutboxStatus["parked"][number];

// a reply or a resolve changes the comment store alone, whose file name is the note's id
const commentTitle = (path: string | undefined): string =>
  path === undefined || isCommentsStorePath(path)
    ? "A comment is not in your vault yet"
    : `A comment on ${docStem(path)} is not in your vault yet`;

const titleOf = (parked: ParkedChange): string => {
  const [path] = parked.paths;
  switch (parked.kind) {
    case "rename": {
      return `${docStem(parked.from)} was not renamed to ${docStem(parked.to)}`;
    }
    case "remove": {
      return path === undefined
        ? "A note was not deleted from your vault"
        : `${docStem(path)} was not deleted from your vault`;
    }
    case "comment": {
      return commentTitle(path);
    }
    case "write":
    case "create":
    case "putAsset": {
      return path === undefined ? "A change" : `${docStem(path)} is not in your vault yet`;
    }
    // no default
  }
};

const discardOf = (parked: ParkedChange): string => {
  switch (parked.kind) {
    case "rename": {
      return `It has not reached your vault. Discarding keeps its old name, ${docStem(parked.from)}.`;
    }
    case "remove": {
      return "It has not reached your vault. Discarding keeps the note.";
    }
    case "write":
    case "create":
    case "putAsset":
    case "comment": {
      return "It has not reached your vault, and discarding deletes it.";
    }
    // no default
  }
};

export const outboxNotices = (status: OutboxStatus): OutboxNotice[] => [
  ...status.parked.map((parked): OutboxNotice => ({
    actions: parked.canSaveAsNew ? ["retry", "save-as-new", "discard"] : ["retry", "discard"],
    discard: discardOf(parked),
    key: `parked:${String(parked.seq)}`,
    kind: "parked",
    reason: parked.reason,
    seq: parked.seq,
    title: titleOf(parked),
  })),
  ...status.conflicts.map((notice): OutboxNotice => ({
    id: notice.id,
    key: `conflict:${String(notice.id)}`,
    kind: "conflict",
    message: notice.message,
    open: notice.copyPath ?? notice.path,
  })),
];
