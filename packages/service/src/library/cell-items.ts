// The library's item writes beyond a device's own ops, each landed inside one write's transaction
// by the rules every write meets (`./cell-landing`): a note or a file made whole, and an item's
// fields as a bulk organize, Deleted and back, or its page asked for again leaves them
// (`./cell-writes`). The markdown an agent writes goes through the codec (`@repo/editor/codec/*`)
// over the cell's own SQL (`./cell-codec`); its edit of a note's body is the note's
// (`./cell-edits`).

import { readBody } from "@repo/editor/codec/read-body";
import type { BodyBlock } from "@repo/contract/library/derive-item";
import { organized } from "@repo/contract/library/cell-rules";
import type { FolderTarget, OrganizeInput } from "@repo/contract/library/cell-rules";
import { fileFields, noteFields } from "@repo/contract/library/item-makes";
import { withReading } from "@repo/contract/library/item-reading";
import type { LibraryItemFields } from "@repo/contract/library/library-item";
import { readItem, readLiveItem } from "./library-queries";

import { readBlobRow } from "./cell-blobs";
import { logReadFailure } from "./cell-codec";
import type { CellCodec } from "./cell-codec";
import { folderOfTarget } from "./cell-folders";
import type { CellIds } from "./cell-ids";
import { landItem } from "./cell-landing";
import type { LandingScope, LiveItemRow } from "./cell-landing";
import { refuse, RefusedWriteError } from "./cell-refusal";
import { landFields } from "./cell-writes";

export interface NewItem {
  readonly id: string;
  readonly fields: LibraryItemFields;
  // its body in reading order, which the cell keeps until its note first opens
  readonly blocks: readonly BodyBlock[];
}

// an item the write makes, with its body; an id the library holds already is a conflict
export const landNew = (scope: LandingScope, item: NewItem): LiveItemRow => {
  if (readItem(scope.db, item.id) !== null) {
    refuse({ kind: "conflict" });
  }
  return landItem(scope, { before: null, fields: item.fields, itemId: item.id, seed: item.blocks });
};

// a person's or an agent's markdown as note blocks, every block of it or none
export const noteBlocksOf = (codec: CellCodec, markdown: string): readonly BodyBlock[] => {
  const read = readBody(markdown, codec.body);
  if (!read.ok && read.reason.kind === "failed") {
    logReadFailure(read.reason.error);
  }
  if (!read.ok || read.refused > 0) {
    return refuse({ kind: "too-large" });
  }
  return read.blocks.map((block) => ({ block, section: "note" }));
};

export interface CreateNoteInput {
  readonly markdown: string;
  readonly title?: string | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly folder?: FolderTarget | undefined;
}

// a note from an agent's markdown, titled, tagged and filed as the request asks: its text names
// no field, so a `---` block opening it is a code block, as in an edit
export const createNote = (
  scope: LandingScope,
  codec: CellCodec,
  ids: CellIds,
  input: CreateNoteInput,
): LiveItemRow => {
  const folderId = folderOfTarget(scope, input.folder, ids.item) ?? null;
  return landNew(scope, {
    blocks: noteBlocksOf(codec, input.markdown),
    fields: noteFields({
      folderId,
      savedAt: scope.now,
      tags: input.tags ?? [],
      title: input.title ?? "",
    }),
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
  const blob = readBlobRow(scope.db, input.sha);
  if (blob === null) {
    return refuse({ kind: "blob-missing", shas: [input.sha] });
  }
  return landNew(scope, {
    blocks: [],
    fields: fileFields({ ...input, mime: blob.mime }),
    id: input.id,
  });
};

// tags, folder, pin and title for each item, in the one set the write joins; an id that names
// no live item refuses the whole change
export const organizeItems = (
  scope: LandingScope,
  ids: CellIds,
  input: OrganizeInput,
): LiveItemRow[] => {
  const folderId = folderOfTarget(scope, input.folder, ids.item);
  return [...new Set(input.ids)].map((itemId) => {
    const item = readLiveItem(scope.db, itemId);
    if (item === null) {
      return refuse({ kind: "not-found" });
    }
    return landFields(scope, item, organized(item.fields, input, folderId, scope.now));
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
    const item = readLiveItem(scope.db, itemId);
    if (item === null) {
      missing.push(itemId);
      continue;
    }
    if ((item.fields.deletedAt !== null) === input.deleted) {
      changed.push(itemId);
      continue;
    }
    try {
      landed.push(
        landFields(scope, item, { ...item.fields, deletedAt: input.deleted ? scope.now : null }),
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
  const item = readLiveItem(scope.db, itemId);
  if (item === null || item.fields.url === null) {
    return refuse({ kind: "not-found" });
  }
  return landFields(scope, item, withReading(item.fields, { kind: "asked" }));
};
