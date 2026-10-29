// A write the cell answered CONFLICT, settled against what it met and sent again. One write policy
// (`AGENTS.md` § Across workspaces): every op names its base, and each one the cell found moved
// is computed again over the current: a block both sides changed goes through the injected merge
// (the editor's diff3 over each side's markdown), a block another device dropped stands again
// with this device's text, a drop of a block another device changed yields to that change, a
// place, a field or a note is set over the value it met. An op whose result the cell already
// holds is satisfied and goes no more, so a resend after a lost answer that meets this device's
// own write lands nothing twice.

import type {
  conflictCurrentSchema,
  folderOpSchema,
} from "@repo/contract/cloud/library/library-wire";
import { blockHash } from "@repo/notes/library/block-hash";
import { libraryOpSchema } from "@repo/notes/library/block-ops";
import type { LibraryOp } from "@repo/notes/library/block-ops";
import { sameJson } from "@repo/notes/library/canonical-json";
import type { JsonValue } from "@repo/notes/library/canonical-json";
import { storableBlockSchema } from "@repo/notes/library/library-nodes";
import type { LibraryBlock } from "@repo/notes/library/library-nodes";
import { z } from "zod";

import type { WriteOp } from "./outbox-ops";
import type { BlockMerge, NewId } from "./replica-ports";

type ConflictCurrent = z.infer<typeof conflictCurrentSchema>;
type FolderOp = z.infer<typeof folderOpSchema>;
type AnnotationOp = WriteOp["annotations"][number];

type BlockCurrent = Extract<ConflictCurrent, { kind: "block" }>;
type AnnotationCurrent = Extract<ConflictCurrent, { kind: "annotation" }>;
type FolderCurrent = Extract<ConflictCurrent, { kind: "folder" }>;

export type Settled<T> =
  | { readonly kind: "resend"; readonly op: T }
  | { readonly kind: "satisfied" };

// what a conflict answer met, by what it names
interface Met {
  readonly blocks: Map<string, BlockCurrent>;
  readonly orders: Map<string, string>;
  readonly fields: Map<string, Extract<ConflictCurrent, { kind: "field" }>["current"]>;
  // a property's current value, `undefined` where the property is unset
  readonly properties: Map<
    string,
    { readonly current: Extract<ConflictCurrent, { kind: "property" }>["current"] }
  >;
  readonly annotations: Map<string, AnnotationCurrent>;
}

const metOf = (currents: readonly ConflictCurrent[]): Met => {
  const met: Met = {
    annotations: new Map(),
    blocks: new Map(),
    fields: new Map(),
    orders: new Map(),
    properties: new Map(),
  };
  for (const current of currents) {
    switch (current.kind) {
      case "block": {
        met.blocks.set(current.blockId, current);
        break;
      }
      case "order": {
        met.orders.set(current.blockId, current.currentOrd);
        break;
      }
      case "field": {
        met.fields.set(current.field, current.current);
        break;
      }
      case "property": {
        met.properties.set(current.key, { current: current.current });
        break;
      }
      case "annotation": {
        met.annotations.set(current.id, current);
        break;
      }
      case "folder":
      case "item": {
        break;
      }
      // no default
    }
  }
  return met;
};

const sameOptional = (a: JsonValue | undefined, b: JsonValue | undefined): boolean =>
  a === undefined || b === undefined ? a === b : sameJson(a, b);

interface JsonMap {
  readonly [key: string]: JsonValue | undefined;
}

const isJsonMap = (value: JsonValue): value is JsonMap =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const renamedIds = (ids: string, renames: ReadonlyMap<string, string>): string =>
  ids
    .split(",")
    .map((id) => renames.get(id) ?? id)
    .join(",");

// a block's JSON with each highlight id its markers name renamed where a settle gave it a new one
const renamedJson = (value: JsonValue, renames: ReadonlyMap<string, string>): JsonValue => {
  if (Array.isArray(value)) {
    return value.map((child) => renamedJson(child, renames));
  }
  if (!isJsonMap(value)) {
    return value;
  }
  const isMarker = value["type"] === "annotationMarker";
  const renamed: Record<string, JsonValue> = {};
  for (const [key, member] of Object.entries(value)) {
    if (member === undefined) {
      continue;
    }
    const markerIds = isMarker && key === "ids" ? z.string().safeParse(member) : null;
    renamed[key] =
      markerIds?.success === true
        ? renamedIds(markerIds.data, renames)
        : renamedJson(member, renames);
  }
  return renamed;
};

