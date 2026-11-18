// An edit of an item's note by passages (`library.items.edit`), as the built-in agent and a
// connected assistant write: made on the body as an editor opens it, then written over the version
// it was read at (`./write-body`). The edit is made outside any write, so no lock is held while the
// codec and an editor run over a long note. A save that lands meanwhile makes the write stale, and
// the edit is made again over the body that save left, once; past that the note kept changing, and
// the edit is refused as busy for its writer to send again.

import type { BodyBlock } from "@repo/contract/library/derive-item";
import { db } from "@repo/db/drizzle-client";
import { applyBodyChanges } from "@repo/editor/headless/body/body-change";
import { blocksOfValue, editorValueOf } from "@repo/editor/headless/body/note-blocks";
import type { ViewEdit } from "@repo/editor/headless/codec/item-edit";
import { BASE_KIT } from "@repo/editor/headless/kits/base-kit";
import { createSlateEditor } from "platejs";
import { z } from "zod";

import { editOutcomeOf } from "../library/library-codec";
import { refuse } from "../library/library-refusal";
import type { LibraryResult } from "../library/library-refusal";
import { readItemWhole } from "../library/library-rows";
import { priorAnswer, writeLibrary } from "../library/library-store";
import type { LibraryWriter } from "../library/library-store";
import { writeBody } from "./write-body";

// the edit made once, and once more over a save that landed while it was made
const EDIT_TRIES = 2;

export const editedSchema = z.object({ seq: z.number() });

export interface EditInput {
  readonly id: string;
  readonly edits: readonly ViewEdit[];
  readonly opId?: string | undefined;
}

// the body once the edits land on it, and the version it was read at
interface MadeEdit {
  readonly baseVersion: number;
  readonly blocks: readonly BodyBlock[];
}

const makeEdit = async (accountId: string, input: EditInput): Promise<LibraryResult<MadeEdit>> => {
  const whole = await readItemWhole(db, accountId, input.id);
  // an item in Deleted takes no edit
  if (whole === null || whole.item.fields.deletedAt !== null) {
    return { ok: false, refusal: { kind: "not-found" } };
  }
  const value = editorValueOf(whole.blocks);
  const outcome = await editOutcomeOf(db, accountId, {
    blocks: blocksOfValue(value),
    edits: input.edits,
    itemId: input.id,
  });
  switch (outcome.kind) {
    case "refused": {
      return { ok: false, refusal: { kind: "edit-refused", refusal: outcome.refusal } };
    }
    // a rule failed reading the new text: the codec's fault, which the library cannot keep
    case "failed": {
      return {
        ok: false,
        refusal: { kind: "edit-refused", refusal: { edit: outcome.edit, kind: "unstorable" } },
      };
    }
    case "changed": {
      const editor = createSlateEditor({ nodeId: true, plugins: BASE_KIT, value });
      // every change names a block as this same value holds it, so none can have moved
      if (applyBodyChanges(editor, outcome.changes).kind === "moved") {
        throw new Error(`an edit of ${input.id} named blocks its own reading did not hold`);
      }
      return {
        ok: true,
        value: { baseVersion: whole.bodyVersion, blocks: blocksOfValue(editor.children) },
      };
    }
    // no default
  }
};

export const editBody = async (
  writer: LibraryWriter,
  input: EditInput,
): Promise<LibraryResult<z.output<typeof editedSchema>>> => {
  const { opId } = input;
  const prior =
    opId === undefined ? null : await priorAnswer(db, writer.accountId, opId, editedSchema);
  if (prior !== null) {
    return { ok: true, value: prior.value };
  }
  for (let tries = 0; tries < EDIT_TRIES; tries += 1) {
    const made = await makeEdit(writer.accountId, input);
    if (!made.ok) {
      return made;
    }
    const { baseVersion, blocks } = made.value;
    const written = await writeLibrary(writer, { answer: editedSchema, opId }, async (scope) => {
      const write = await writeBody(scope, { baseVersion, blocks, itemId: input.id });
      switch (write.kind) {
        case "saved": {
          return { seq: write.seq };
        }
        // rolled back, so the op keeps no answer and the edit is made again
        case "stale": {
          return refuse({ kind: "conflict" });
        }
        case "full": {
          return refuse({ kind: "too-large" });
        }
        case "deleted": {
          return refuse({ kind: "not-found" });
        }
        // no default
      }
    });
    if (written.ok || written.refusal.kind !== "conflict") {
      return written;
    }
  }
  return { ok: false, refusal: { kind: "busy" } };
};
