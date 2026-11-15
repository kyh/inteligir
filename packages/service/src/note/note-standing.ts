// What a note takes: every write while open, no edit past its size until a compaction makes room,
// and nothing once the library holds no body for it; gone is final. Whether its item is in Deleted
// is no standing of the note's: the cell says it to each socket's door (`./note-routes`).

import type { NoteHeld } from "./note-wire";

export type NoteStanding = "open" | "full" | "gone";

export type StandingEvent =
  // a write met the note's size with no room left
  | "filled"
  // a compaction left room for an update
  | "shrank"
  // the item is purged, or the cell holds no body for it
  | "gone";

export const standingAfter = (standing: NoteStanding, event: StandingEvent): NoteStanding => {
  if (standing === "gone" || event === "gone") {
    return "gone";
  }
  return event === "filled" ? "full" : "open";
};

// who writes: a device's frame or the agent's edit, a page's article read again, a turn's undo
export type NoteWrite = "edit" | "article" | "undo";

// An undo is taken while full, since it takes the agent's words back; a fill's article replaces
// what a reading put there.
const ADMITS = {
  full: { article: true, edit: false, undo: true },
  gone: { article: false, edit: false, undo: false },
  open: { article: true, edit: true, undo: true },
} as const satisfies Record<NoteStanding, Record<NoteWrite, boolean>>;

// the hold that refuses `write`, or null when the note takes it
export const refusedBy = (standing: NoteStanding, write: NoteWrite): NoteHeld | null =>
  standing === "open" || ADMITS[standing][write] ? null : standing;
