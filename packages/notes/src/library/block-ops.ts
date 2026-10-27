// What a write is: ops over one item's blocks and fields, each naming the base it was computed
// from. The guard lands an op only where its base still holds, so two writers touching different
// blocks or fields never meet, and one whose base moved meets the block or value as it is now.
// The cell applies a batch whole or answers every conflict; a device's outbox rebases its queued
// ops over what landed, dropping the ones already true and keeping the rest for its merge.

import { z } from "zod";

import { BLOCK_HASH_RE, blockHash } from "./block-hash";
import { compareBlockPlaces, ordSchema } from "./block-order";
import { sameJson } from "./canonical-json";
import type { JsonValue } from "./canonical-json";
import { libraryItemFieldsSchema, propertyKeySchema } from "./library-item";
import type { LibraryItemField, LibraryItemFields, PropertyValue } from "./library-item";
import { blockIdSchema, librarySectionSchema, storableBlockSchema } from "./library-nodes";
import type { LibraryBlock, LibrarySection } from "./library-nodes";

export interface StoredBlock {
  readonly block: LibraryBlock;
  readonly hash: string;
  readonly ord: string;
  readonly section: LibrarySection;
}

export interface ItemState {
  readonly fields: LibraryItemFields;
  readonly blocks: ReadonlyMap<string, StoredBlock>;
}

// an item's blocks in reading order: note before article, then by order key
export const orderedBlocks = (blocks: ReadonlyMap<string, StoredBlock>): StoredBlock[] =>
  [...blocks.values()].toSorted((a, b) =>
    compareBlockPlaces(
      { blockId: a.block.id, ord: a.ord, section: a.section },
      { blockId: b.block.id, ord: b.ord, section: b.section },
    ),
  );

export const blockHashSchema = z.string().regex(BLOCK_HASH_RE);

const insertOpSchema = z.strictObject({
  block: storableBlockSchema,
  op: z.literal("insert"),
  ord: ordSchema,
  section: librarySectionSchema,
});

const putOpSchema = z.strictObject({
  baseHash: blockHashSchema,
  block: storableBlockSchema,
  op: z.literal("put"),
});

const dropOpSchema = z.strictObject({
  baseHash: blockHashSchema,
  blockId: blockIdSchema,
  op: z.literal("drop"),
});

const moveOpSchema = z.strictObject({
  baseOrd: ordSchema,
  blockId: blockIdSchema,
  op: z.literal("move"),
  ord: ordSchema,
});

const FIELDS = libraryItemFieldsSchema.shape;

type ScalarField = Exclude<keyof LibraryItemFields, "aliases" | "properties" | "tags">;

const setOf = <F extends ScalarField>(field: F) =>
  z.strictObject({
    base: FIELDS[field],
    field: z.literal(field),
    op: z.literal("set"),
    value: FIELDS[field],
  });

// one variant per field, so a patch's values are its field's own type
const setOpSchema = z.discriminatedUnion("field", [
  setOf("author"),
  setOf("copySha"),
  setOf("coverSha"),
  setOf("deletedAt"),
  setOf("description"),
  setOf("fetchError"),
  setOf("fetchState"),
  setOf("fetchedAt"),
  setOf("folderId"),
  setOf("kind"),
  setOf("lang"),
  setOf("originalSha"),
  setOf("pinnedAt"),
  setOf("published"),
  setOf("savedAt"),
  setOf("site"),
  setOf("title"),
  setOf("url"),
]);

// a list field merges as a set: what the writer added goes in, what it took out goes, and what
// anyone else did since stays, so two devices tagging one item at once both land
const tagsOpSchema = z.strictObject({
  base: FIELDS.tags,
  op: z.literal("tags"),
  value: FIELDS.tags,
});
const aliasesOpSchema = z.strictObject({
  base: FIELDS.aliases,
  op: z.literal("aliases"),
  value: FIELDS.aliases,
});

