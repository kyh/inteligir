// What the notes screens show of the phone's unsent edits that need the user: a change the vault
// refused, which waits with its bytes until the user picks what happens to it, and a conflict the
// queue settled, told in the sentence the outbox kept from describeSyncConflict. Pure, so the words
// and the actions each row offers run under test; outbox-banner.tsx draws them.

import { isAnnotationsStorePath } from "@repo/notes/annotations/store-schema";
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

// a note on a highlight, a reply or a delete changes the annotation store alone, whose file name
// is the item's id
const annotationTitle = (path: string | undefined): string =>
  path === undefined || isAnnotationsStorePath(path)
    ? "An annotation is not in your library yet"
    : `An annotation on ${docStem(path)} is not in your library yet`;

const titleOf = (parked: ParkedChange): string => {
  const [path] = parked.paths;
  switch (parked.kind) {
    case "rename": {
      return `${docStem(parked.from)} was not renamed to ${docStem(parked.to)}`;
    }
    case "remove": {
      return path === undefined
        ? "An item was not deleted from your library"
        : `${docStem(path)} was not deleted from your library`;
    }
    case "annotation": {
      return annotationTitle(path);
    }
    case "write":
    case "create":
    case "putAsset": {
      return path === undefined ? "A change" : `${docStem(path)} is not in your library yet`;
    }
    // no default
  }
};

const discardOf = (parked: ParkedChange): string => {
  switch (parked.kind) {
    case "rename": {
      return `It has not reached your library. Discarding keeps its old name, ${docStem(parked.from)}.`;
    }
    case "remove": {
      return "It has not reached your library. Discarding keeps the item.";
    }
    case "write":
    case "create":
    case "putAsset":
    case "annotation": {
      return "It has not reached your library, and discarding deletes it.";
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
