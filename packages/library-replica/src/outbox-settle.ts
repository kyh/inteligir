// A write the cell answered CONFLICT, settled against what it met and sent again. One write policy
// (`AGENTS.md` § Across workspaces): every op names its base, and each one the cell found moved
// is computed again over the current: a block both sides changed goes through the injected merge
// (the editor's diff3 over each side's markdown), a block another device dropped stands again
// with this device's text, a drop of a block another device changed yields to that change, and a
// place or a field is set over the value it met. An op whose result the cell already
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
import type { z } from "zod";

import type { WriteOp } from "./outbox-ops";
import type { BlockMerge } from "./replica-ports";

type ConflictCurrent = z.infer<typeof conflictCurrentSchema>;
type FolderOp = z.infer<typeof folderOpSchema>;

type BlockCurrent = Extract<ConflictCurrent, { kind: "block" }>;
type FolderCurrent = Extract<ConflictCurrent, { kind: "folder" }>;

export type Settled<T> =
  | { readonly kind: "resend"; readonly op: T }
  | { readonly kind: "satisfied" };

// a folder write settled: `refused` where the cell would answer it the same until another folder
// changes, which only the person can bring about
type SettledFolders = Settled<FolderOp[]> | { readonly kind: "refused"; readonly reason: string };

const FOLDER_NAME_HELD =
  "A folder here already has this name. Rename that one and try again, or let this change go.";
const FOLDER_PLACE_REFUSED = "This folder can't go there.";

// a write settled: `overlapped` where a block both sides changed kept this device's lines over the
// other device's change to the same ones
export type SettledWrite =
  | { readonly kind: "resend"; readonly op: WriteOp; readonly overlapped: boolean }
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
}

const metOf = (currents: readonly ConflictCurrent[]): Met => {
  const met: Met = {
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

interface BlockSettle {
  readonly ops: LibraryOp[];
  readonly bases: WriteOp["bases"];
  // a merge kept this device's lines where the other device changed the same ones
  overlapped: boolean;
}

// a put the cell met another block for: merged three ways over the current one, or, where another
// device dropped it, standing again where its base stood
const settlePut = async (
  op: Extract<LibraryOp, { op: "put" }>,
  met: BlockCurrent,
  write: WriteOp,
  context: { readonly merge: BlockMerge; readonly moves: ReadonlyMap<string, string> },
  out: BlockSettle,
): Promise<void> => {
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
      ? { block: op.block, overlapped: false }
      : await context.merge({ base: base.block, mine: op.block, theirs: current.block });
  const block = merged.block.id === id ? merged.block : op.block;
  out.overlapped ||= merged.overlapped;
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

const settleLibraryOp = async (
  op: LibraryOp,
  met: Met,
  write: WriteOp,
  context: { readonly merge: BlockMerge; readonly moves: ReadonlyMap<string, string> },
  out: BlockSettle,
): Promise<void> => {
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
      await settlePut(op, current, write, context, out);
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

export const settleWrite = async (
  write: WriteOp,
  currents: readonly ConflictCurrent[],
  ports: { readonly merge: BlockMerge },
): Promise<SettledWrite> => {
  const met = metOf(currents);
  const moves = new Map(
    write.ops.flatMap((op) => (op.op === "move" ? [[op.blockId, op.ord] as const] : [])),
  );
  const out: BlockSettle = { bases: {}, ops: [], overlapped: false };
  // one block at a time, in the write's order: a merge may be a round trip to the host's editor
  for (const op of write.ops) {
    await settleLibraryOp(op, met, write, { merge: ports.merge, moves }, out);
  }
  if (out.ops.length === 0) {
    return { kind: "satisfied" };
  }
  return {
    kind: "resend",
    op: {
      bases: out.bases,
      itemId: write.itemId,
      kind: "write",
      ops: out.ops,
      staged: write.staged,
    },
    overlapped: out.overlapped,
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
      return row?.deletedAt !== null || row.name === op.name ? null : { ...op, base: row.name };
    }
    case "move": {
      if (row?.deletedAt !== null) {
        return null;
      }
      return row.parentId === op.parentId && row.sort === op.sort
        ? null
        : { ...op, baseParentId: row.parentId };
    }
    case "delete": {
      return row?.deletedAt === null ? op : null;
    }
    // no default
  }
};

// a folder write the cell met other folders for: each op computed again over the folder it met.
// One that comes out as it went met what no base can answer: the sibling holding its name, or, for
// a move, a place under the folder itself
export const settleFolders = (
  ops: readonly FolderOp[],
  currents: readonly ConflictCurrent[],
): SettledFolders => {
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
  if (settled.length === 0) {
    return { kind: "satisfied" };
  }
  if (sameJson(settled, ops)) {
    const moved = ops.some((op) => op.op === "move");
    return { kind: "refused", reason: moved ? FOLDER_PLACE_REFUSED : FOLDER_NAME_HELD };
  }
  return { kind: "resend", op: settled };
};
