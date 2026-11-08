// What a screen reads: the item as the cell last sent it, with every outbox row that names it laid
// over, oldest first, the moment the row is written. A write lays down what it wrote whatever the
// item holds now, since the person's unsent text is what they expect to see until the cell
// answers; a make shows the item before the cell holds it; a delete moves it to Deleted. A parked
// row is laid over too, since its bytes are the person's until they discard them.

import { blockHash } from "@repo/notes/library/block-hash";
import { mergeListField } from "@repo/notes/library/block-ops";
import type { ItemState, LibraryOp, ScalarField, StoredBlock } from "@repo/notes/library/block-ops";
import { fileFields, noteFields, pageFields, stubFields } from "@repo/notes/library/item-makes";
import type { LibraryItemFields } from "@repo/notes/library/library-item";
import type { LibraryBlock, LibrarySection } from "@repo/notes/library/library-nodes";

import type { OutboxOp, WriteOp } from "./outbox-ops";

const withField = <F extends ScalarField>(
  fields: LibraryItemFields,
  field: F,
  value: LibraryItemFields[F],
): LibraryItemFields => ({ ...fields, [field]: value });

const held = (block: LibraryBlock, ord: string, section: LibrarySection): StoredBlock => ({
  block,
  hash: blockHash(block),
  ord,
  section,
});

// one op laid down as it was written: a put whose block the cell has since dropped stands again
// where its base stood, since the write that will settle it keeps the person's text
const layLibraryOp = (state: ItemState, op: LibraryOp, bases: WriteOp["bases"]): ItemState => {
  const blocks = new Map(state.blocks);
  switch (op.op) {
    case "insert": {
      blocks.set(op.block.id, held(op.block, op.ord, op.section));
      return { blocks, fields: state.fields };
    }
    case "put": {
      const place = blocks.get(op.block.id) ?? bases[op.block.id];
      if (place !== undefined) {
        blocks.set(op.block.id, held(op.block, place.ord, place.section));
      }
      return { blocks, fields: state.fields };
    }
    case "drop": {
      blocks.delete(op.blockId);
      return { blocks, fields: state.fields };
    }
    case "move": {
      const place = blocks.get(op.blockId);
      if (place !== undefined) {
        blocks.set(op.blockId, { ...place, ord: op.ord });
      }
      return { blocks, fields: state.fields };
    }
    case "set": {
      return { blocks: state.blocks, fields: withField(state.fields, op.field, op.value) };
    }
    case "tags":
    case "aliases": {
      const merged = mergeListField(op.op, state.fields[op.op], op.base, op.value);
      return { blocks: state.blocks, fields: { ...state.fields, [op.op]: merged } };
    }
    case "property": {
      const properties = Object.fromEntries(
        Object.entries(state.fields.properties).filter(([key]) => key !== op.key),
      );
      if (op.value !== undefined) {
        properties[op.key] = op.value;
      }
      return { blocks: state.blocks, fields: { ...state.fields, properties } };
    }
    // no default
  }
};

// the item a make lands as, by the rules the cell lands it by: a saved link's note, which the cell
// reads from markdown, shows once it lands
export const madeBy = (op: Extract<OutboxOp, { input: { id: string } }>): ItemState => {
  switch (op.kind) {
    case "create": {
      const { input } = op;
      return {
        blocks: new Map(
          input.blocks.map((placed) => [
            placed.block.id,
            held(placed.block, placed.ord, placed.section),
          ]),
        ),
        fields: noteFields(input),
      };
    }
    case "saveLink": {
      const { input } = op;
      return {
        blocks: new Map(),
        fields: stubFields({ ...input, folderId: input.folder?.id ?? null }),
      };
    }
    case "save": {
      const { input } = op;
      return {
        blocks: new Map(
          input.article.map((placed) => [
            placed.block.id,
            held(placed.block, placed.ord, "article"),
          ]),
        ),
        fields: pageFields(input, input.savedAt),
      };
    }
    case "createFile": {
      const {
        input,
        staged: [file],
      } = op;
      return { blocks: new Map(), fields: fileFields({ ...input, mime: file.mime }) };
    }
    // no default
  }
};

// one row laid over one item it names: null while the item is neither held nor made yet
export const layRow = (
  state: ItemState | null,
  op: OutboxOp,
  createdAt: number,
): ItemState | null => {
  switch (op.kind) {
    case "write": {
      if (state === null) {
        return null;
      }
      let next = state;
      for (const libraryOp of op.ops) {
        next = layLibraryOp(next, libraryOp, op.bases);
      }
      return next;
    }
    case "create":
    case "saveLink":
    case "save":
    case "createFile": {
      return state ?? madeBy(op);
    }
    case "delete": {
      return state?.fields.deletedAt === null
        ? { blocks: state.blocks, fields: { ...state.fields, deletedAt: createdAt } }
        : state;
    }
    case "restore": {
      return state === null
        ? null
        : { blocks: state.blocks, fields: { ...state.fields, deletedAt: null } };
    }
    case "keep":
    case "folders": {
      return state;
    }
    // no default
  }
};
