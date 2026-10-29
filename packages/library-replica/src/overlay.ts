// What a screen reads: the item as the cell last sent it, with every outbox row that names it laid
// over, oldest first, the moment the row is written. A write lays down what it wrote whatever the
// item holds now, since the person's unsent text is what they expect to see until the cell
// answers; a make shows the item before the cell holds it; a delete moves it to Deleted. A parked
// row is laid over too, since its bytes are the person's until they discard them.

import type { AnnotationEntry, AnnotationStore } from "@repo/notes/annotations/store-schema";
import { fileKindOf } from "@repo/notes/items/item-kind";
import { blockHash } from "@repo/notes/library/block-hash";
import { mergeListField } from "@repo/notes/library/block-ops";
import type { ItemState, LibraryOp, StoredBlock } from "@repo/notes/library/block-ops";
import type { LibraryItemFields } from "@repo/notes/library/library-item";
import type { LibraryBlock, LibrarySection } from "@repo/notes/library/library-nodes";

import type { OutboxOp, WriteOp } from "./outbox-ops";

type ScalarField = Exclude<keyof LibraryItemFields, "aliases" | "properties" | "tags">;

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

// an item's fields before its writer sets any, as the cell's are: a note saved at `savedAt`,
// filed nowhere
const blankFields = (savedAt: number): LibraryItemFields => ({
  aliases: [],
  author: null,
  copySha: null,
  coverSha: null,
  deletedAt: null,
  description: null,
  fetchError: null,
  fetchState: "none",
  fetchedAt: null,
  folderId: null,
  kind: "note",
  lang: null,
  originalName: null,
  originalSha: null,
  pinnedAt: null,
  properties: {},
  published: null,
  savedAt,
  site: null,
  tags: [],
  title: "",
  url: null,
});

// the item a make lands as, as near as the device can tell before the cell answers: a saved
// link's note, which the cell reads from markdown, shows once it lands
const madeBy = (op: Extract<OutboxOp, { input: { id: string } }>): ItemState => {
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
        fields: {
          ...blankFields(input.savedAt),
          folderId: input.folderId,
          tags: input.tags,
          title: input.title,
        },
      };
    }
    case "saveLink": {
      const { input } = op;
      return {
        blocks: new Map(),
        fields: {
          ...blankFields(input.savedAt),
          fetchState: "pending",
          folderId: input.folder?.id ?? null,
          kind: "link",
          tags: input.tags,
          title: input.title ?? input.url,
          url: input.url,
        },
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
        fields: {
          ...blankFields(input.savedAt),
          ...input.facts,
          copySha: input.copySha,
          coverSha: input.coverSha,
          fetchState: "filled",
          folderId: input.folderId,
          kind: "link",
          tags: input.tags,
          title: input.title,
          url: input.url,
        },
      };
    }
    case "createFile": {
      const { input } = op;
      const kind = fileKindOf(input.name) ?? "file";
      return {
        blocks: new Map(),
        fields: {
          ...blankFields(input.savedAt),
          coverSha: kind === "image" ? input.sha : null,
          folderId: input.folderId,
          kind,
          originalName: input.name,
          originalSha: input.sha,
          tags: input.tags,
          title: input.title ?? input.name.replace(/\.[^.]+$/u, ""),
        },
      };
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
      return state === null || state.fields.deletedAt !== null
        ? state
        : { blocks: state.blocks, fields: { ...state.fields, deletedAt: createdAt } };
    }
    case "restore": {
      return state === null
        ? null
        : { blocks: state.blocks, fields: { ...state.fields, deletedAt: null } };
    }
    case "folders": {
      return state;
    }
    // no default
  }
};

type AnnotationOp = WriteOp["annotations"][number];

// an item's highlights with a write's highlight ops laid over: an add shows at once, signed as
// the person's, a note as written, a removal takes its replies with it
export const layAnnotations = (
  store: AnnotationStore,
  ops: readonly AnnotationOp[],
  nowSeconds: number,
): AnnotationStore => {
  const next = new Map(Object.entries(store));
  for (const op of ops) {
    switch (op.op) {
      case "add": {
        const entry: AnnotationEntry = {
          createdAt: op.createdAt,
          source: "user",
          text: op.text,
          updatedAt: nowSeconds,
        };
        if (op.parentId !== null) {
          entry.parentId = op.parentId;
        }
        if (op.quote !== null) {
          entry.quote = op.quote;
        }
        next.set(op.id, entry);
        break;
      }
      case "note": {
        const entry = next.get(op.id);
        if (entry !== undefined) {
          next.set(op.id, { ...entry, text: op.text, updatedAt: nowSeconds });
        }
        break;
      }
      case "remove": {
        for (const [id, entry] of next) {
          if (id === op.id || entry.parentId === op.id) {
            next.delete(id);
          }
        }
        break;
      }
      // no default
    }
  }
  return Object.fromEntries(next);
};
