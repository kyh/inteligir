// One verdict per path for every writer that meets a concurrent change: the desktop's sync pass
// and the phone's write queue ask it the same question and land the same bytes, the same copy and
// the same words. Bytes in, bytes out: the caller reads the sides and lands the answer, so nothing
// here knows git, a disk or a network.

import { mergeCommentStores } from "../comments/merge-comment-stores";
import { isCommentsStorePath, isLegacyCommentsSidecarPath } from "../comments/sidecar-schema";
import { isDocPath, isVaultMetadataPath } from "../knowledge/doc-file";
import { removeFrontmatterId } from "../markdown/frontmatter";
import { diff3 } from "../text/diff3";
import { conflictCopyPath } from "./conflict-copy";
import type { SyncConflictReport } from "./conflict-copy";

// The root one alone: the app appends phone captures to it from every signed-in desktop, so two
// appends are two captures, never a conflict. A nested Inbox.md is a note like any other.
export const CAPTURE_INBOX_PATH = "Inbox.md";

export type FileSide =
  | { readonly kind: "absent" }
  | { readonly kind: "text"; readonly text: string }
  // bytes that are not text to this module (a photo, a file that is not UTF-8); `ref` is the
  // caller's name for them, a blob id, and equal refs are equal bytes
  | { readonly kind: "opaque"; readonly ref: string };

type PresentSide = Exclude<FileSide, { kind: "absent" }>;
type TextSide = Extract<FileSide, { kind: "text" }>;

export interface ReconcileInput {
  readonly path: string;
  // absent: no common version, so neither side reads as having deleted anything
  readonly base: FileSide;
  // the asking writer's version, which stays wherever the two cannot both
  readonly mine: FileSide;
  readonly theirs: FileSide;
  readonly thisDevice: string;
  readonly theirDevice: string;
  // asked of each candidate copy name; it should answer ignoring case (`takenIgnoringCase`)
  readonly isTaken: (path: string) => boolean;
}

// what the path holds afterwards: `mine` and `theirs` always name a side that exists
export type Resolution =
  | { readonly kind: "mine" }
  | { readonly kind: "theirs" }
  | { readonly kind: "merged"; readonly text: string }
  | { readonly kind: "delete" };

// theirs, whole, beside the path: as text, or by the caller's ref when it is opaque
export type ConflictCopy =
  | { readonly kind: "text"; readonly path: string; readonly text: string }
  | { readonly kind: "opaque"; readonly path: string; readonly ref: string };

export type Reconciled =
  | { readonly stays: Resolution; readonly copy: null; readonly report: null }
  | {
      readonly stays: Resolution;
      readonly copy: null;
      readonly report: Extract<SyncConflictReport, { kind: "kept-edit" }>;
    }
  | {
      readonly stays: Resolution;
      readonly copy: ConflictCopy;
      readonly report: Extract<SyncConflictReport, { kind: "copied" }>;
    };

const sameSide = (a: FileSide, b: FileSide): boolean => {
  if (a.kind === "text") {
    return b.kind === "text" && a.text === b.text;
  }
  if (a.kind === "opaque") {
    return b.kind === "opaque" && a.ref === b.ref;
  }
  return b.kind === "absent";
};

const resolved = (stays: Resolution): Reconciled => ({ copy: null, report: null, stays });

const keep = (kind: "mine" | "theirs", side: FileSide): Reconciled =>
  resolved(side.kind === "absent" ? { kind: "delete" } : { kind });

// a merge that came out as one side's exact bytes lands as that side, so the caller writes nothing
const settle = (text: string, mine: TextSide, theirs: TextSide): Resolution => {
  if (text === mine.text) {
    return { kind: "mine" };
  }
  if (text === theirs.text) {
    return { kind: "theirs" };
  }
  return { kind: "merged", text };
};

// A copy that kept the note's `id:` would be a second note answering to it, and the
// `[[Title|uuid]]` tier would stop knowing which one a link means; every other byte stays.
const withCopyOfTheirs = (
  { path, thisDevice, theirDevice, isTaken }: ReconcileInput,
  stays: Resolution,
  theirs: PresentSide,
): Reconciled => {
  const copyPath = conflictCopyPath(path, theirDevice, isTaken);
  return {
    copy:
      theirs.kind === "text"
        ? {
            kind: "text",
            path: copyPath,
            text: isDocPath(path) ? removeFrontmatterId(theirs.text) : theirs.text,
          }
        : { kind: "opaque", path: copyPath, ref: theirs.ref },
    report: { copyDevice: theirDevice, copyPath, keptDevice: thisDevice, kind: "copied", path },
    stays,
  };
};

// Never a copy: two devices each commenting is the ordinary case, and a copy of a store no note
// reads would be comments nobody sees. Beside a deletion the present store stays whole: the note
// it belongs to carries the report, and a store cut down to its edited entries would leave the
// kept note's other anchors with no bodies.
const reconcileCommentStore = ({ base, mine, theirs }: ReconcileInput): Reconciled => {
  if (mine.kind === "absent") {
    return keep("theirs", theirs);
  }
  if (theirs.kind === "absent" || mine.kind !== "text" || theirs.kind !== "text") {
    return keep("mine", mine);
  }
  const merged = mergeCommentStores({
    base: base.kind === "text" ? base.text : null,
    mine: mine.text,
    theirs: theirs.text,
  });
  return merged.kind === "unreadable"
    ? keep("mine", mine)
    : resolved(settle(merged.text, mine, theirs));
};

// Asked in this order: identical sides, a change on one side only, the comment store, every
// other dot-folder, an edit beside a deletion (the edit stays), two texts (a line merge whose
// overlaps keep mine and copy theirs whole), and anything else both changed (mine stays, theirs
// is copied).
export const reconcileFile = (input: ReconcileInput): Reconciled => {
  const { path, base, mine, theirs, thisDevice, theirDevice } = input;
  if (sameSide(mine, theirs) || sameSide(theirs, base)) {
    return keep("mine", mine);
  }
  if (sameSide(mine, base)) {
    return keep("theirs", theirs);
  }
  // the beside-the-note spelling holds the same entries until the boot folds it into the store
  if (isCommentsStorePath(path) || isLegacyCommentsSidecarPath(path)) {
    return reconcileCommentStore(input);
  }
  // another app's settings or the OS's litter: nobody reads a copy of `.obsidian/workspace.json`
  if (isVaultMetadataPath(path)) {
    return keep("mine", mine);
  }
  if (mine.kind === "absent") {
    return {
      copy: null,
      report: { deletedDevice: thisDevice, keptDevice: theirDevice, kind: "kept-edit", path },
      stays: { kind: "theirs" },
    };
  }
  if (theirs.kind === "absent") {
    return {
      copy: null,
      report: { deletedDevice: theirDevice, keptDevice: thisDevice, kind: "kept-edit", path },
      stays: { kind: "mine" },
    };
  }
  if (mine.kind === "text" && theirs.kind === "text") {
    const baseText = base.kind === "text" ? base.text : "";
    if (path === CAPTURE_INBOX_PATH) {
      const union = diff3(baseText, mine.text, theirs.text, { overlap: "union" });
      return resolved(settle(union.merged, mine, theirs));
    }
    const { conflicted, merged } = diff3(baseText, mine.text, theirs.text);
    const stays = settle(merged, mine, theirs);
    return conflicted ? withCopyOfTheirs(input, stays, theirs) : resolved(stays);
  }
  return withCopyOfTheirs(input, { kind: "mine" }, theirs);
};
