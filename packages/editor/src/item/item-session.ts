// An item open in the editor by its id, over the store its host hands it: the editor's value is
// the item's blocks, each top-level element the block its id names, and the session keeps no copy
// of the value of its own. A pause in typing writes what changed since the blocks it last
// acknowledged (`item-diff.ts`) through the store; a field patch writes at once. A change that
// lands from elsewhere is laid into the value with the editor's own transforms, outside its undo
// history, which starts over: a block only one side changed takes that side, one both changed is
// merged three ways (`@repo/editor/stale-write`), and an edit outlives a drop either way round. A
// write the store refuses on a base that moved under it settles the same way and goes again, and a
// merge that kept this device's lines over another's change to the same ones is said, whether this
// session or the store made it. A block no write can store, and an edit that waits on a body still
// to come, stay in the editor as the person left them, counted unsaved and said, so a host holds
// the leave.
// Construction is inert: nothing reads, subscribes or schedules until `start()`.

import { NodeApi, TextApi } from "platejs";
import type { Point, SlateEditor, TElement } from "platejs";

import { applyOps, libraryOpSchema, orderedBlocks } from "@repo/notes/library/block-ops";
import type { ItemState, LibraryOp, StoredBlock } from "@repo/notes/library/block-ops";
import type { LibraryItemFields } from "@repo/notes/library/library-item";
import type { LibraryBlock, LibrarySection } from "@repo/notes/library/library-nodes";

import { watchFileKeeps } from "@repo/editor/file-keeps";
import { blockId } from "@repo/editor/node-props";
import { mergeBlocks } from "@repo/editor/stale-write";

import { diffValue, readElement } from "./item-diff";
import type { ElementReads } from "./item-diff";

/** @internal */
export interface HeldItem {
  readonly fields: LibraryItemFields;
  // in reading order: the note, then the article
  readonly blocks: readonly StoredBlock[];
  // false while its body is still to come from the cloud: a row pulled ahead of its blocks
  readonly bodyHeld: boolean;
}

interface ItemWrite {
  readonly ops: readonly LibraryOp[];
}

type ItemWriteOutcome =
  | { readonly kind: "queued" }
  | { readonly kind: "unchanged" }
  | { readonly kind: "missing" }
  // a base the write names no longer holds against the item as the store reads it now
  | { readonly kind: "changed"; readonly item: HeldItem }
  | { readonly kind: "invalid"; readonly fields: readonly string[] }
  // the item's body is still to come, so nothing can tell what the write is written over
  | { readonly kind: "waiting" };

// what moved in the store: these items or all of them, and the items a queued write of this
// device was merged into keeping its lines over another device's change to the same ones
/** @internal */
export interface ItemStoreChange {
  readonly ids: ReadonlySet<string>;
  readonly reset: boolean;
  readonly overlapped: ReadonlySet<string>;
}

// the item as the session reaches it: the host's read of it, its write and its word of what moved
export interface ItemStore {
  readonly item: (itemId: string) => Promise<HeldItem | null>;
  readonly write: (itemId: string, input: ItemWrite) => Promise<ItemWriteOutcome>;
  readonly onChange: (listener: (change: ItemStoreChange) => void) => () => void;
}

export type FieldOp = Extract<LibraryOp, { op: "set" | "tags" | "aliases" | "property" }>;

export interface ItemSessionPorts {
  readonly store: ItemStore;
  // a timer the session cancels: the pause that writes
  readonly after: (ms: number, run: () => void) => () => void;
  // a merge kept this device's lines where another device changed the same ones: the host says
  // so of the item by its title (`mergeConflictLine`)
  readonly notifyOverlap: (title: string) => void;
}

export type ItemSessionStatus =
  | { readonly kind: "opening" }
  // the device holds no such item: it was deleted, or never reached this device
  | { readonly kind: "missing" }
  // its first read failed, in the person's words: `read` asks again
  | { readonly kind: "unread"; readonly failure: string }
  | {
      readonly kind: "open";
      // the item's fields with this session's patches laid over
      readonly fields: LibraryItemFields;
      // an edit the store has not queued yet
      readonly unsaved: boolean;
      // why an edit is not saved, in the person's words: the last write or landing failed, or a
      // block here is one no write can store; null once neither holds
      readonly failure: string | null;
    };

