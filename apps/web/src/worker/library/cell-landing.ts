// Landing one item's change inside a write's transaction: every rule a write meets (the item's text
// cap, its history's caps, one live item per url, the files it names, the quota), then its rows,
// stamped with the write's one sequence number. Only what changed is written: the blocks the write
// touched, a dropped block's row gone and its content kept for history, the derived rows and the
// index row when the body or the fields moved, the highlight rows the write changed.

import { libraryItemFieldsSchema } from "@repo/notes/library/library-item";
import { canonicalJson, utf8ByteLength } from "@repo/notes/library/canonical-json";
import { deriveItem } from "@repo/notes/library/derive-item";
import type { ItemCard } from "@repo/notes/library/derive-item";
import {
  blockWritesOf,
  dropBlocks,
  recordChanges,
  storeBlocks,
  storeDerived,
  storeItemRow,
  storeSearchRow,
} from "@repo/notes/library/library-queries";
import { LibraryRowError, runPlan } from "@repo/notes/library/library-sql";
import type { ItemState, StoredBlock } from "@repo/notes/library/block-ops";
import type { LibraryItemFields } from "@repo/notes/library/library-item";
import { z } from "zod";

import { annotationGrowth, annotationStoreOf, storeAnnotationRows } from "./cell-annotations";
import type { AnnotationRows, AnnotationsLanded } from "./cell-annotations";
import { blobRefsOf, missingBlobs, storeItemBlobs } from "./cell-blobs";
import { encodeParts, keepSuperseded, partsFit } from "./cell-parts";
import { holdRoomFor } from "./cell-quota";
import { refuse } from "./cell-refusal";
import type { CellStorage } from "./cell-storage";
import { touchItem } from "./change-sets";
import type { OpenSet } from "./change-sets";

// an item's text, all its blocks' together (the spec's cap); a block's own is the vocabulary's
export const ITEM_TEXT_MAX_BYTES = 8 * 1024 * 1024;

// an item as a replica pulls it
export interface LiveItemRow {
  readonly card: ItemCard;
  readonly fields: LibraryItemFields;
  readonly id: string;
  readonly kind: "live";
  readonly seq: number;
  readonly updatedAt: number;
}

export interface Landing {
  readonly itemId: string;
  // null: the write makes the item
  readonly before: { readonly state: ItemState; readonly rows: AnnotationRows } | null;
  readonly after: ItemState;
  readonly annotations: AnnotationsLanded;
}

// what a write lands under: its one sequence number and time, and its actor's set, each taken on
// the first landing so a write that lands nothing moves nothing
export interface LandingScope {
  readonly storage: CellStorage;
  readonly bytesCap: number;
  readonly now: number;
  readonly seq: () => number;
  readonly set: () => OpenSet;
}

const sameBlock = (a: StoredBlock | undefined, b: StoredBlock): boolean =>
  a !== undefined && a.hash === b.hash && a.ord === b.ord && a.section === b.section;

const blockBytes = (stored: StoredBlock): number => utf8ByteLength(canonicalJson(stored.block));

interface BlockDiff {
  // blocks new or moved or changed, which their rows take
  readonly written: StoredBlock[];
  readonly dropped: string[];
  // the contents a write replaces or drops, which history keeps
  readonly superseded: StoredBlock[];
  // the bytes of block content the write adds, less what it takes out
  readonly growth: number;
}

const diffBlocks = (
  before: ReadonlyMap<string, StoredBlock>,
  after: ReadonlyMap<string, StoredBlock>,
): BlockDiff => {
  const written: StoredBlock[] = [];
  const dropped: string[] = [];
  const superseded: StoredBlock[] = [];
  let growth = 0;
  for (const [id, stored] of after) {
    const held = before.get(id);
    if (sameBlock(held, stored)) {
      continue;
    }
    written.push(stored);
    if (held === undefined) {
      growth += blockBytes(stored);
    } else if (held.hash !== stored.hash) {
      superseded.push(held);
      growth += blockBytes(stored) - blockBytes(held);
    }
  }
  for (const [id, held] of before) {
    if (!after.has(id)) {
      dropped.push(id);
      superseded.push(held);
      growth -= blockBytes(held);
    }
  }
  return { dropped, growth, superseded, written };
};

const urlHolderSchema = z.object({ id: z.string(), seq: z.number() });