// one property by its key; a missing base or value is the property absent. The value's size is
// the item's to hold: the fields are checked whole once a batch lands
const propertyOpSchema = z.strictObject({
  base: z.json().optional(),
  key: propertyKeySchema,
  op: z.literal("property"),
  value: z.json().optional(),
});

export const libraryOpSchema = z.discriminatedUnion("op", [
  insertOpSchema,
  putOpSchema,
  dropOpSchema,
  moveOpSchema,
  setOpSchema,
  tagsOpSchema,
  aliasesOpSchema,
  propertyOpSchema,
]);
export type LibraryOp = z.infer<typeof libraryOpSchema>;

// what an op met instead of its base; a conflict on a list field cannot happen
type OpConflict =
  | { readonly kind: "block"; readonly blockId: string; readonly current: StoredBlock | null }
  | { readonly kind: "order"; readonly blockId: string; readonly currentOrd: string }
  | { readonly kind: "field"; readonly field: ScalarField; readonly current: JsonValue }
  | { readonly kind: "property"; readonly key: string; readonly current: JsonValue | undefined };

// `satisfied`: what the op would make is already there (a resend after a lost answer, or two
// writers doing the same thing), so landing it changes nothing
type Verdict = { readonly kind: "apply" } | { readonly kind: "satisfied" } | OpVerdictConflict;

interface OpVerdictConflict {
  readonly kind: "conflict";
  readonly conflict: OpConflict;
}

const APPLY: Verdict = { kind: "apply" };
const SATISFIED: Verdict = { kind: "satisfied" };

const conflictOf = (conflict: OpConflict): Verdict => ({ conflict, kind: "conflict" });

const listKey = (op: "aliases" | "tags") => (entry: string) =>
  op === "tags" ? entry.toLowerCase() : entry;

// three-way over a list kept as a set: `current`, less what `base` had and `value` dropped, plus
// what `value` added, in the order it added them
export const mergeListField = (
  op: "aliases" | "tags",
  current: readonly string[],
  base: readonly string[],
  value: readonly string[],
): string[] => {
  const keyOf = listKey(op);
  const kept = new Set(value.map(keyOf));
  const had = new Set(base.map(keyOf));
  const removed = new Set([...had].filter((key) => !kept.has(key)));
  const merged = current.filter((entry) => !removed.has(keyOf(entry)));
  const present = new Set(merged.map(keyOf));
  for (const entry of value) {
    const key = keyOf(entry);
    if (!had.has(key) && !present.has(key)) {
      merged.push(entry);
      present.add(key);
    }
  }
  return merged;
};

const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((entry, index) => entry === b[index]);

const propertyAt = (fields: LibraryItemFields, key: string): JsonValue | undefined =>
  Object.hasOwn(fields.properties, key) ? fields.properties[key] : undefined;

const sameOptionalJson = (a: JsonValue | undefined, b: JsonValue | undefined): boolean =>
  a === undefined || b === undefined ? a === b : sameJson(a, b);

type BlockOp = Extract<LibraryOp, { op: "insert" | "put" | "drop" | "move" }>;
type FieldOp = Exclude<LibraryOp, BlockOp>;

const blockVerdict = (state: ItemState, op: BlockOp): Verdict => {
  switch (op.op) {
    case "insert": {
      const held = state.blocks.get(op.block.id);
      if (held === undefined) {
        return APPLY;
      }
      return held.hash === blockHash(op.block)
        ? SATISFIED
        : conflictOf({ blockId: op.block.id, current: held, kind: "block" });
    }
    case "put": {
      const held = state.blocks.get(op.block.id);
      if (held?.hash === op.baseHash) {
        return APPLY;
      }
      return held?.hash === blockHash(op.block)
        ? SATISFIED
        : conflictOf({ blockId: op.block.id, current: held ?? null, kind: "block" });
    }
    case "drop": {
      const held = state.blocks.get(op.blockId);
      if (held === undefined) {
        return SATISFIED;
      }
      return held.hash === op.baseHash
        ? APPLY
        : conflictOf({ blockId: op.blockId, current: held, kind: "block" });
    }
    case "move": {
      const held = state.blocks.get(op.blockId);
      // a block someone dropped needs no place
      if (held === undefined || held.ord === op.ord) {
        return SATISFIED;
      }
      return held.ord === op.baseOrd
        ? APPLY
        : conflictOf({ blockId: op.blockId, currentOrd: held.ord, kind: "order" });
    }
    // no default
  }
};

