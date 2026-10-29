// An item open in the editor by its id, over the replica every device runs: the editor's value is
// the item's blocks, each top-level element the block its id names, and the session keeps no copy
// of the value of its own. A pause in typing writes what changed since the blocks it last
// acknowledged (`item-diff.ts`) through the store, which queues it for the cell; a field patch
// writes at once. A change that lands from elsewhere is laid into the value with the editor's own
// transforms and outside its undo history: a block only one side changed takes that side, one
// both changed is merged three ways (`@repo/editor/stale-write`), and an edit outlives a drop
// either way round. A write the store refuses on a base that moved under it settles the same way
// and goes again. Construction is inert: nothing reads, subscribes or schedules until `start()`.

import { ElementApi, NodeApi, TextApi } from "platejs";
import type { Point, SlateEditor, TElement } from "platejs";

import { applyOps, libraryOpSchema, orderedBlocks } from "@repo/notes/library/block-ops";
import type { ItemState, LibraryOp, StoredBlock } from "@repo/notes/library/block-ops";
import type { LibraryItemFields } from "@repo/notes/library/library-item";
import type { LibraryBlock, LibraryNode } from "@repo/notes/library/library-nodes";

import { blockId } from "@repo/editor/node-props";
import { mergeBlocks } from "@repo/editor/stale-write";
import type { BlockSides } from "@repo/editor/stale-write";

import { diffValue, readElement } from "./item-diff";
import type { ElementReads } from "./item-diff";

export interface HeldItem {
  readonly fields: LibraryItemFields;
  // in reading order: the note, then the article
  readonly blocks: readonly StoredBlock[];
}

// a file a block names by its sha, kept until the write that names it is queued
export interface ItemFile {
  readonly sha: string;
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly mime: string;
}

export interface ItemWrite {
  readonly ops: readonly LibraryOp[];
  readonly files?: readonly { readonly bytes: Uint8Array<ArrayBuffer>; readonly mime: string }[];
}

export type ItemWriteOutcome =
  | { readonly kind: "queued" }
  | { readonly kind: "unchanged" }
  | { readonly kind: "missing" }
  // a base the write names no longer holds against the item as the store reads it now
  | { readonly kind: "changed"; readonly item: HeldItem }
  | { readonly kind: "invalid"; readonly fields: readonly string[] };

// the replica as the session reaches it: `@repo/library-replica`'s own item read, write and
// change feed, which a host hands over as they are
export interface ItemStore {
  readonly item: (itemId: string) => Promise<HeldItem | null>;
  readonly write: (itemId: string, input: ItemWrite) => Promise<ItemWriteOutcome>;
  readonly onChange: (
    listener: (change: { readonly ids: ReadonlySet<string>; readonly reset: boolean }) => void,
  ) => () => void;
}

export type FieldOp = Extract<LibraryOp, { op: "set" | "tags" | "aliases" | "property" }>;

export interface ItemSessionPorts {
  readonly store: ItemStore;
  // a timer the session cancels: the pause that writes
  readonly after: (ms: number, run: () => void) => () => void;
  readonly merge?: (sides: BlockSides) => LibraryBlock;
  readonly idleMs?: number;
}

export type ItemSessionStatus =
  | { readonly kind: "opening" }
  // the device holds no such item: it was deleted, or never reached this device
  | { readonly kind: "missing" }
  | {
      readonly kind: "open";
      // the item's fields with this session's patches laid over
      readonly fields: LibraryItemFields;
      // an edit the store has not queued yet
      readonly unsaved: boolean;
      // the blocks no write can store, which stay as they were last written
      readonly heldBack: number;
      // why the last write or landing failed, null once one went through
      readonly failure: string | null;
    };