const renameMarkers = (block: LibraryBlock, renames: ReadonlyMap<string, string>): LibraryBlock =>
  renames.size === 0 ? block : storableBlockSchema.parse(renamedJson(block, renames));

interface BlockSettle {
  readonly ops: LibraryOp[];
  readonly bases: WriteOp["bases"];
}

// a put the cell met another block for: merged three ways over the current one, or, where another
// device dropped it, standing again where its base stood
const settlePut = (
  op: Extract<LibraryOp, { op: "put" }>,
  met: BlockCurrent,
  write: WriteOp,
  context: { readonly merge: BlockMerge; readonly moves: ReadonlyMap<string, string> },
  out: BlockSettle,
): void => {
  const { id } = op.block;
  const base = write.bases[id];
  const { current } = met;
  if (current === null) {
    if (base !== undefined) {
      out.ops.push({
        block: op.block,
        op: "insert",
        ord: context.moves.get(id) ?? base.ord,
        section: base.section,
      });
    }
    return;
  }
  const merged =
    base === undefined
      ? op.block
      : context.merge({ base: base.block, mine: op.block, theirs: current.block });
  const block = merged.id === id ? merged : op.block;
  if (blockHash(block) !== current.hash) {
    out.ops.push({ baseHash: current.hash, block, op: "put" });
    out.bases[id] = current;
  }
};

// a field or a property set over the value the cell met; null once it already holds this one
const settleField = (
  op: Extract<LibraryOp, { op: "set" | "property" }>,
  met: Met,
): LibraryOp | null => {
  if (op.op === "set") {
    if (!met.fields.has(op.field)) {
      return op;
    }
    const current = met.fields.get(op.field);
    if (current === undefined || sameOptional(current, op.value)) {
      return null;
    }
    const again = libraryOpSchema.safeParse({ ...op, base: current });
    return again.success ? again.data : null;
  }
  const property = met.properties.get(op.key);
  if (property === undefined) {
    return op;
  }
  if (sameOptional(property.current, op.value)) {
    return null;
  }
  const { base: _stale, ...rest } = op;
  return property.current === undefined ? rest : { ...rest, base: property.current };
};

const settleLibraryOp = (
  op: LibraryOp,
  met: Met,
  write: WriteOp,
  context: { readonly merge: BlockMerge; readonly moves: ReadonlyMap<string, string> },
  out: BlockSettle,
): void => {
  switch (op.op) {
    case "insert": {
      // the id is held: this device's insert landed once, or the cell holds another block there
      if (!met.blocks.has(op.block.id)) {
        out.ops.push(op);
      }
      return;
    }
    case "put": {
      const current = met.blocks.get(op.block.id);
      if (current === undefined) {
        out.ops.push(op);
        const base = write.bases[op.block.id];
        if (base !== undefined) {
          out.bases[op.block.id] = base;
        }
        return;
      }
      settlePut(op, current, write, context, out);
      return;
    }
    case "drop": {
      // a drop of a block another device changed yields to that change
      if (!met.blocks.has(op.blockId)) {
        out.ops.push(op);
      }
      return;
    }
    case "move": {
      const block = met.blocks.get(op.blockId);
      if (block !== undefined) {
        // another device changed the block a put of this write also met: gone, a put's insert
        // stands it again in this place; there, it moves from the place it holds now
        const { current } = block;
        if (current !== null && current.ord !== op.ord) {
          out.ops.push({ ...op, baseOrd: current.ord });
        }
        return;
      }
      const currentOrd = met.orders.get(op.blockId);
      if (currentOrd === undefined) {
        out.ops.push(op);
      } else if (currentOrd !== op.ord) {
        out.ops.push({ ...op, baseOrd: currentOrd });
      }
      return;
    }
    case "set":
    case "property": {
      const again = settleField(op, met);
      if (again !== null) {
        out.ops.push(again);
      }
      return;
    }
    case "tags":
    case "aliases": {
      out.ops.push(op);
      break;
    }
    // no default
  }
};

