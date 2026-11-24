import type { BodyBlock } from "@repo/contract/library/derive-item";
import { db } from "@repo/db/drizzle-client";
import { applyBodyChanges } from "@repo/editor/headless/body/body-change";
import { blocksOfValue, editorValueOf } from "@repo/editor/headless/body/note-blocks";
import type { ViewEdit } from "@repo/editor/headless/body/item-edit";
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

const EDIT_TRIES = 2;

const editedSchema = z.object({ seq: z.number() });

export interface EditInput {
  readonly id: string;
  readonly edits: readonly ViewEdit[];
  readonly opId?: string | undefined;
}

interface MadeEdit {
  readonly baseVersion: number;
  readonly blocks: readonly BodyBlock[];
}

const makeEdit = async (accountId: string, input: EditInput) => {
  const whole = await readItemWhole(db, accountId, input.id);

  if (whole === null || whole.item.fields.deletedAt !== null) {
    return { ok: false, refusal: { kind: "not-found" } } satisfies LibraryResult<MadeEdit>;
  }

  const value = editorValueOf(whole.blocks);

  const outcome = await editOutcomeOf(db, accountId, {
    blocks: blocksOfValue(value),
    edits: input.edits,
    itemId: input.id,
  });

  switch (outcome.kind) {
    case "refused": {
      return {
        ok: false,
        refusal: { kind: "edit-refused", refusal: outcome.refusal },
      } satisfies LibraryResult<MadeEdit>;
    }

    case "failed": {
      return {
        ok: false,
        refusal: { kind: "edit-refused", refusal: { edit: outcome.edit, kind: "unstorable" } },
      } satisfies LibraryResult<MadeEdit>;
    }

    case "changed": {
      const editor = createSlateEditor({ nodeId: true, plugins: BASE_KIT, value });

      if (applyBodyChanges(editor, outcome.changes).kind === "moved") {
        throw new Error(`an edit of ${input.id} named blocks its own reading did not hold`);
      }

      return {
        ok: true,
        value: { baseVersion: whole.bodyVersion, blocks: blocksOfValue(editor.children) },
      } satisfies LibraryResult<MadeEdit>;
    }

    default: {
      throw new Error(`unexpected ${String(outcome satisfies never)}`);
    }
  }
};

export const editBody = async (writer: LibraryWriter, input: EditInput) => {
  const { opId } = input;

  const prior =
    opId === undefined ? null : await priorAnswer(db, writer.accountId, opId, editedSchema);

  if (prior !== null) {
    return { ok: true, value: prior.value } satisfies LibraryResult<z.output<typeof editedSchema>>;
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

        case "stale": {
          return refuse({ kind: "conflict" });
        }

        case "full": {
          return refuse({ kind: "too-large" });
        }

        case "deleted": {
          return refuse({ kind: "not-found" });
        }

        default: {
          throw new Error(`unexpected ${String(write satisfies never)}`);
        }
      }
    });

    if (written.ok || written.refusal.kind !== "conflict") {
      return written;
    }
  }

  return { ok: false, refusal: { kind: "busy" } } satisfies LibraryResult<
    z.output<typeof editedSchema>
  >;
};