export interface ItemSession {
  // reads the item into the editor and follows it
  readonly start: () => Promise<void>;
  // the editor's value moved: the host's change callback
  readonly edited: () => void;
  // writes what is unsaved now, as leaving the item does
  readonly flush: () => Promise<void>;
  readonly patch: (ops: readonly FieldOp[]) => Promise<void>;
  readonly stage: (file: ItemFile) => void;
  readonly status: () => ItemSessionStatus;
  readonly subscribe: (listener: () => void) => () => void;
  // writes what is unsaved and stops following the item, until it starts again
  readonly close: () => Promise<void>;
}

// the pause after the last keystroke that writes it
export const ITEM_IDLE_MS = 800;
// a write refused on a moved base is settled and sent again, this many times in one go
const SETTLE_TRIES = 3;

const isElement = (node: unknown): node is TElement => ElementApi.isElement(node);

const elementsOf = (editor: SlateEditor): TElement[] => editor.children.filter(isElement);

// a stored block as the element the editor holds
export const elementOf = (block: LibraryBlock): TElement => ({ ...block });

const stateOf = (item: HeldItem): ItemState => ({
  blocks: new Map(item.blocks.map((stored) => [stored.block.id, stored])),
  fields: item.fields,
});

const SHA_NODES = new Set(["img", "file", "video"]);

const shasIn = (node: LibraryNode, into: Set<string>): void => {
  if ("text" in node) {
    return;
  }
  if (SHA_NODES.has(node.type) && "sha" in node && node.sha !== undefined) {
    into.add(node.sha);
  }
  for (const child of node.children) {
    shasIn(child, into);
  }
};

// the shas the blocks a write puts or inserts name
const shasWritten = (ops: readonly LibraryOp[]): Set<string> => {
  const shas = new Set<string>();
  for (const op of ops) {
    if (op.op === "put" || op.op === "insert") {
      shasIn(op.block, shas);
    }
  }
  return shas;
};

const isFieldOp = (op: LibraryOp): op is FieldOp =>
  op.op === "set" || op.op === "tags" || op.op === "aliases" || op.op === "property";

// a field op over the value the item holds now, so the person's newest edit is the one that lands
const rebased = (op: FieldOp, fields: LibraryItemFields): FieldOp => {
  if (op.op === "tags" || op.op === "aliases") {
    return op;
  }
  if (op.op === "set") {
    const again = libraryOpSchema.safeParse({ ...op, base: fields[op.field] });
    return again.success && isFieldOp(again.data) ? again.data : op;
  }
  const current = Object.hasOwn(fields.properties, op.key) ? fields.properties[op.key] : undefined;
  const { base: _stale, ...rest } = op;
  return current === undefined ? rest : { ...rest, base: current };
};

const messageOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

// what a block's place in the editor becomes when an item lands under an open edit
type Decision =
  | { readonly kind: "keep" }
  | { readonly kind: "take"; readonly block: LibraryBlock }
  | { readonly kind: "remove" };

const KEEP: Decision = { kind: "keep" };

interface HeldPoint {
  readonly id: string;
  readonly point: Point;
}

interface ReadBlock {
  readonly block: LibraryBlock;
  readonly hash: string;
}

// what a landing is laid under: the blocks last acknowledged, the item as it landed, what this
// editor holds and which of its blocks it changed or moved since
interface Landing {
  readonly base: ItemState;
  readonly theirs: ItemState;
  readonly mine: ReadonlyMap<string, ReadBlock>;
  readonly touched: ReadonlySet<string>;
  readonly movedHere: ReadonlySet<string>;
  readonly merge: (sides: BlockSides) => LibraryBlock;
}

const landingOf = (
  base: ItemState,
  item: HeldItem,
  value: readonly TElement[],
  reads: ElementReads,
  merge: (sides: BlockSides) => LibraryBlock,
): Landing => {
  const touched = new Set<string>();
  const movedHere = new Set<string>();
  for (const op of diffValue(base.blocks, value, reads).ops) {
    if (op.op === "move") {
      movedHere.add(op.blockId);
    } else if (op.op === "drop") {
      touched.add(op.blockId);
    } else if (op.op === "put" || op.op === "insert") {
      touched.add(op.block.id);
    }
  }
  const mine = new Map<string, ReadBlock>();
  for (const element of value) {
    const read = readElement(element, reads);
    if (read.kind === "block" && !mine.has(read.block.id)) {
      mine.set(read.block.id, read);
    }
  }
  return { base, merge, mine, movedHere, theirs: stateOf(item), touched };
};