export interface ItemSession {
  // reads the item into the editor and follows it
  readonly start: () => Promise<void>;
  // reads the item again, into the editor or under what it holds
  readonly read: () => Promise<void>;
  // the editor's value moved: the host's change callback
  readonly edited: () => void;
  // writes what is unsaved now, as leaving the item does
  readonly flush: () => Promise<void>;
  readonly patch: (ops: readonly FieldOp[]) => Promise<void>;
  readonly status: () => ItemSessionStatus;
  readonly subscribe: (listener: () => void) => () => void;
  // writes what is unsaved and stops following the item, until it starts again
  readonly close: () => Promise<void>;
}

// the pause after the last keystroke that writes it
/** @internal */
export const ITEM_IDLE_MS = 800;
// a write refused on a moved base is settled and sent again, this many times in one go
const SETTLE_TRIES = 3;
/** @internal */
export const KEPT_CHANGING = "This item kept changing elsewhere while it saved. It will try again.";
/** @internal */
export const BLOCK_HELD_BACK =
  "Part of this item can't be saved. Shorten or change it, or leaving loses what changed there.";
/** @internal */
export const ITEM_UNSAVED = "This item couldn't be saved just now. It will try again.";
/** @internal */
export const ITEM_UNREAD = "This item couldn't be read just now.";
/** @internal */
export const BODY_TO_COME =
  "This item is still on its way to this device. Your edit saves once it's here.";

// a stored block as the element the editor holds
/** @internal */
export const elementOf = (block: LibraryBlock): TElement => ({ ...block });

const stateOf = (item: HeldItem): ItemState => ({
  blocks: new Map(item.blocks.map((stored) => [stored.block.id, stored])),
  fields: item.fields,
});

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
// editor holds and which of its blocks it changed or moved since, and the blocks whose merge kept
// this editor's lines over the landing's change to the same ones
interface Landing {
  readonly base: ItemState;
  readonly theirs: ItemState;
  readonly mine: ReadonlyMap<string, ReadBlock>;
  readonly touched: ReadonlySet<string>;
  readonly movedHere: ReadonlySet<string>;
  // the blocks this editor holds that no write can store, and so no merge can read
  readonly heldBack: ReadonlySet<string | null>;
  readonly overlapped: Set<string>;
}

