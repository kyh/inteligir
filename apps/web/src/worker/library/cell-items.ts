// The library's item writes beyond a device's own ops, each landed inside one write's transaction
// by the rules every write meets (`./cell-landing`): a note or a file made whole, an agent's edit
// of an item's markdown, a bulk organize, Deleted and back, and a url item's page asked for again. The markdown an agent reads and writes goes through the codec
// (`@repo/editor/codec/*`) over the cell's own SQL (`./cell-codec`).

import type { EditOutcome } from "@repo/editor/codec/item-edit";
import { editItemView } from "@repo/editor/codec/item-edit";
import { importItem } from "@repo/editor/codec/item-markdown";
import { blockHash } from "@repo/notes/library/block-hash";
import type { ItemState, LibraryOp } from "@repo/notes/library/block-ops";
import { blankItemFields, fileFields } from "@repo/notes/library/item-makes";
import type { LibraryItemFields } from "@repo/notes/library/library-item";
import type { LibraryBlock, LibrarySection } from "@repo/notes/library/library-nodes";
import { readItem, readItemState } from "@repo/notes/library/library-queries";
import { runPlan } from "@repo/notes/library/library-sql";

import { readBlobRow } from "./cell-blobs";
import type { CellCodec } from "./cell-codec";
import { folderOfTarget } from "./cell-folders";
import type { FolderTarget } from "./cell-folders";
import type { CellIds } from "./cell-ids";
import { landItem } from "./cell-landing";
import type { LandingScope, LiveItemRow } from "./cell-landing";
import { refuse, RefusedWriteError } from "./cell-refusal";
import { landWrite } from "./cell-writes";

export interface PlacedBlock {
  readonly block: LibraryBlock;
  readonly ord: string;
  readonly section: LibrarySection;
}

export interface NewItem {
  readonly id: string;
  readonly fields: LibraryItemFields;
  readonly blocks: readonly PlacedBlock[];
}

const placedState = (fields: LibraryItemFields, blocks: readonly PlacedBlock[]): ItemState => ({
  blocks: new Map(
    blocks.map(({ block, ord, section }) => [
      block.id,
      { block, hash: blockHash(block), ord, section },
    ]),
  ),
  fields,
});

// an item the write makes, with its blocks; an id the library holds already is a conflict naming
// that item
export const landNew = (scope: LandingScope, item: NewItem): LiveItemRow => {
  const held = runPlan(scope.storage, readItem(item.id));
  if (held !== null) {
    refuse({ current: [{ itemId: item.id, kind: "item", seq: held.seq }], kind: "conflict" });
  }
  return landItem(scope, {
    after: placedState(item.fields, item.blocks),
    before: null,
    itemId: item.id,
  });
};

// a person's markdown as note blocks; its frontmatter, if any, names nothing here, since the
// caller sets the item's own fields
export const noteBlocksOf = (
  scope: LandingScope,
  codec: CellCodec,
  markdown: string,
): readonly PlacedBlock[] => {
  const read = importItem({ name: "", text: markdown }, codec.importing(scope.now));
  if (!read.ok || read.item.leftOut > 0) {
    return refuse({ kind: "too-large" });
  }
  return read.item.blocks.filter((placed) => placed.section === "note");
};

export interface CreateNoteInput {
  readonly markdown: string;
  readonly title?: string | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly folder?: FolderTarget | undefined;
}

// a note from an agent's markdown: whatever kind or address its frontmatter names, it is a note,
// titled as asked or as the frontmatter names it, its tags the frontmatter's and the request's
export const createNote = (
  scope: LandingScope,
  codec: CellCodec,
  ids: CellIds,
  input: CreateNoteInput,
): LiveItemRow => {
  const folderId = folderOfTarget(scope, input.folder, ids.item) ?? null;
  const read = importItem(
    { name: input.title ?? "", text: input.markdown },
    codec.importing(scope.now),
  );
  if (!read.ok || read.item.leftOut > 0) {
    return refuse({ kind: "too-large" });
  }
  const imported = read.item.fields;
  const fields: LibraryItemFields = {
    ...blankItemFields(scope.now),
    aliases: imported.aliases,
    properties: imported.properties,
    tags: [...new Set([...imported.tags, ...(input.tags ?? [])])],
    title: input.title ?? imported.title,
    folderId,
  };
  return landNew(scope, {
    blocks: read.item.blocks,
    fields,
    id: ids.item(),
  });
};

export interface CreateFileInput {
  readonly id: string;
  readonly sha: string;
  readonly name: string;
  readonly title?: string | undefined;
  readonly tags: readonly string[];
  readonly folderId: string | null;
  readonly savedAt: number;
}

// a file whose bytes the library holds
export const createFile = (scope: LandingScope, input: CreateFileInput): LiveItemRow => {
  const blob = readBlobRow(scope.storage, input.sha);
  if (blob === null) {
    return refuse({ kind: "blob-missing", shas: [input.sha] });
  }
  return landNew(scope, {
    blocks: [],
    fields: fileFields({ ...input, mime: blob.mime }),
    id: input.id,
  });
};

type EditRefusal = Extract<EditOutcome, { kind: "refused" }>["refusal"];

const editRefusalOf = (refusal: EditRefusal) =>
  refusal.kind === "ambiguous"
    ? { count: refusal.count, edit: refusal.edit, reason: refusal.kind }
    : { edit: refusal.edit, reason: refusal.kind };