// a block only one side changed takes that side, one both changed is merged, and an edit outlives
// a drop either way round
const decide = (landing: Landing, id: string): Decision => {
  const was = landing.base.blocks.get(id);
  const now = landing.theirs.blocks.get(id);
  if (was?.hash === now?.hash) {
    return KEEP;
  }
  const ours = landing.mine.get(id);
  const changedHere = landing.touched.has(id);
  if (now === undefined) {
    return changedHere ? KEEP : { kind: "remove" };
  }
  if (ours?.hash === now.hash) {
    return KEEP;
  }
  if (!changedHere || ours === undefined || was === undefined) {
    return { block: now.block, kind: "take" };
  }
  return {
    block: landing.merge({ base: was.block, mine: ours.block, theirs: now.block }),
    kind: "take",
  };
};

// a block moved elsewhere that this editor did not move, taken out of its place to be put back
// where the item holds it
const movedThere = (
  landing: Landing,
  stored: StoredBlock,
  target: TElement[],
): TElement | undefined => {
  const was = landing.base.blocks.get(stored.block.id);
  if (was === undefined || was.ord === stored.ord || landing.movedHere.has(stored.block.id)) {
    return undefined;
  }
  const at = target.findIndex((one) => blockId(one) === stored.block.id);
  return at === -1 ? undefined : target.splice(at, 1)[0];
};

// a block the editor lacks that the landing gives back: one made elsewhere, or one this editor
// dropped that was edited elsewhere
const takenBack = (landing: Landing, id: string): TElement | undefined => {
  const decision = decide(landing, id);
  return decision.kind === "take" ? elementOf(decision.block) : undefined;
};

// the value the editor holds once the item lands: its own order, each block decided, then every
// block it lacks and every one moved elsewhere (and not here) placed after the block before it in
// the item's own order
const valueAfter = (landing: Landing, value: readonly TElement[]): TElement[] => {
  const target: TElement[] = [];
  for (const element of value) {
    const id = blockId(element);
    const decision = id === undefined ? KEEP : decide(landing, id);
    if (decision.kind === "keep") {
      target.push(element);
    } else if (decision.kind === "take") {
      target.push(elementOf(decision.block));
    }
  }
  const placed = new Set(target.flatMap((element) => blockId(element) ?? []));
  const order = orderedBlocks(landing.theirs.blocks);
  for (const [position, stored] of order.entries()) {
    const { id } = stored.block;
    const element = placed.has(id) ? movedThere(landing, stored, target) : takenBack(landing, id);
    if (element === undefined) {
      continue;
    }
    const before = order.slice(0, position).findLast((prior) => placed.has(prior.block.id));
    const at =
      before === undefined ? 0 : target.findIndex((one) => blockId(one) === before.block.id) + 1;
    target.splice(at, 0, element);
    placed.add(id);
  }
  return target;
};