// the other live item holding a url key, if one does
export const urlHolder = (
  storage: CellStorage,
  urlKey: string,
  itemId: string | null,
): z.infer<typeof urlHolderSchema> | null => {
  const [row] = storage.all(
    `SELECT id, seq FROM items WHERE url_key = ? AND deleted_at IS NULL AND purged = 0
       AND id IS NOT ? LIMIT 1`,
    [urlKey, itemId],
  );
  return row === undefined ? null : urlHolderSchema.parse(row);
};

const sameShas = (a: readonly string[], b: readonly string[]): boolean => {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((sha) => right.has(sha));
};

// what the rules computed on the way: the item's derivation, the files it names and its blocks'
// change
interface Checked {
  readonly derived: ReturnType<typeof deriveItem>;
  readonly refs: ReturnType<typeof blobRefsOf>;
  readonly priorShas: readonly string[];
  readonly blocks: BlockDiff;
}

// every rule a landing meets, before anything is written: a refusal leaves nothing to roll back
const checkLanding = (scope: LandingScope, landing: Landing): Checked => {
  const { storage } = scope;
  const { after, before, itemId } = landing;
  if (!libraryItemFieldsSchema.validate(after.fields)) {
    refuse({ kind: "too-large" });
  }
  const derived = deriveItem(after.fields, after.blocks);
  const store = annotationStoreOf(landing.annotations.rows);
  if (
    derived.textBytes > ITEM_TEXT_MAX_BYTES ||
    !partsFit(encodeParts({ annotations: store, state: after }))
  ) {
    refuse({ kind: "too-large" });
  }
  if (derived.urlKey !== null && after.fields.deletedAt === null) {
    const holder = urlHolder(storage, derived.urlKey, itemId);
    if (holder !== null) {
      refuse({ itemId: holder.id, kind: "url-held", seq: holder.seq });
    }
  }
  const refs = blobRefsOf(after);
  const priorShas = before === null ? [] : blobRefsOf(before.state).map((ref) => ref.sha);
  const missing = missingBlobs(
    storage,
    refs.map((ref) => ref.sha).filter((sha) => !priorShas.includes(sha)),
  );
  if (missing.length > 0) {
    refuse({ kind: "blob-missing", shas: missing });
  }
  const blocks = diffBlocks(before?.state.blocks ?? new Map(), after.blocks);
  holdRoomFor(
    storage,
    scope.bytesCap,
    blocks.growth + annotationGrowth(before?.rows ?? new Map(), landing.annotations),
  );
  return { blocks, derived, priorShas, refs };
};

// the row the item lands as; refuses a change no rule admits, before anything is written
export const landItem = (scope: LandingScope, landing: Landing): LiveItemRow => {
  const { storage } = scope;
  const { after, before, itemId } = landing;
  const { blocks, derived, priorShas, refs } = checkLanding(scope, landing);
  const seq = scope.seq();
  const set = scope.set();
  touchItem(
    storage,
    {
      before:
        before === null
          ? null
          : { annotations: annotationStoreOf(before.rows), state: before.state },
      itemId,
      setId: set.id,
    },
    scope.now,
  );
  const landed = runPlan(
    storage,
    storeItemRow({ derived, fields: after.fields, id: itemId, seq, updatedAt: scope.now }),
  );
  if (!landed) {
    throw new LibraryRowError(`the item ${itemId} holds a row newer than the library's head`);
  }
  keepSuperseded(storage, itemId, blocks.superseded);
  runPlan(storage, dropBlocks(itemId, blocks.dropped));
  runPlan(storage, storeBlocks(itemId, blockWritesOf(blocks.written, derived), seq));
  const fieldsChanged =
    before === null || canonicalJson(before.state.fields) !== canonicalJson(after.fields);
  if (blocks.written.length > 0 || blocks.dropped.length > 0 || fieldsChanged) {
    runPlan(storage, storeDerived(itemId, derived));
    // a person's typing reindexes when its set seals (`./change-sets`)
    if (set.actor !== "person") {
      runPlan(storage, storeSearchRow(itemId, derived.search));
    }
  }
  const named = refs.map((ref) => ref.sha);
  if (before === null || !sameShas(priorShas, named)) {
    storeItemBlobs(storage, itemId, refs);
  }
  storeAnnotationRows(storage, landing.annotations, seq);
  runPlan(
    storage,
    recordChanges([
      { gone: false, id: itemId, kind: "item", seq },
      ...[...landing.annotations.changed].map((id) => ({
        gone: false,
        id,
        kind: "annotation" as const,
        seq,
      })),
    ]),
  );
  return {
    card: derived.card,
    fields: after.fields,
    id: itemId,
    kind: "live",
    seq,
    updatedAt: scope.now,
  };
};
