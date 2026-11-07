// What an outbox row holds: one write the device made, as the `/v1` call it goes as, parsed on
// every read. A write to an item keeps the base block each `put` was computed from, so a CONFLICT
// can merge three ways; a file or a page's cover names the bytes it waits to upload. A later write
// to the same item joins a row still queued, and the two compact to one batch, so an hour of
// offline typing is one write on the first base.

import {
  annotationOpSchema,
  folderOpSchema,
  idSchema,
  MARKDOWN_MAX,
  newIdSchema,
  placedBlockSchema,
  shaSchema,
} from "@repo/contract/cloud/library/library-wire";
import { ANNOTATION_QUOTE_MAX } from "@repo/notes/annotations/store-schema";
import { blockHash } from "@repo/notes/library/block-hash";
import {
  blockHashSchema,
  libraryOpSchema,
  sameList,
  sameOptionalJson,
} from "@repo/notes/library/block-ops";
import type { LibraryOp, StoredBlock } from "@repo/notes/library/block-ops";
import { ordSchema } from "@repo/notes/library/block-order";
import { libraryItemFieldsSchema } from "@repo/notes/library/library-item";
import {
  blockIdSchema,
  collectFileShas,
  libraryBlockSchema,
  librarySectionSchema,
  storableBlockSchema,
} from "@repo/notes/library/library-nodes";
import type { LibraryBlock } from "@repo/notes/library/library-nodes";
import { z } from "zod";

const FIELDS = libraryItemFieldsSchema.shape;

const heldBlockSchema = z.strictObject({
  block: libraryBlockSchema,
  hash: blockHashSchema,
  ord: ordSchema,
  section: librarySectionSchema,
});

// a file the row uploads before it goes, by its bytes' sha and the type it is sent as
const stagedSchema = z.strictObject({ mime: z.string().min(1).max(255), sha: shaSchema });
export type StagedFile = z.infer<typeof stagedSchema>;

const writeSchema = z.strictObject({
  annotations: z.array(annotationOpSchema),
  // each `put`'s block as the write was computed from it, by block id
  bases: z.record(blockIdSchema, heldBlockSchema),
  itemId: idSchema,
  kind: z.literal("write"),
  ops: z.array(libraryOpSchema),
  // the files a block the write puts embeds, uploaded before it goes
  staged: z.array(stagedSchema),
});
export type WriteOp = z.infer<typeof writeSchema>;

const createSchema = z.strictObject({
  kind: z.literal("create"),
  staged: z.array(stagedSchema),
  input: z.strictObject({
    blocks: z.array(placedBlockSchema),
    folderId: idSchema.nullable(),
    id: newIdSchema,
    savedAt: FIELDS.savedAt,
    tags: FIELDS.tags,
    title: FIELDS.title,
  }),
});

const saveLinkSchema = z.strictObject({
  input: z.strictObject({
    folder: z.strictObject({ id: idSchema }).nullable(),
    id: newIdSchema,
    note: z.string().max(MARKDOWN_MAX).optional(),
    savedAt: FIELDS.savedAt,
    tags: FIELDS.tags,
    title: FIELDS.title.optional(),
    url: FIELDS.url.unwrap(),
  }),
  kind: z.literal("saveLink"),
});

const saveSchema = z.strictObject({
  input: z.strictObject({
    article: z.array(z.strictObject({ block: storableBlockSchema, ord: ordSchema })),
    coverSha: shaSchema.nullable(),
    facts: z.strictObject({
      author: FIELDS.author,
      description: FIELDS.description,
      lang: FIELDS.lang,
      published: FIELDS.published,
      site: FIELDS.site,
    }),
    folderId: idSchema.nullable(),
    id: newIdSchema,
    note: z.string().max(MARKDOWN_MAX).optional(),
    savedAt: FIELDS.savedAt,
    selection: z.string().min(1).max(ANNOTATION_QUOTE_MAX).nullable(),
    tags: FIELDS.tags,
    title: FIELDS.title,
    url: FIELDS.url.unwrap(),
  }),
  kind: z.literal("save"),
  staged: z.array(stagedSchema),
});

