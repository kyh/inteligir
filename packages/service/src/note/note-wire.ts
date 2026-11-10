// What a note's object and its account's cell say to each other over RPC. Both run this Worker's
// one build, so each reads the other's values as typed here.

import type { BodyBlock, DerivedBody } from "@repo/contract/library/derive-item";
import { bodyBlockSchema } from "@repo/contract/library/library-wire";
import type { BodyChange } from "@repo/editor/live/body-change";
import { z } from "zod";

import type { NoteDO } from "./note-do";

// an item's note, as the account's cell reaches it (`./note-stub` names it)
export type NoteReach = (itemId: string) => DurableObjectStub<NoteDO>;

// the headers the note's door stamps on the upgrade it forwards, over anything the client sent:
// the session it verified, and whether the socket may write
export const NOTE_HOLDER_HEADER = "x-note-holder";
export const NOTE_MODE_HEADER = "x-note-mode";

// What a note's socket says beside y-sync: the ping the object answers without waking, and
// y-partyserver's custom messages. The client spells the same words (`@repo/editor`'s
// note-connection).
export const NOTE_SOCKET = {
  // the note is in Deleted: it takes no edit
  deleted: "deleted",
  // the note is past its size: every socket's document is dropped for the note's own
  full: "full",
  // a frame past an update's cap was refused, so this socket takes nothing more
  refused: "read-only",
  saved: "saved",
  savedAsk: "saved?",
  ping: "ping",
  pong: "pong",
  // the note is not in the library, which a client stops dialing on
  missingCode: 4404,
  // the note came back from Deleted, which a client dials again on, writable
  reopenCode: 4000,
  revokedCode: 1008,
} as const;

// what the cell answers a note's first load: the body it kept for the item, or that it kept none
// (`empty`), or that the note already took it and a note asking again lost it (`claimed`), or that
// the library holds no such item
export type SeedAnswer =
  | { readonly kind: "seed"; readonly blocks: readonly BodyBlock[] }
  | { readonly kind: "empty" }
  | { readonly kind: "claimed" }
  | { readonly kind: "missing" };

// the note's body as of `version`, which counts the updates the note stored, so a late push is
// stale; `bytes` is what its storage holds
export interface NoteProjection extends DerivedBody {
  readonly version: number;
  readonly bytes: number;
}

// `gone`: the item is purged or never was, so the note stops pushing
export type ProjectAnswer = "landed" | "stale" | "gone";

// how a session's socket on a note opens: writable, read-only (the item is in Deleted), or not at all
export type NoteOpening = "live" | "read" | "missing";

// why a note takes no edit: past its size, in Deleted, or purged
export type NoteHeld = "full" | "deleted" | "gone";

// an edit of a note's body by block id, under its writer's origin; an agent's is logged under its
// turn's change set, which Undo takes back, and any other writer's under none
export interface NoteChange {
  readonly opId: string;
  readonly changeSetId: string | null;
  readonly origin: string;
  readonly changes: readonly BodyChange[];
}

// `moved`: a block a change names stands otherwise now, each such block as it is, one the note no
// longer holds left out; nothing landed
export type ChangeAnswer =
  | { readonly kind: "applied"; readonly projection: NoteProjection }
  | { readonly kind: "moved"; readonly blocks: readonly BodyBlock[] }
  | { readonly kind: "held"; readonly held: NoteHeld };

export interface NoteRead {
  readonly blocks: readonly BodyBlock[];
  readonly version: number;
}

// blocks read back over RPC, whose serialized type no longer says a block's children hold at least
// one node, so they are parsed back into the model's
export const noteBlocksSchema = z.array(bodyBlockSchema);

// a turn undone on a note: whether it took text someone else wrote inside a block the turn added,
// whether anyone but an agent ever wrote here, and the body after, null when nothing changed
export interface TurnUndone {
  readonly lostText: boolean;
  readonly personEdited: boolean;
  readonly projection: NoteProjection | null;
}