const fieldVerdict = (fields: LibraryItemFields, op: FieldOp): Verdict => {
  switch (op.op) {
    case "set": {
      const current = fields[op.field];
      if (current === op.base) {
        return APPLY;
      }
      return current === op.value
        ? SATISFIED
        : conflictOf({ current, field: op.field, kind: "field" });
    }
    case "tags":
    case "aliases": {
      const current = fields[op.op];
      return sameList(mergeListField(op.op, current, op.base, op.value), current)
        ? SATISFIED
        : APPLY;
    }
    case "property": {
      const current = propertyAt(fields, op.key);
      if (sameOptionalJson(current, op.base)) {
        return APPLY;
      }
      return sameOptionalJson(current, op.value)
        ? SATISFIED
        : conflictOf({ current, key: op.key, kind: "property" });
    }
    // no default
  }
};

const isBlockOp = (op: LibraryOp): op is BlockOp =>
  op.op === "insert" || op.op === "put" || op.op === "drop" || op.op === "move";

const verdictOf = (state: ItemState, op: LibraryOp): Verdict =>
  isBlockOp(op) ? blockVerdict(state, op) : fieldVerdict(state.fields, op);

const withField = <F extends ScalarField>(
  fields: LibraryItemFields,
  field: F,
  value: LibraryItemFields[F],
): LibraryItemFields => ({ ...fields, [field]: value });

const withProperty = (
  fields: LibraryItemFields,
  key: string,
  value: PropertyValue | undefined,
): LibraryItemFields => {
  const properties = Object.fromEntries(
    Object.entries(fields.properties).filter(([name]) => name !== key),
  );
  if (value !== undefined) {
    properties[key] = value;
  }
  return { ...fields, properties };
};

const withBlocks = (
  state: ItemState,
  change: (blocks: Map<string, StoredBlock>) => void,
): ItemState => {
  const blocks = new Map(state.blocks);
  change(blocks);
  return { blocks, fields: state.fields };
};

// the item with one op landed, whose guard already passed
const landOp = (state: ItemState, op: LibraryOp): ItemState => {
  switch (op.op) {
    case "insert": {
      return withBlocks(state, (blocks) => {
        blocks.set(op.block.id, {
          block: op.block,
          hash: blockHash(op.block),
          ord: op.ord,
          section: op.section,
        });
      });
    }
    case "put": {
      return withBlocks(state, (blocks) => {
        const held = blocks.get(op.block.id);
        if (held !== undefined) {
          blocks.set(op.block.id, { ...held, block: op.block, hash: blockHash(op.block) });
        }
      });
    }
    case "drop": {
      return withBlocks(state, (blocks) => {
        blocks.delete(op.blockId);
      });
    }
    case "move": {
      return withBlocks(state, (blocks) => {
        const held = blocks.get(op.blockId);
        if (held !== undefined) {
          blocks.set(op.blockId, { ...held, ord: op.ord });
        }
      });
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
      return { blocks: state.blocks, fields: withProperty(state.fields, op.key, op.value) };
    }
    // no default
  }
};

// the blocks and fields a batch changed, so a writer stores those rows and no others
interface OpTouches {
  readonly blocks: ReadonlySet<string>;
  readonly dropped: ReadonlySet<string>;
  readonly fields: boolean;
}