const createFileSchema = z.strictObject({
  input: z.strictObject({
    folderId: idSchema.nullable(),
    id: newIdSchema,
    name: FIELDS.originalName.unwrap(),
    savedAt: FIELDS.savedAt,
    sha: shaSchema,
    tags: FIELDS.tags,
    title: FIELDS.title.optional(),
  }),
  kind: z.literal("createFile"),
  staged: z.tuple([stagedSchema]),
});

// a file kept on the device for a write still to come, a picture pasted into a note's text: it goes
// up as soon as it can, and the bytes stay while any row names them
const keepSchema = z.strictObject({
  kind: z.literal("keep"),
  staged: z.tuple([stagedSchema]),
});

const idsSchema = z.array(idSchema).min(1);

export const outboxOpSchema = z.discriminatedUnion("kind", [
  writeSchema,
  createSchema,
  saveLinkSchema,
  saveSchema,
  createFileSchema,
  keepSchema,
  z.strictObject({ ids: idsSchema, kind: z.literal("delete") }),
  z.strictObject({ ids: idsSchema, kind: z.literal("restore") }),
  z.strictObject({ kind: z.literal("folders"), ops: z.array(folderOpSchema).min(1) }),
]);
export type OutboxOp = z.infer<typeof outboxOpSchema>;

type AnnotationOp = WriteOp["annotations"][number];

// the items a row changes: the overlay lays it over each, and a parked one holds their later rows
export const itemIdsOf = (op: OutboxOp): readonly string[] => {
  switch (op.kind) {
    case "write": {
      return [op.itemId];
    }
    case "create":
    case "saveLink":
    case "save":
    case "createFile": {
      return [op.input.id];
    }
    case "delete":
    case "restore": {
      return op.ids;
    }
    case "keep":
    case "folders": {
      return [];
    }
    // no default
  }
};

// a delete or a restore with the ids `gone` let go, null once it names nothing else
const withoutIds = (
  op: Extract<OutboxOp, { kind: "delete" | "restore" }>,
  gone: ReadonlySet<string>,
): OutboxOp | null => {
  const ids = op.ids.filter((id) => !gone.has(id));
  return ids.length === 0 ? null : { ...op, ids };
};

// a row's op once the make `from` folded onto the item `to`. A write is the person's words, which go
// on to `to`. A delete or a restore named the card, which the fold took away already, and asks
// nothing of `to`, an older item with notes of its own: it lets `from` go, and is null once it names
// nothing else
export const repointedOp = (op: OutboxOp, from: string, to: string): OutboxOp | null => {
  switch (op.kind) {
    case "write": {
      return op.itemId === from ? { ...op, itemId: to } : op;
    }
    case "delete":
    case "restore": {
      return withoutIds(op, new Set([from]));
    }
    case "create":
    case "saveLink":
    case "save":
    case "createFile":
    case "keep":
    case "folders": {
      return op;
    }
    // no default
  }
};

// the item a row makes, which the cell holds nothing of until it lands
export const itemsMadeBy = (op: OutboxOp): readonly string[] =>
  "input" in op ? [op.input.id] : [];

// the folders a row makes, which the cell holds nothing of until it lands
export const foldersMadeBy = (op: OutboxOp): readonly string[] =>
  op.kind === "folders"
    ? op.ops.flatMap((folder) => (folder.op === "create" ? [folder.id] : []))
    : [];

// the folders a row files something in
export const foldersFiledIn = (op: OutboxOp): readonly string[] => {
  switch (op.kind) {
    case "write": {
      return op.ops.flatMap((libraryOp) =>
        libraryOp.op === "set" && libraryOp.field === "folderId" && libraryOp.value !== null
          ? [libraryOp.value]
          : [],
      );
    }
    case "create":
    case "save":
    case "createFile": {
      return op.input.folderId === null ? [] : [op.input.folderId];
    }
    case "saveLink": {
      return op.input.folder === null ? [] : [op.input.folder.id];
    }
    case "folders": {
      return op.ops.flatMap((folder) =>
        (folder.op === "create" || folder.op === "move") && folder.parentId !== null
          ? [folder.parentId]
          : [],
      );
    }
    case "keep":
    case "delete":
    case "restore": {
      return [];
    }
    // no default
  }
};

