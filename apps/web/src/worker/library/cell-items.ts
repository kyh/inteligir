// The library's item writes beyond a device's own ops, each landed inside one write's transaction
// by the rules every write meets (`./cell-landing`): a note or a file made whole, an agent's edit
// of an item's markdown, a highlight placed by its quote, a bulk organize, Deleted and back, and a
// url item's page asked for again. The markdown an agent reads and writes goes through the codec
// (`@repo/editor/codec/*`) over the cell's own SQL (`./cell-codec`).

import type { annotationOpSchema } from "@repo/contract/cloud/library/library-wire";
import type { EditOutcome } from "@repo/editor/codec/item-edit";
import { editItemView, placeItemQuotes } from "@repo/editor/codec/item-edit";
import { importItem } from "@repo/editor/codec/item-markdown";
import type { AnnotationStore } from "@repo/notes/annotations/store-schema";
import { fileKindOf } from "@repo/notes/items/item-kind";
import { blockHash } from "@repo/notes/library/block-hash";
import type { ItemState, LibraryOp } from "@repo/notes/library/block-ops";
import type { LibraryItemFields } from "@repo/notes/library/library-item";
import type { LibraryBlock, LibrarySection } from "@repo/notes/library/library-nodes";
import { readItem, readItemState } from "@repo/notes/library/library-queries";
import { runPlan } from "@repo/notes/library/library-sql";
import type { z } from "zod";

import { annotationSourceOf } from "./cell-actor";
import type { CellActor } from "./cell-actor";
import { applyAnnotationOps, readAnnotationRow } from "./cell-annotations";
import { readBlobRow } from "./cell-blobs";
import { fileKindOfMime } from "./cell-codec";
import type { CellCodec } from "./cell-codec";
import { folderOfTarget } from "./cell-folders";
import type { FolderTarget } from "./cell-folders";
import type { CellIds } from "./cell-ids";
import { landItem } from "./cell-landing";
import type { LandingScope, LiveItemRow } from "./cell-landing";
import { refuse, RefusedWriteError } from "./cell-refusal";
import { landWrite } from "./cell-writes";

type AnnotationOp = z.infer<typeof annotationOpSchema>;
export type AddOp = Extract<AnnotationOp, { op: "add" }>;

export interface PlacedBlock {
  readonly block: LibraryBlock;
  readonly ord: string;
  readonly section: LibrarySection;
}

export interface NewItem {
  readonly id: string;
  readonly fields: LibraryItemFields;
  readonly blocks: readonly PlacedBlock[];
  readonly annotations?: readonly AnnotationOp[] | undefined;
}

// an item's fields before its writer sets any: a note saved now, filed nowhere
export const blankFields = (now: number): LibraryItemFields => ({
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
  savedAt: now,
  site: null,
  tags: [],
  title: "",
  url: null,
});

const secondsOf = (scope: LandingScope): number => Math.floor(scope.now / 1000);

const placedState = (fields: LibraryItemFields, blocks: readonly PlacedBlock[]): ItemState => ({
  blocks: new Map(
    blocks.map(({ block, ord, section }) => [
      block.id,
      { block, hash: blockHash(block), ord, section },
    ]),
  ),
  fields,
});

// a bare highlight a passage's markers now wrap, as the write that made them adds its row
export const bareHighlight = (
  scope: LandingScope,
  highlight: { readonly id: string; readonly quote: string },
): AddOp => ({
  createdAt: secondsOf(scope),
  id: highlight.id,
  occurrence: null,
  op: "add",
  parentId: null,
  quote: highlight.quote,
  text: "",
});

// a store an import read, as the adds that make its rows; a root that kept no quote has no passage
// to anchor, so it is no highlight
export const storeAdds = (store: AnnotationStore): AddOp[] =>
  Object.entries(store).flatMap(([id, entry]): AddOp[] => {
    const parentId = entry.parentId ?? null;
    const quote = parentId === null ? (entry.quote ?? null) : null;
    return parentId === null && quote === null
      ? []
      : [
          {
            createdAt: entry.createdAt,
            id,
            occurrence: null,
            op: "add",
            parentId,
            quote,
            text: entry.text,
          },
        ];
  });

