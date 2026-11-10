// The library's item writes beyond a device's own ops, each landed inside one write's transaction
// by the rules every write meets (`./cell-landing`): a note or a file made whole, a bulk organize,
// Deleted and back, and a url item's page asked for again. The markdown an agent writes goes through
// the codec (`@repo/editor/codec/*`) over the cell's own SQL (`./cell-codec`); its edit of a note's
// body is the note's (`./cell-edits`).

import { importItem } from "@repo/editor/codec/item-markdown";
import type { BodyBlock } from "@repo/contract/library/derive-item";
import type { FieldOp } from "@repo/contract/library/field-ops";
import { blankItemFields, fileFields } from "@repo/contract/library/item-makes";
import type { LibraryItemFields } from "@repo/contract/library/library-item";
import { readItem, readLiveItem } from "./library-queries";

import { readBlobRow } from "./cell-blobs";
import type { CellCodec } from "./cell-codec";
import { folderOfTarget } from "./cell-folders";
import type { FolderTarget } from "./cell-folders";
import type { CellIds } from "./cell-ids";
import { landItem } from "./cell-landing";
import type { LandingScope, LiveItemRow } from "./cell-landing";
import { refuse, RefusedWriteError } from "./cell-refusal";
import { landWrite } from "./cell-writes";

export interface NewItem {
  readonly id: string;
  readonly fields: LibraryItemFields;
  // its body in reading order, which the cell keeps until its note first opens
  readonly blocks: readonly BodyBlock[];
}

// an item the write makes, with its body; an id the library holds already is a conflict naming
// that item
export const landNew = (scope: LandingScope, item: NewItem): LiveItemRow => {
  const held = readItem(scope.storage.db, item.id);
  if (held !== null) {
    refuse({ current: [{ itemId: item.id, kind: "item", seq: held.seq }], kind: "conflict" });
  }
  return landItem(scope, { before: null, fields: item.fields, itemId: item.id, seed: item.blocks });
};

// a person's markdown as note blocks; its frontmatter, if any, names nothing here, since the
// caller sets the item's own fields
export const noteBlocksOf = (
  scope: LandingScope,
  codec: CellCodec,
  markdown: string,
): readonly BodyBlock[] => {
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
  const blob = readBlobRow(scope.storage.db, input.sha);
  if (blob === null) {
    return refuse({ kind: "blob-missing", shas: [input.sha] });
  }
  return landNew(scope, {
    blocks: [],
    fields: fileFields({ ...input, mime: blob.mime }),
    id: input.id,
  });
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
    const item = readLiveItem(scope.storage.db, itemId);
    if (item === null) {
      return refuse({ kind: "not-found" });
    }
    const { fields } = item;
    const ops: FieldOp[] = [];
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
    const item = readLiveItem(scope.storage.db, itemId);
    if (item === null) {
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
  const item = readLiveItem(scope.storage.db, itemId);
  if (item === null || item.fields.url === null) {
    return refuse({ kind: "not-found" });
  }
  const { fields } = item;
  const ops: FieldOp[] = [
    { base: fields.fetchState, field: "fetchState", op: "set", value: "pending" },
    { base: fields.fetchError, field: "fetchError", op: "set", value: null },
  ];
  return landWrite(scope, { itemId, ops });
};