export const stagedOf = (op: OutboxOp): readonly StagedFile[] =>
  op.kind === "write" ||
  op.kind === "create" ||
  op.kind === "save" ||
  op.kind === "createFile" ||
  op.kind === "keep"
    ? op.staged
    : [];

// the files the blocks a write puts or inserts, or a note it makes, name by their bytes
export const shasNamed = (op: OutboxOp): ReadonlySet<string> => {
  const shas = new Set<string>();
  if (op.kind === "write") {
    for (const libraryOp of op.ops) {
      if (libraryOp.op === "put" || libraryOp.op === "insert") {
        collectFileShas(libraryOp.block, shas);
      }
    }
  }
  if (op.kind === "create") {
    for (const { block } of op.input.blocks) {
      collectFileShas(block, shas);
    }
  }
  return shas;
};

// ---- compaction ----

type BlockOp = Extract<LibraryOp, { op: "insert" | "put" | "drop" | "move" }>;
type FieldOp = Exclude<LibraryOp, BlockOp>;

const isBlockOp = (op: LibraryOp): op is BlockOp =>
  op.op === "insert" || op.op === "put" || op.op === "drop" || op.op === "move";

const blockIdOf = (op: BlockOp): string =>
  op.op === "insert" || op.op === "put" ? op.block.id : op.blockId;

type InsertOp = Extract<BlockOp, { op: "insert" }>;

// where a run of one block's ops has got to: the insert that made it, the first bases its put or
// drop and its move named, and what it holds now
interface BlockRun {
  readonly inserted: InsertOp | null;
  readonly firstHash: string | null;
  readonly content: LibraryBlock | null;
  readonly firstOrd: string | null;
  readonly ord: string | null;
  readonly dropped: boolean;
}

const EMPTY_RUN: BlockRun = {
  content: null,
  dropped: false,
  firstHash: null,
  firstOrd: null,
  inserted: null,
  ord: null,
};

// the hash an op on the block meets once the run's earlier ops landed, null before any
const runHash = (run: BlockRun): string | null => {
  if (run.content !== null) {
    return blockHash(run.content);
  }
  return run.inserted === null ? null : blockHash(run.inserted.block);
};

// the run with one more op, or null where the op's base is not what the run left
const stepBlock = (run: BlockRun, op: BlockOp, index: number): BlockRun | null => {
  if (run.dropped) {
    return null;
  }
  switch (op.op) {
    case "insert": {
      return index === 0 ? { ...run, inserted: op } : null;
    }
    case "put":
    case "drop": {
      const held = runHash(run);
      if (held !== null && op.baseHash !== held) {
        return null;
      }
      const firstHash = run.firstHash ?? op.baseHash;
      return op.op === "put"
        ? { ...run, content: op.block, firstHash }
        : { ...run, dropped: true, firstHash };
    }
    case "move": {
      const held = run.ord ?? run.inserted?.ord ?? null;
      if (held !== null && op.baseOrd !== held) {
        return null;
      }
      return { ...run, firstOrd: run.firstOrd ?? op.baseOrd, ord: op.ord };
    }
    // no default
  }
};

// what a whole run lands as, on the first bases
const runOps = (blockId: string, run: BlockRun): BlockOp[] => {
  const { inserted } = run;
  if (inserted !== null) {
    return run.dropped
      ? []
      : [
          {
            block: run.content ?? inserted.block,
            op: "insert",
            ord: run.ord ?? inserted.ord,
            section: inserted.section,
          },
        ];
  }
  if (run.dropped) {
    return run.firstHash === null ? [] : [{ baseHash: run.firstHash, blockId, op: "drop" }];
  }
  const ops: BlockOp[] = [];
  if (run.content !== null && run.firstHash !== null && blockHash(run.content) !== run.firstHash) {
    ops.push({ baseHash: run.firstHash, block: run.content, op: "put" });
  }
  if (run.ord !== null && run.firstOrd !== null && run.ord !== run.firstOrd) {
    ops.push({ baseOrd: run.firstOrd, blockId, op: "move", ord: run.ord });
  }
  return ops;
};