// `invalid`: every op's guard held, but the fields they leave break the item's own caps (a list
// merged past its length or bytes, the properties past theirs), since each op is checked alone;
// it names those fields, and the cell answers it as too large
export type ApplyOutcome =
  | { readonly kind: "applied"; readonly state: ItemState; readonly touched: OpTouches }
  | { readonly kind: "conflict"; readonly conflicts: readonly OpConflict[] }
  | { readonly kind: "invalid"; readonly fields: readonly LibraryItemField[] };

const touchedBy = (op: LibraryOp): { block: string } | { dropped: string } | "fields" => {
  switch (op.op) {
    case "insert":
    case "put": {
      return { block: op.block.id };
    }
    case "move": {
      return { block: op.blockId };
    }
    case "drop": {
      return { dropped: op.blockId };
    }
    case "set":
    case "tags":
    case "aliases":
    case "property": {
      return "fields";
    }
    // no default
  }
};

const fieldNameSchema = libraryItemFieldsSchema.keyof();

// the fields an item's caps refuse, by name; none when the fields hold
const refusedFields = (fields: LibraryItemFields): LibraryItemField[] => {
  const parsed = libraryItemFieldsSchema.safeParse(fields);
  if (parsed.success) {
    return [];
  }
  const names = new Set<LibraryItemField>();
  for (const issue of parsed.error.issues) {
    const name = fieldNameSchema.safeParse(issue.path[0]);
    if (name.success) {
      names.add(name.data);
    }
  }
  return [...names].toSorted();
};

// every op in order, each against the item as the ones before it left it; one conflict lands
// none, and the answer names every op that met one, and a batch whose fields break a cap lands
// none either
export const applyOps = (state: ItemState, ops: readonly LibraryOp[]): ApplyOutcome => {
  let next = state;
  const conflicts: OpConflict[] = [];
  const blocks = new Set<string>();
  const dropped = new Set<string>();
  let fields = false;
  for (const op of ops) {
    const verdict = verdictOf(next, op);
    if (verdict.kind === "conflict") {
      conflicts.push(verdict.conflict);
      continue;
    }
    if (verdict.kind === "satisfied") {
      continue;
    }
    next = landOp(next, op);
    const touch = touchedBy(op);
    if (touch === "fields") {
      fields = true;
    } else if ("block" in touch) {
      blocks.add(touch.block);
      dropped.delete(touch.block);
    } else {
      dropped.add(touch.dropped);
      blocks.delete(touch.dropped);
    }
  }
  if (conflicts.length > 0) {
    return { conflicts, kind: "conflict" };
  }
  const refused = fields ? refusedFields(next.fields) : [];
  if (refused.length > 0) {
    return { fields: refused, kind: "invalid" };
  }
  return { kind: "applied", state: next, touched: { blocks, dropped, fields } };
};

interface RebasedOp {
  readonly op: LibraryOp;
  readonly conflict: OpConflict;
}

export interface Rebase {
  // what still applies over `current`, in order (the cell may yet refuse a batch past a cap); a
  // list field's base is moved to what it holds now
  readonly ops: readonly LibraryOp[];
  // what needs the writer's merge before it goes again
  readonly conflicts: readonly RebasedOp[];
}

// a queued batch over the item as it landed since: ops already true go, ops whose base still
// holds stay, and the rest come back with what they met
export const rebaseOps = (current: ItemState, ops: readonly LibraryOp[]): Rebase => {
  let next = current;
  const kept: LibraryOp[] = [];
  const conflicts: RebasedOp[] = [];
  for (const op of ops) {
    const verdict = verdictOf(next, op);
    if (verdict.kind === "conflict") {
      conflicts.push({ conflict: verdict.conflict, op });
      continue;
    }
    if (verdict.kind === "satisfied") {
      continue;
    }
    const rebased =
      op.op === "tags" || op.op === "aliases"
        ? {
            ...op,
            base: next.fields[op.op],
            value: mergeListField(op.op, next.fields[op.op], op.base, op.value),
          }
        : op;
    kept.push(rebased);
    next = landOp(next, rebased);
  }
  return { conflicts, ops: kept };
};