// an item the write makes, with its blocks and highlights; an id the library holds already is a
// conflict naming that item
export const landNew = (scope: LandingScope, actor: CellActor, item: NewItem): LiveItemRow => {
  const { storage } = scope;
  const held = runPlan(storage, readItem(item.id));
  if (held !== null) {
    refuse({ current: [{ itemId: item.id, kind: "item", seq: held.seq }], kind: "conflict" });
  }
  const highlights = applyAnnotationOps(new Map(), item.annotations ?? [], {
    itemId: item.id,
    nowSeconds: secondsOf(scope),
    readRow: (id) => readAnnotationRow(storage, id),
    source: annotationSourceOf(actor),
  });
  if (highlights.conflicts.length > 0) {
    refuse({ current: highlights.conflicts, kind: "conflict" });
  }
  return landItem(scope, {
    after: placedState(item.fields, item.blocks),
    annotations: highlights.landed,
    before: null,
    itemId: item.id,
  });
};

export interface MarkdownBlocks {
  readonly blocks: readonly PlacedBlock[];
  readonly highlights: readonly AddOp[];
}

// a person's markdown as note blocks and the bare highlights its `==x==` made; its frontmatter,
// if any, names nothing here, since the caller sets the item's own fields
export const noteBlocksOf = (
  scope: LandingScope,
  codec: CellCodec,
  markdown: string,
): MarkdownBlocks => {
  const read = importItem(
    { annotations: null, name: "", text: markdown },
    codec.importing(scope.now),
  );
  if (!read.ok) {
    return refuse({ kind: "too-large" });
  }
  return {
    blocks: read.item.blocks.filter((placed) => placed.section === "note"),
    highlights: storeAdds(read.item.annotations),
  };
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
  actor: CellActor,
  codec: CellCodec,
  ids: CellIds,
  input: CreateNoteInput,
): LiveItemRow => {
  const folderId = folderOfTarget(scope, input.folder, ids.item) ?? null;
  const read = importItem(
    { annotations: null, name: input.title ?? "", text: input.markdown },
    codec.importing(scope.now),
  );
  if (!read.ok) {
    return refuse({ kind: "too-large" });
  }
  const imported = read.item.fields;
  const fields: LibraryItemFields = {
    ...blankFields(scope.now),
    aliases: imported.aliases,
    properties: imported.properties,
    tags: [...new Set([...imported.tags, ...(input.tags ?? [])])],
    title: input.title ?? imported.title,
    folderId,
  };
  return landNew(scope, actor, {
    annotations: storeAdds(read.item.annotations),
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

// a file whose bytes the library holds: its kind from the type it was uploaded as, else its name;
// an image is its own cover
export const createFile = (
  scope: LandingScope,
  actor: CellActor,
  input: CreateFileInput,
): LiveItemRow => {
  const blob = readBlobRow(scope.storage, input.sha);
  if (blob === null) {
    return refuse({ kind: "blob-missing", shas: [input.sha] });
  }
  const byType = fileKindOfMime(blob.mime);
  const kind = byType === "file" ? (fileKindOf(input.name) ?? "file") : byType;
  const stem = input.name.replace(/\.[^.]+$/u, "");
  return landNew(scope, actor, {
    blocks: [],
    fields: {
      ...blankFields(scope.now),
      coverSha: kind === "image" ? input.sha : null,
      folderId: input.folderId,
      kind,
      originalName: input.name,
      originalSha: input.sha,
      savedAt: input.savedAt,
      tags: [...input.tags],
      title: input.title ?? (stem === "" ? input.name : stem),
    },
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
  readonly dropped: readonly string[];
  readonly seq: number;
}

// an agent's exact passages replaced on the item's markdown as it read it at `baseSeq`: an item
// changed since is a conflict naming its sequence, so the agent reads it again
export const editItem = (
  scope: LandingScope,
  actor: CellActor,
  codec: CellCodec,
  input: EditInput,
): EditAnswer => {
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
  const row = landWrite(scope, actor, {
    annotations: outcome.highlights.map((highlight) => bareHighlight(scope, highlight)),
    itemId: input.id,
    ops: outcome.ops,
  });
  return { dropped: outcome.dropped, seq: row.seq };
};

export interface QuotePlacement {
  readonly ops: readonly LibraryOp[];
  // the highlights whose markers now wrap their passage, those that wrapped one already included
  readonly placed: readonly string[];
}

export interface PlacingQuote {
  readonly id: string;
  readonly quote: string;
  readonly occurrence?: number | undefined;
}

// the ops that place highlights' markers by their quotes in an item as `state` holds it
export const placeQuotes = (
  state: ItemState,
  codec: CellCodec,
  quotes: readonly PlacingQuote[],
): QuotePlacement => placeItemQuotes(state.blocks, quotes, codec.edit);

export interface AddHighlightInput {
  readonly itemId: string;
  readonly quote: string;
  readonly note?: string | undefined;
  readonly occurrence?: number | undefined;
}

export interface AddedHighlight {
  readonly id: string;
  readonly item: LiveItemRow;
  readonly placed: boolean;
  readonly createdAt: number;
}

// a highlight by its passage's text, placed in the item's text where it stands; one the text does
// not hold is kept, unplaced
export const addHighlight = (
  scope: LandingScope,
  actor: CellActor,
  codec: CellCodec,
  ids: CellIds,
  input: AddHighlightInput,
): AddedHighlight => {
  const state = runPlan(scope.storage, readItemState(input.itemId));
  if (state === null) {
    return refuse({ kind: "not-found" });
  }
  const id = ids.annotation();
  const placement = placeQuotes(state, codec, [
    { id, occurrence: input.occurrence, quote: input.quote },
  ]);
  const createdAt = secondsOf(scope);
  const item = landWrite(scope, actor, {
    annotations: [
      {
        createdAt,
        id,
        occurrence: input.occurrence ?? null,
        op: "add",
        parentId: null,
        quote: input.quote,
        text: input.note ?? "",
      },
    ],
    itemId: input.itemId,
    ops: placement.ops,
  });
  return { createdAt, id, item, placed: placement.placed.includes(id) };
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
  actor: CellActor,
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
    return landWrite(scope, actor, { itemId, ops });
  });
};

export interface BulkAnswer {
  readonly changed: string[];
  readonly missing: string[];
}

// to Deleted, or back: an item already where it is asked to be counts as changed, an id naming
// no live item as missing, and so does an item whose address another live item holds now
export const setDeleted = (
  scope: LandingScope,
  actor: CellActor,
  input: { readonly ids: readonly string[]; readonly deleted: boolean },
): BulkAnswer => {
  const changed: string[] = [];
  const missing: string[] = [];
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
      landWrite(scope, actor, {
        itemId,
        ops: [{ base, field: "deletedAt", op: "set", value: input.deleted ? scope.now : null }],
      });
      changed.push(itemId);
    } catch (error) {
      // checked before anything of the item was written: its address is another live item's
      if (!(error instanceof RefusedWriteError) || error.refusal.kind !== "url-held") {
        throw error;
      }
      missing.push(itemId);
    }
  }
  return { changed, missing };
};

// a url item's page read again: it waits, pending, for the cloud to read it; an item with no
// address has no page to read
export const refreshItem = (scope: LandingScope, actor: CellActor, itemId: string): LiveItemRow => {
  const state = runPlan(scope.storage, readItemState(itemId));
  if (state === null || state.fields.url === null) {
    return refuse({ kind: "not-found" });
  }
  const { fields } = state;
  const ops: LibraryOp[] = [
    { base: fields.fetchState, field: "fetchState", op: "set", value: "pending" },
    { base: fields.fetchError, field: "fetchError", op: "set", value: null },
  ];
  return landWrite(scope, actor, { itemId, ops });
};