const landingOf = (
  base: ItemState,
  item: HeldItem,
  value: readonly TElement[],
  reads: ElementReads,
): Landing => {
  const touched = new Set<string>();
  const movedHere = new Set<string>();
  const diff = diffValue(base.blocks, value, reads);
  for (const op of diff.ops) {
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
  return {
    base,
    heldBack: new Set(diff.heldBack),
    mine,
    movedHere,
    overlapped: new Set(),
    theirs: stateOf(item),
    touched,
  };
};

// a block only one side changed takes that side, one both changed is merged, an edit outlives a
// drop either way round, and one held back stays, since it is the one copy of what the person wrote
const decide = (landing: Landing, id: string): Decision => {
  const was = landing.base.blocks.get(id);
  const now = landing.theirs.blocks.get(id);
  if (was?.hash === now?.hash || landing.heldBack.has(id)) {
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
  const merged = mergeBlocks({ base: was.block, mine: ours.block, theirs: now.block });
  if (merged.overlapped) {
    landing.overlapped.add(id);
  }
  return { block: merged.block, kind: "take" };
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
  const reads: ElementReads = new WeakMap();
  const dropped = new Map<string, LibrarySection>();
  const listeners = new Set<() => void>();
  let acked: ItemState | null = null;
  let pendingFields: FieldOp[] = [];
  let holdsBack = false;
  let failure: string | null = null;
  // an edit the tries ran out on: no write has queued it yet
  let behind = false;
  let missing = false;
  let seen: SlateEditor["children"] | null = null;
  let cancelIdle: (() => void) | null = null;
  const keeping = new Set<Promise<void>>();
  let unsubscribe: (() => void) | null = null;
  let following = false;
  let queue: Promise<void> = Promise.resolve();
  let snapshot: ItemSessionStatus = { kind: "opening" };

  const publish = (): void => {
    if (missing) {
      snapshot = { kind: "missing" };
    } else if (acked === null) {
      snapshot = failure === null ? { kind: "opening" } : { failure, kind: "unread" };
    } else {
      const laid = pendingFields.length === 0 ? null : applyOps(acked, pendingFields);
      snapshot = {
        failure: failure ?? (holdsBack ? BLOCK_HELD_BACK : null),
        fields: laid?.kind === "applied" ? laid.state.fields : acked.fields,
        kind: "open",
        unsaved:
          cancelIdle !== null ||
          pendingFields.length > 0 ||
          behind ||
          holdsBack ||
          keeping.size > 0,
      };
    }
    for (const listener of listeners) {
      listener();
    }
  };

  // one write or one read at a time, in the order they were asked for; one that throws says so to
  // the caller that asked, and the next still runs
  const serial = async (work: () => Promise<void>): Promise<void> => {
    const previous = queue;
    const run = (async () => {
      await Promise.allSettled([previous]);
      await work();
    })();
    queue = run;
    await run;
  };

  const withoutHistory = (change: () => void): void => {
    editor.tf.withoutSaving(() => {
      editor.tf.withoutNormalizing(change);
    });
  };

  const startHistoryOver = (): void => {
    editor.history.undos = [];
    editor.history.redos = [];
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

  // the item as it landed, laid under what this editor changed since its last acknowledgement;
  // `overlappedThere`: the store already merged this device's write into it over an overlap
  const settle = (item: HeldItem, overlappedThere: boolean): void => {
    const base = acked;
    if (base === null) {
      return;
    }
    const value = editor.children;
    const landing = landingOf(base, item, value, reads);
    const target = valueAfter(landing, value);
    const { selection } = editor;
    const anchor = selection === null ? null : heldPoint(selection.anchor);
    const focus = selection === null ? null : heldPoint(selection.focus);
    withoutHistory(() => {
      layOut(target);
    });
    // an undo replays each edit at the path and offset it was recorded at, which no longer name
    // what it changed; rebasing them would mean transforming every batch through the landing
    if (editor.children !== value) {
      startHistoryOver();
    }
    const anchorAt = pointIn(anchor);
    const focusAt = pointIn(focus);
    if (anchorAt !== null && focusAt !== null) {
      editor.tf.select({ anchor: anchorAt, focus: focusAt });
    }
    acked = landing.theirs;
    pendingFields = pendingFields.map((op) => rebased(op, landing.theirs.fields));
    seen = editor.children;
    if (overlappedThere || landing.overlapped.size > 0) {
      ports.notifyOverlap(landing.theirs.fields.title);
    }
  };

  // the pause that writes, from now: `run` is the flush it ends in
  const arm = (run: () => void): void => {
    cancelIdle?.();
    cancelIdle = ports.after(ITEM_IDLE_MS, () => {
      cancelIdle = null;
      run();
    });
  };

  // whether the tries ran out on an item that kept moving, which leaves the edit unsaved
  const write = async (): Promise<"done" | "ran-out"> => {
    // a patch the item refused is gone, and that stays said through the blocks written after it
    let refused: string | null = null;
    for (let attempt = 0; attempt < SETTLE_TRIES && !missing; attempt += 1) {
      const base = acked;
      if (base === null) {
        return "done";
      }
      const diff = diffValue(base.blocks, editor.children, reads, dropped);
      holdsBack = diff.heldBack.length > 0;
      const sentFields = pendingFields;
      const ops = [...diff.ops, ...sentFields];
      if (ops.length === 0) {
        failure = refused;
        behind = false;
        return "done";
      }
      const outcome = await ports.store.write(itemId, { ops });
      switch (outcome.kind) {
        case "queued":
        case "unchanged": {
          pendingFields = pendingFields.slice(sentFields.length);
          failure = refused;
          behind = false;
          for (const op of diff.ops) {
            const held = op.op === "drop" ? base.blocks.get(op.blockId) : undefined;
            if (held !== undefined) {
              dropped.set(held.block.id, held.section);
            }
          }
          const landed = applyOps(base, ops);
          if (landed.kind === "applied") {
            acked = landed.state;
            return "done";
          }
          const item = await ports.store.item(itemId);
          if (item === null) {
            missing = true;
          } else {
            settle(item, false);
          }
          return "done";
        }
        case "changed": {
          settle(outcome.item, false);
          failure = KEPT_CHANGING;
          break;
        }
        case "invalid": {
          // the fields the patch leaves break the item's caps: the patch goes, the blocks stay
          pendingFields = pendingFields.slice(sentFields.length);
          refused = `This item can't hold these ${outcome.fields.join(", ")}.`;
          failure = refused;
          break;
        }
        case "missing": {
          missing = true;
          break;
        }
        // said, so a leave holds: its own write would meet this same answer and nothing after it
        case "waiting": {
          failure = refused ?? BODY_TO_COME;
          behind = true;
          return "ran-out";
        }
        // no default
      }
    }
    if (missing) {
      return "done";
    }
    behind = true;
    return "ran-out";
  };

  const writeOrSay = async (): Promise<"done" | "ran-out"> => {
    try {
      return await write();
    } catch {
      failure = ITEM_UNSAVED;
      behind = true;
      return "ran-out";
    }
  };

  const writeNow = async (): Promise<void> => {
    cancelIdle?.();
    cancelIdle = null;
    await serial(async () => {
      // an edit the tries ran out on, or a write the store rejected, goes again after the next
      // pause while the item is open, and the status says why meanwhile
      if ((await writeOrSay()) === "ran-out" && following) {
        arm(() => {
          void writeNow();
        });
      }
      publish();
    });
  };

  const writeBehind = async (keep: Promise<void>): Promise<void> => {
    await Promise.allSettled([keep]);
    await writeNow();
  };

  // a file's block is in no value until it is kept, so the keep writes it, with or without a
  // surface still open to see it land, and counts as unsaved until that write is done
  const followFileKeep = async (keep: Promise<void>): Promise<void> => {
    const written = writeBehind(keep);
    keeping.add(written);
    publish();
    await Promise.allSettled([written]);
    keeping.delete(written);
    publish();
  };

  // what the value holds goes at once, however long a file takes, and each keep's own write ends it
  const flush = async (): Promise<void> => {
    await writeNow();
    while (keeping.size > 0) {
      await Promise.allSettled(keeping);
    }
  };

  const land = async (overlappedThere: boolean): Promise<void> => {
    const item = await ports.store.item(itemId);
    if (failure === ITEM_UNREAD) {
      failure = null;
    }
    missing = item === null;
    // a body still to come (the replica started over, or a card folded onto an item it has not
    // pulled) took no block away
    if (item?.bodyHeld === true) {
      settle(item, overlappedThere);
    }
    publish();
  };

  // the item read into the editor the first time: one this device does not hold yet (a link
  // followed before the replica's first pull) is missing, and one whose row came ahead of its
  // blocks is opening, until a change brings what was still to come
  const open = async (): Promise<void> => {
    const item = await ports.store.item(itemId);
    failure = null;
    missing = item === null;
    if (item === null || !item.bodyHeld) {
      publish();
      return;
    }
    const state = stateOf(item);
    acked = state;
    withoutHistory(() => {
      editor.tf.setValue(orderedBlocks(state.blocks).map((stored) => elementOf(stored.block)));
    });
    // the value is the item's now, so no undo reaches what the editor held before it, as Plate's
    // own reset clears
    startHistoryOver();
    seen = editor.children;
    publish();
  };

  // the item as the store holds it now; a read that fails is said, and the next change or a
  // person's retry reads again
  const read = async (overlappedThere = false): Promise<void> => {
    await serial(async () => {
      try {
        await (acked === null ? open() : land(overlappedThere));
      } catch {
        failure = ITEM_UNREAD;
        publish();
      }
    });
  };

  const start = async (): Promise<void> => {
    if (following) {
      return;
    }
    following = true;
    watchFileKeeps(editor, (keep) => {
      void followFileKeep(keep);
    });
    unsubscribe = ports.store.onChange((change) => {
      if (following && (change.reset || change.ids.has(itemId))) {
        void read(change.overlapped.has(itemId));
      }
    });
    await read();
  };

  const edited = (): void => {
    if (!following || acked === null || editor.children === seen) {
      return;
    }
    seen = editor.children;
    const idle = cancelIdle === null;
    arm(() => {
      void writeNow();
    });
    if (idle) {
      publish();
    }
  };

  const patch = async (ops: readonly FieldOp[]): Promise<void> => {
    pendingFields = [...pendingFields, ...ops];
    publish();
    await writeNow();
  };

  // stops following at once, so a start that comes before the write ends (React's second mount)
  // follows again, and writes what is unsaved behind it
  const close = async (): Promise<void> => {
    if (!following) {
      return;
    }
    following = false;
    unsubscribe?.();
    unsubscribe = null;
    await flush();
  };

  return {
    close,
    edited,
    flush,
    patch,
    read: async () => {
      await read();
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