export interface EditInput {
  readonly id: string;
  readonly baseSeq: number;
  readonly edits: readonly { readonly oldText: string; readonly newText: string }[];
}

export interface EditAnswer {
  readonly seq: number;
}

// an agent's exact passages replaced on the item's markdown as it read it at `baseSeq`: an item
// changed since is a conflict naming its sequence, so the agent reads it again
export const editItem = (scope: LandingScope, codec: CellCodec, input: EditInput): EditAnswer => {
  const item = runPlan(scope.storage, readItem(input.id));
  if (item?.kind !== "live") {
    return refuse({ kind: "not-found" });
  }
  if (item.seq !== input.baseSeq) {
    refuse({ current: [{ itemId: input.id, kind: "item", seq: item.seq }], kind: "conflict" });
  }
  const state = runPlan(scope.storage, readItemState(input.id));
  if (state === null) {
    return refuse({ kind: "not-found" });
  }
  const outcome = editItemView(state.blocks, input.edits, codec.edit);
  if (outcome.kind === "refused") {
    return refuse({ kind: "edit-refused", refusal: editRefusalOf(outcome.refusal) });
  }
  const row = landWrite(scope, { itemId: input.id, ops: outcome.ops });
  return { seq: row.seq };
};

export interface OrganizeInput {
  readonly ids: readonly string[];
  readonly addTags?: readonly string[] | undefined;
  readonly removeTags?: readonly string[] | undefined;
  readonly folder?: FolderTarget | undefined;
  readonly pinned?: boolean | undefined;
  readonly title?: string | undefined;
}

const tagKey = (tag: string): string => tag.toLowerCase();

// tags, folder, pin and title for each item, in the one set the write joins; an id that names
// no live item refuses the whole change
export const organizeItems = (
  scope: LandingScope,
  ids: CellIds,
  input: OrganizeInput,
): LiveItemRow[] => {
  const folderId = folderOfTarget(scope, input.folder, ids.item);
  const removed = new Set((input.removeTags ?? []).map(tagKey));
  return [...new Set(input.ids)].map((itemId) => {
    const state = runPlan(scope.storage, readItemState(itemId));
    if (state === null) {
      return refuse({ kind: "not-found" });
    }
    const { fields } = state;
    const ops: LibraryOp[] = [];
    if (input.addTags !== undefined || input.removeTags !== undefined) {
      const kept = fields.tags.filter((tag) => !removed.has(tagKey(tag)));
      const held = new Set(kept.map(tagKey));
      const added = (input.addTags ?? []).filter((tag) => !held.has(tagKey(tag)));
      ops.push({ base: fields.tags, op: "tags", value: [...kept, ...new Set(added)] });
    }
    if (folderId !== undefined && folderId !== fields.folderId) {
      ops.push({ base: fields.folderId, field: "folderId", op: "set", value: folderId });
    }
    if (input.pinned !== undefined && input.pinned !== (fields.pinnedAt !== null)) {
      ops.push({
        base: fields.pinnedAt,
        field: "pinnedAt",
        op: "set",
        value: input.pinned ? scope.now : null,
      });
    }
    if (input.title !== undefined && input.title !== fields.title) {
      ops.push({ base: fields.title, field: "title", op: "set", value: input.title });
    }
    return landWrite(scope, { itemId, ops });
  });
};

export interface BulkAnswer {
  readonly changed: string[];
  readonly missing: string[];
  // left in Deleted, each address another live item's now
  readonly addressHeld: string[];
}

// to Deleted, or back: an item already where it is asked to be counts as changed, and an id naming
// no live item as missing
export const setDeleted = (
  scope: LandingScope,
  input: { readonly ids: readonly string[]; readonly deleted: boolean },
): BulkAnswer & { readonly landed: readonly LiveItemRow[] } => {
  const changed: string[] = [];
  const missing: string[] = [];
  const landed: LiveItemRow[] = [];
  const addressHeld: string[] = [];
  for (const itemId of new Set(input.ids)) {
    const item = runPlan(scope.storage, readItem(itemId));
    if (item?.kind !== "live") {
      missing.push(itemId);
      continue;
    }
    const base = item.fields.deletedAt;
    if ((base !== null) === input.deleted) {
      changed.push(itemId);
      continue;
    }
    try {
      landed.push(
        landWrite(scope, {
          itemId,
          ops: [{ base, field: "deletedAt", op: "set", value: input.deleted ? scope.now : null }],
        }),
      );
      changed.push(itemId);
    } catch (error) {
      // checked before anything of the item was written: its address is another live item's
      if (!(error instanceof RefusedWriteError) || error.refusal.kind !== "url-held") {
        throw error;
      }
      addressHeld.push(itemId);
    }
  }
  return { addressHeld, changed, landed, missing };
};

// a url item's page read again: it waits, pending, for the cloud to read it; an item with no
// address has no page to read
export const refreshItem = (scope: LandingScope, itemId: string): LiveItemRow => {
  const state = runPlan(scope.storage, readItemState(itemId));
  if (state === null || state.fields.url === null) {
    return refuse({ kind: "not-found" });
  }
  const { fields } = state;
  const ops: LibraryOp[] = [
    { base: fields.fetchState, field: "fetchState", op: "set", value: "pending" },
    { base: fields.fetchError, field: "fetchError", op: "set", value: null },
  ];
  return landWrite(scope, { itemId, ops });
};