// a highlight the cell met another row for: an add whose id another item holds goes again under a
// new id, its markers renamed with it; an add the item already holds, a note of one gone, and a
// removal of one changed since are satisfied
const settleAnnotation = (
  op: AnnotationOp,
  met: Met,
  write: WriteOp,
  renames: Map<string, string>,
  newId: NewId,
): AnnotationOp | null => {
  switch (op.op) {
    case "add": {
      const parentId = op.parentId === null ? null : (renames.get(op.parentId) ?? op.parentId);
      if (op.parentId !== null && met.annotations.has(op.parentId)) {
        return null;
      }
      const current = met.annotations.get(op.id);
      if (current === undefined) {
        return { ...op, parentId };
      }
      if (current.current !== null && current.current.itemId !== write.itemId) {
        const id = newId();
        renames.set(op.id, id);
        return { ...op, id, parentId };
      }
      return null;
    }
    case "note": {
      const current = met.annotations.get(op.id);
      if (current === undefined) {
        return op;
      }
      const row = current.current;
      if (row === null || row.deletedAt !== null || row.text === op.text) {
        return null;
      }
      return { ...op, base: row.text };
    }
    case "remove": {
      return met.annotations.has(op.id) ? null : op;
    }
    // no default
  }
};

export const settleWrite = (
  write: WriteOp,
  currents: readonly ConflictCurrent[],
  ports: { readonly merge: BlockMerge; readonly newId: NewId },
): Settled<WriteOp> => {
  const met = metOf(currents);
  const moves = new Map(
    write.ops.flatMap((op) => (op.op === "move" ? [[op.blockId, op.ord] as const] : [])),
  );
  const out: BlockSettle = { bases: {}, ops: [] };
  for (const op of write.ops) {
    settleLibraryOp(op, met, write, { merge: ports.merge, moves }, out);
  }
  const renames = new Map<string, string>();
  const annotations = write.annotations.flatMap((op) => {
    const settled = settleAnnotation(op, met, write, renames, ports.newId);
    return settled === null ? [] : [settled];
  });
  if (out.ops.length === 0 && annotations.length === 0) {
    return { kind: "satisfied" };
  }
  const ops = out.ops.map((op): LibraryOp => {
    if (op.op === "insert" || op.op === "put") {
      return { ...op, block: renameMarkers(op.block, renames) };
    }
    return op;
  });
  return {
    kind: "resend",
    op: {
      annotations,
      bases: out.bases,
      itemId: write.itemId,
      kind: "write",
      ops,
      staged: write.staged,
    },
  };
};

const settleFolderOp = (op: FolderOp, met: ReadonlyMap<string, FolderCurrent>): FolderOp | null => {
  const current = met.get(op.id);
  if (current === undefined) {
    return op;
  }
  const row = current.current;
  switch (op.op) {
    case "create": {
      // the id is held: this device's create landed once
      return null;
    }
    case "rename": {
      return row === null || row.deletedAt !== null || row.name === op.name
        ? null
        : { ...op, base: row.name };
    }
    case "move": {
      if (row === null || row.deletedAt !== null) {
        return null;
      }
      return row.parentId === op.parentId && row.sort === op.sort
        ? null
        : { ...op, baseParentId: row.parentId };
    }
    case "delete": {
      return row === null || row.deletedAt !== null ? null : op;
    }
    // no default
  }
};

// a folder write the cell met other folders for: each op computed again over the folder it met
export const settleFolders = (
  ops: readonly FolderOp[],
  currents: readonly ConflictCurrent[],
): Settled<FolderOp[]> => {
  const met = new Map<string, FolderCurrent>();
  for (const current of currents) {
    if (current.kind === "folder") {
      met.set(current.id, current);
    }
  }
  const settled = ops.flatMap((op) => {
    const again = settleFolderOp(op, met);
    return again === null ? [] : [again];
  });
  return settled.length === 0 ? { kind: "satisfied" } : { kind: "resend", op: settled };
};