export const createItemSession = (
  itemId: string,
  editor: SlateEditor,
  ports: ItemSessionPorts,
): ItemSession => {
  const merge = ports.merge ?? mergeBlocks;
  const idleMs = ports.idleMs ?? ITEM_IDLE_MS;
  const reads: ElementReads = new WeakMap();
  const listeners = new Set<() => void>();
  const files = new Map<string, ItemFile>();
  let acked: ItemState | null = null;
  let pendingFields: FieldOp[] = [];
  let heldBack = 0;
  let failure: string | null = null;
  let missing = false;
  let seen: SlateEditor["children"] | null = null;
  let cancelIdle: (() => void) | null = null;
  let unsubscribe: (() => void) | null = null;
  let following = false;
  let queue: Promise<void> = Promise.resolve();
  let snapshot: ItemSessionStatus = { kind: "opening" };

  const publish = (): void => {
    if (missing) {
      snapshot = { kind: "missing" };
    } else if (acked === null) {
      snapshot = { kind: "opening" };
    } else {
      const laid = pendingFields.length === 0 ? null : applyOps(acked, pendingFields);
      snapshot = {
        failure,
        fields: laid?.kind === "applied" ? laid.state.fields : acked.fields,
        heldBack,
        kind: "open",
        unsaved: cancelIdle !== null || pendingFields.length > 0,
      };
    }
    for (const listener of listeners) {
      listener();
    }
  };

  // one write or one landing at a time, in the order they were asked for; a failure is said in
  // the status and the next write tries again
  const serial = async (work: () => Promise<void>): Promise<void> => {
    const previous = queue;
    const run = (async () => {
      await previous;
      try {
        await work();
      } catch (error) {
        failure = messageOf(error);
        publish();
      }
    })();
    queue = run;
    await run;
  };

  const withoutHistory = (change: () => void): void => {
    editor.tf.withoutSaving(() => {
      editor.tf.withoutNormalizing(change);
    });
  };

  // a selection's point by the block it stands in, so a block laid in from elsewhere keeps the
  // caret where it still fits
  const heldPoint = (point: Point): HeldPoint | null => {
    const [index] = point.path;
    const node = index === undefined ? undefined : editor.children[index];
    const id = node === undefined ? undefined : blockId(node);
    return id === undefined ? null : { id, point };
  };

  const pointIn = (held: HeldPoint | null): Point | null => {
    if (held === null) {
      return null;
    }
    const index = editor.children.findIndex((node) => blockId(node) === held.id);
    const path = [index, ...held.point.path.slice(1)];
    if (index === -1 || !NodeApi.has(editor, path)) {
      return null;
    }
    const node = NodeApi.get(editor, path);
    return TextApi.isText(node) && held.point.offset <= node.text.length
      ? { offset: held.point.offset, path }
      : null;
  };

  // the editor's value laid out as `target`: what it no longer holds removed first, then each
  // place filled by moving, replacing or inserting, so a change to one block touches one block
  const layOut = (target: readonly TElement[]): void => {
    const wanted = new Set(target.map((element) => blockId(element)));
    for (let index = editor.children.length - 1; index >= 0; index -= 1) {
      const node = editor.children[index];
      if (node !== undefined && !wanted.has(blockId(node))) {
        editor.tf.removeNodes({ at: [index] });
      }
    }
    for (const [index, want] of target.entries()) {
      if (editor.children[index] === want) {
        continue;
      }
      const id = blockId(want);
      const at = editor.children.findIndex(
        (node, place) => place >= index && id !== undefined && blockId(node) === id,
      );
      if (at === -1) {
        editor.tf.insertNodes(want, { at: [index] });
        continue;
      }
      if (at !== index) {
        editor.tf.moveNodes({ at: [at], to: [index] });
      }
      if (editor.children[index] !== want) {
        editor.tf.replaceNodes(want, { at: [index] });
      }
    }
    for (let index = editor.children.length - 1; index >= target.length; index -= 1) {
      editor.tf.removeNodes({ at: [index] });
    }
  };

  // the item as it landed, laid under what this editor changed since its last acknowledgement
  const settle = (item: HeldItem): void => {
    const base = acked;
    if (base === null) {
      return;
    }
    const value = elementsOf(editor);
    const landing = landingOf(base, item, value, reads, merge);
    const target = valueAfter(landing, value);
    const { selection } = editor;
    const anchor = selection === null ? null : heldPoint(selection.anchor);
    const focus = selection === null ? null : heldPoint(selection.focus);
    withoutHistory(() => {
      layOut(target);
    });
    const anchorAt = pointIn(anchor);
    const focusAt = pointIn(focus);
    if (anchorAt !== null && focusAt !== null) {
      editor.tf.select({ anchor: anchorAt, focus: focusAt });
    }
    acked = landing.theirs;
    pendingFields = pendingFields.map((op) => rebased(op, landing.theirs.fields));
    seen = editor.children;
  };

  const write = async (): Promise<void> => {
    for (let attempt = 0; attempt < SETTLE_TRIES && !missing; attempt += 1) {
      const base = acked;
      if (base === null) {
        return;
      }
      const diff = diffValue(base.blocks, elementsOf(editor), reads);
      heldBack = diff.heldBack.length;
      const sentFields = pendingFields;
      const ops = [...diff.ops, ...sentFields];
      if (ops.length === 0) {
        failure = null;
        return;
      }
      const shas = shasWritten(diff.ops);
      const staged = [...files.values()].filter((file) => shas.has(file.sha));
      const outcome = await ports.store.write(itemId, {
        files: staged.map(({ bytes, mime }) => ({ bytes, mime })),
        ops,
      });
      switch (outcome.kind) {
        case "queued":
        case "unchanged": {
          for (const file of staged) {
            files.delete(file.sha);
          }
          pendingFields = pendingFields.slice(sentFields.length);
          failure = null;
          const landed = applyOps(base, ops);
          if (landed.kind === "applied") {
            acked = landed.state;
            return;
          }
          const item = await ports.store.item(itemId);
          if (item === null) {
            missing = true;
          } else {
            settle(item);
          }
          return;
        }
        case "changed": {
          settle(outcome.item);
          break;
        }
        case "invalid": {
          // the fields the patch leaves break the item's caps: the patch goes, the blocks stay
          pendingFields = pendingFields.slice(sentFields.length);
          failure = `the item cannot hold these ${outcome.fields.join(", ")}`;
          break;
        }
        case "missing": {
          missing = true;
          break;
        }
        // no default
      }
    }
  };

  const flush = async (): Promise<void> => {
    cancelIdle?.();
    cancelIdle = null;
    await serial(async () => {
      await write();
      publish();
    });
  };

  const land = async (): Promise<void> => {
    const item = await ports.store.item(itemId);
    if (item === null) {
      missing = true;
    } else {
      settle(item);
    }
    publish();
  };

  const start = async (): Promise<void> => {
    if (following) {
      return;
    }
    following = true;
    unsubscribe = ports.store.onChange((change) => {
      if (following && acked !== null && (change.reset || change.ids.has(itemId))) {
        void serial(land);
      }
    });
    await serial(async () => {
      if (acked !== null) {
        await land();
        return;
      }
      const item = await ports.store.item(itemId);
      if (item === null) {
        missing = true;
        publish();
        return;
      }
      const state = stateOf(item);
      acked = state;
      withoutHistory(() => {
        editor.tf.setValue(orderedBlocks(state.blocks).map((stored) => elementOf(stored.block)));
      });
      seen = editor.children;
      publish();
    });
  };

  const edited = (): void => {
    if (!following || acked === null || editor.children === seen) {
      return;
    }
    seen = editor.children;
    const idle = cancelIdle === null;
    cancelIdle?.();
    cancelIdle = ports.after(idleMs, () => {
      cancelIdle = null;
      void flush();
    });
    if (idle) {
      publish();
    }
  };

  const patch = async (ops: readonly FieldOp[]): Promise<void> => {
    pendingFields = [...pendingFields, ...ops];
    publish();
    await flush();
  };

  const close = async (): Promise<void> => {
    if (!following) {
      return;
    }
    await flush();
    following = false;
    unsubscribe?.();
    unsubscribe = null;
  };

  return {
    close,
    edited,
    flush,
    patch,
    stage: (file) => {
      files.set(file.sha, file);
    },
    start,
    status: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};
