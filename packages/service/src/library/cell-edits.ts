// An edit of an item's markdown by passages (`library.items.edit`), which the item's note applies.
// The cell reads the note's blocks outside any transaction (a cold note's load calls back into the
// cell), the codec answers the edit as changes by block id, and the note applies them under the
// writer's origin, logging an agent's around its update under the turn's change set for Undo. A
// block someone moved since the read is read again once and the edit run again; past that the edit
// is refused with the block as it is. The write that follows re-checks the op, the item and the
// writer's turn, and lands the note's answered body in the writer's change set when it is newer.

import type { BodyBlock } from "@repo/contract/library/derive-item";
import { editItemView } from "@repo/editor/codec/item-edit";
import type { EditOutcome, ViewEdit } from "@repo/editor/codec/item-edit";
import { z } from "zod";

import { noteBlocksSchema } from "../note/note-wire";
import type { NoteHeld, NoteProjection, NoteReach } from "../note/note-wire";
import type { CellActor } from "./cell-actor";
import { cellCodec, logReadFailure } from "./cell-codec";
import { landProjection } from "./cell-notes";
import type { CellRefusal, CellResult } from "./cell-refusal";
import { refuse } from "./cell-refusal";
import { touchItem } from "./change-sets";
import type { LibraryEngine } from "./library-engine";
import { readLiveItem } from "./library-queries";

export interface EditInput {
  readonly id: string;
  readonly edits: readonly ViewEdit[];
  readonly opId?: string | undefined;
}

export interface EditDeps {
  readonly library: LibraryEngine;
  readonly notes: NoteReach;
  // read again as the edit lands, which a turn that ended meanwhile refuses
  readonly actor: () => CellActor;
}

const editedSchema = z.object({ seq: z.number() });
const joinedSchema = z.object({ changeSetId: z.string() });

type Edited = z.output<typeof editedSchema>;

// what names a writer's edits in the note's document
const originOf = (actor: CellActor): string => {
  switch (actor.kind) {
    case "agent": {
      return `agent:${actor.threadId}:${actor.turn}`;
    }
    case "person": {
      return `person:${actor.sessionId}`;
    }
    case "assistant": {
      return `assistant:${actor.grantId}`;
    }
    case "import": {
      return `import:${actor.jobId}`;
    }
    case "fill": {
      return "fill";
    }
    // no default
  }
};

// an edit the codec did not land: its own refusal as it is, and new text a rule failed on as
// text the library cannot keep
const refusalOf = (outcome: Exclude<EditOutcome, { kind: "changed" }>): CellRefusal => {
  if (outcome.kind === "refused") {
    return { kind: "edit-refused", refusal: outcome.refusal };
  }
  logReadFailure(outcome.error);
  return { kind: "edit-refused", refusal: { edit: outcome.edit, kind: "unstorable" } };
};

const refused = (refusal: CellRefusal): CellResult<never> => ({ ok: false, refusal });

const heldRefusal = (held: NoteHeld): CellRefusal =>
  held === "full" ? { kind: "too-large" } : { kind: "not-found" };

// the change set an agent's edit is logged under, joined before the note applies it, since the
// note keeps the turn's log by it; any other writer's edit is logged nowhere
const logSetOf = (library: LibraryEngine, actor: CellActor): CellResult<string | null> => {
  if (actor.kind !== "agent") {
    return { ok: true, value: null };
  }
  const joined = library.land(actor, { answer: joinedSchema, opId: undefined }, (scope) => ({
    changeSetId: scope.set().id,
  }));
  return joined.ok ? { ...joined, value: joined.value.changeSetId } : joined;
};

export const editByNote = async (deps: EditDeps, input: EditInput): Promise<CellResult<Edited>> => {
  const { library } = deps;
  const prior = library.answered(input.opId, editedSchema);
  if (!prior.ok) {
    return prior;
  }
  if (prior.value !== null) {
    return { ok: true, value: prior.value };
  }
  const actor = deps.actor();
  const logSet = logSetOf(library, actor);
  if (!logSet.ok) {
    return logSet;
  }
  const opId = input.opId ?? library.ids.op();
  const note = deps.notes(input.id);
  let projection: NoteProjection | null = null;
  let moved: BodyBlock[] = [];
  for (let tries = 0; tries < 2 && projection === null; tries += 1) {
    // an item in Deleted takes no edit, which the cell alone knows: its note keeps no word of it
    const editable = library.read((db) => readLiveItem(db, input.id)?.fields.deletedAt === null);
    if (!editable.ok || !editable.value) {
      return editable.ok ? refused({ kind: "not-found" }) : editable;
    }
    const read = await note.read();
    const blocks = noteBlocksSchema.parse(read.blocks);
    const outcome = library.read((db) =>
      editItemView(blocks, input.edits, cellCodec(db, library.ids).edit),
    );
    if (!outcome.ok) {
      return outcome;
    }
    if (outcome.value.kind !== "changed") {
      return refused(refusalOf(outcome.value));
    }
    const reply = await note.applyChange({
      changeSetId: logSet.value,
      changes: outcome.value.changes,
      opId,
      origin: originOf(actor),
    });
    switch (reply.kind) {
      case "held": {
        return refused(heldRefusal(reply.held));
      }
      case "moved": {
        moved = noteBlocksSchema.parse(reply.blocks);
        break;
      }
      case "applied": {
        ({ projection } = reply);
        break;
      }
      // no default
    }
  }
  if (projection === null) {
    return refused({ kind: "edit-refused", refusal: { blocks: moved, kind: "moved" } });
  }
  const landed = projection;
  return library.land(deps.actor(), { answer: editedSchema, opId: input.opId }, (scope) => {
    const item = readLiveItem(scope.db, input.id);
    if (item === null) {
      return refuse({ kind: "not-found" });
    }
    touchItem(scope.db, { before: item.fields, itemId: item.id, setId: scope.set().id });
    landProjection(scope, item.id, landed);
    return { seq: readLiveItem(scope.db, item.id)?.seq ?? item.seq };
  });
};