// one block's ops as one: an insert that ends inserted, or a put and a move on the first bases,
// or a drop on the first base; null for a run whose bases do not follow each other (each op
// computed from the block as another op left it), which goes as it was written
const compactBlock = (blockId: string, ops: readonly BlockOp[]): readonly BlockOp[] | null => {
  let run: BlockRun | null = EMPTY_RUN;
  for (const [index, op] of ops.entries()) {
    run = run === null ? null : stepBlock(run, op, index);
  }
  return run === null ? null : runOps(blockId, run);
};

// whether each op of one field's run was computed from the value the op before it wrote
const followsOn = (before: FieldOp, op: FieldOp): boolean => {
  switch (op.op) {
    case "set": {
      return before.op === "set" && op.base === before.value;
    }
    case "tags":
    case "aliases": {
      return before.op === op.op && sameList(op.base, before.value);
    }
    case "property": {
      return before.op === "property" && sameOptionalJson(op.base, before.value);
    }
    // no default
  }
};

// the run from its first op's base to its last op's value: none when that is no change
const spanOf = (first: FieldOp, last: FieldOp): FieldOp[] => {
  switch (last.op) {
    case "set": {
      if (first.op !== "set" || first.base === last.value) {
        return [];
      }
      const span = libraryOpSchema.safeParse({ ...last, base: first.base });
      return span.success && span.data.op === "set" ? [span.data] : [];
    }
    case "tags":
    case "aliases": {
      return first.op === last.op && !sameList(first.base, last.value)
        ? [{ ...last, base: first.base }]
        : [];
    }
    case "property": {
      if (first.op !== "property" || sameOptionalJson(first.base, last.value)) {
        return [];
      }
      const { base, ...rest } = first;
      return [base === undefined ? { ...rest, value: last.value } : { ...last, base }];
    }
    // no default
  }
};

// one field's ops as one, from the first base to the last value; null for a run whose bases do
// not follow its values, which goes as it was written
const compactField = (ops: readonly FieldOp[]): readonly FieldOp[] | null => {
  const [first] = ops;
  const last = ops.at(-1);
  if (first === undefined || last === undefined) {
    return [];
  }
  const follows = ops.every((op, index) => {
    const before = ops[index - 1];
    return before === undefined || followsOn(before, op);
  });
  return follows ? spanOf(first, last) : null;
};

const fieldKeyOf = (op: FieldOp): string => {
  switch (op.op) {
    case "set": {
      return `set:${op.field}`;
    }
    case "tags":
    case "aliases": {
      return op.op;
    }
    case "property": {
      return `property:${op.key}`;
    }
    // no default
  }
};

// grouped by what each op changes, in the order each first appears: ops on two blocks or two fields
// never meet, so the groups' order is free and each group's own order is kept
const groupsOf = <T, K>(items: readonly T[], keyOf: (item: T) => K): Map<K, T[]> => {
  const groups = new Map<K, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  return groups;
};

// a batch computed op by op, each against the item as the ones before it left it, as one batch
// that lands the same: the fewest ops on the first bases
/** @internal */
export const compactOps = (ops: readonly LibraryOp[]): LibraryOp[] => {
  const blocks = groupsOf(ops.filter(isBlockOp), blockIdOf);
  const fields = groupsOf(
    ops.filter((op): op is FieldOp => !isBlockOp(op)),
    fieldKeyOf,
  );
  return [
    ...[...blocks].flatMap(([blockId, group]) => compactBlock(blockId, group) ?? group),
    ...[...fields.values()].flatMap((group) => compactField(group) ?? group),
  ];
};

type AnnotationAdd = Extract<AnnotationOp, { op: "add" }>;

