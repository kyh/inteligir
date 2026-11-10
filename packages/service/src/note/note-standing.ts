// What a note takes, and from whom: open, full past its size, in Deleted, or gone for good. Deleted
// keeps whether the note is also full, so a restore shows it as it is; gone is final.

import type { NoteHeld } from "./note-wire";

export type NoteStanding =
  | { readonly kind: "open" }
  | { readonly kind: "full" }
  | { readonly kind: "deleted"; readonly full: boolean }
  | { readonly kind: "gone" };

export type StandingEvent =
  | { readonly kind: "deleted" }
  | { readonly kind: "restored" }
  // a write met the note's size with no room left
  | { readonly kind: "filled" }
  // a compaction left room for an update
  | { readonly kind: "shrank" }
  // the item is purged, or the cell holds no body for it
  | { readonly kind: "gone" };

const withFull = (full: boolean): NoteStanding => (full ? { kind: "full" } : { kind: "open" });

export const standingAfter = (standing: NoteStanding, event: StandingEvent): NoteStanding => {
  if (standing.kind === "gone" || event.kind === "gone") {
    return { kind: "gone" };
  }
  const full = standing.kind === "deleted" ? standing.full : standing.kind === "full";
  const deleted = standing.kind === "deleted";
  switch (event.kind) {
    case "deleted": {
      return { full, kind: "deleted" };
    }
    case "restored": {
      return withFull(full);
    }
    case "filled": {
      return deleted ? { full: true, kind: "deleted" } : withFull(true);
    }
    case "shrank": {
      return deleted ? { full: false, kind: "deleted" } : withFull(false);
    }
    // no default
  }
};

// the note's meta columns a standing is kept in; gone is kept only by a purge's own column, since a
// note the cell lost the body of looks again on its next load
interface StandingColumns {
  readonly full: number;
  readonly deleted: number;
}

export const standingOf = (meta: StandingColumns & { readonly purged: number }): NoteStanding => {
  if (meta.purged === 1) {
    return { kind: "gone" };
  }
  return meta.deleted === 1
    ? { full: meta.full === 1, kind: "deleted" }
    : withFull(meta.full === 1);
};

export const standingColumns = (
  standing: Exclude<NoteStanding, { kind: "gone" }>,
): StandingColumns => ({
  deleted: standing.kind === "deleted" ? 1 : 0,
  full: standing.kind === "full" || (standing.kind === "deleted" && standing.full) ? 1 : 0,
});

// who writes: a device's frame or the agent's edit, a page's article read again, a turn's undo
export type NoteWrite = "edit" | "article" | "undo";

// An undo is taken in Deleted, since it may be the step that restores the item, and while full,
// since it takes the agent's words back; a fill's article replaces what a reading put there.
const ADMITS = {
  deleted: { article: true, edit: false, undo: true },
  full: { article: true, edit: false, undo: true },
  gone: { article: false, edit: false, undo: false },
  open: { article: true, edit: true, undo: true },
} as const satisfies Record<NoteStanding["kind"], Record<NoteWrite, boolean>>;

// the hold that refuses `write`, or null when the note takes it
export const refusedBy = (standing: NoteStanding, write: NoteWrite): NoteHeld | null =>
  standing.kind === "open" || ADMITS[standing.kind][write] ? null : standing.kind;