// one highlight's ops as one: an add carrying its last note, a note from the first base to the
// last text, a removal on the first base; null for a run whose bases do not follow its texts
const compactAnnotation = (ops: readonly AnnotationOp[]): readonly AnnotationOp[] | null => {
  let added: AnnotationAdd | null = null;
  let firstBase: string | null = null;
  let text: string | null = null;
  let removed = false;
  for (const [index, op] of ops.entries()) {
    if (removed) {
      return null;
    }
    switch (op.op) {
      case "add": {
        if (index !== 0) {
          return null;
        }
        added = op;
        ({ text } = op);
        break;
      }
      case "note":
      case "remove": {
        if (text !== null && op.base !== text) {
          return null;
        }
        firstBase ??= op.base;
        if (op.op === "note") {
          ({ text } = op);
        } else {
          removed = true;
        }
        break;
      }
      // no default
    }
  }
  if (added !== null) {
    return removed ? [] : [{ ...added, text: text ?? added.text }];
  }
  if (firstBase === null) {
    return [];
  }
  const id = ops[0]?.id ?? "";
  if (removed) {
    return [{ base: firstBase, id, op: "remove" }];
  }
  return text === null || text === firstBase ? [] : [{ base: firstBase, id, op: "note", text }];
};

/** @internal */
export const compactAnnotations = (ops: readonly AnnotationOp[]): AnnotationOp[] =>
  [...groupsOf(ops, (op) => op.id).values()].flatMap((group) => compactAnnotation(group) ?? group);

// a later write to an item while the row before it still waits to go: one batch on the first
// bases, keeping the first base block each put named
export const coalesceWrites = (queued: WriteOp, next: WriteOp): WriteOp => ({
  annotations: compactAnnotations([...queued.annotations, ...next.annotations]),
  bases: { ...next.bases, ...queued.bases },
  itemId: queued.itemId,
  kind: "write",
  ops: compactOps([...queued.ops, ...next.ops]),
  staged: [
    ...queued.staged,
    ...next.staged.filter((file) => !queued.staged.some((held) => held.sha === file.sha)),
  ],
});

// a row's op once the folders and the items `gone` will never exist: what it files there lands
// unfiled, an op on one of them goes, and null is a row left asking nothing
export const unmadeOp = (op: OutboxOp, gone: ReadonlySet<string>): OutboxOp | null => {
  const standing = (id: string | null): string | null => (id !== null && gone.has(id) ? null : id);
  switch (op.kind) {
    case "write": {
      if (gone.has(op.itemId)) {
        return null;
      }
      const ops = compactOps(
        op.ops.map((libraryOp) =>
          libraryOp.op === "set" && libraryOp.field === "folderId"
            ? { ...libraryOp, value: standing(libraryOp.value) }
            : libraryOp,
        ),
      );
      return ops.length === 0 && op.annotations.length === 0 ? null : { ...op, ops };
    }
    case "create": {
      return { ...op, input: { ...op.input, folderId: standing(op.input.folderId) } };
    }
    case "save": {
      return { ...op, input: { ...op.input, folderId: standing(op.input.folderId) } };
    }
    case "createFile": {
      return { ...op, input: { ...op.input, folderId: standing(op.input.folderId) } };
    }
    case "saveLink": {
      const { folder } = op.input;
      return folder !== null && gone.has(folder.id)
        ? { ...op, input: { ...op.input, folder: null } }
        : op;
    }
    case "folders": {
      const ops = op.ops
        .filter((folder) => !gone.has(folder.id))
        .map((folder) =>
          folder.op === "create" || folder.op === "move"
            ? { ...folder, parentId: standing(folder.parentId) }
            : folder,
        );
      return ops.length === 0 ? null : { ...op, ops };
    }
    case "delete":
    case "restore": {
      return withoutIds(op, gone);
    }
    case "keep": {
      return op;
    }
    // no default
  }
};

// the base block a write's ops were computed from, for each block a put or a drop names
export const basesOf = (
  ops: readonly LibraryOp[],
  held: ReadonlyMap<string, StoredBlock>,
): WriteOp["bases"] => {
  const bases: WriteOp["bases"] = {};
  for (const op of ops) {
    if (op.op !== "put" && op.op !== "drop") {
      continue;
    }
    const id = op.op === "put" ? op.block.id : op.blockId;
    const base = held.get(id);
    if (base !== undefined) {
      bases[id] = base;
    }
  }
  return bases;
};
