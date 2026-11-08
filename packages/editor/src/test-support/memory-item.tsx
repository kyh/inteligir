// Items held in memory as the cell holds them, behind the store an open item's session reaches: a
// write lands whole over the bases it names or answers the item as it is now, and a write from
// elsewhere lands the same way and is told to the store's listeners, as the account's socket
// tells a device, unless the case holds the word back. The session's own write is told to no one,
// as a store passes over the word of a landing it made. A case can hold the store's next read or
// write until it lets it go. `mountItem` opens an item read in from markdown
// in the item editor as a host mounts it, so the suites that measure the surface (its runs of
// blocks, its per-block store work, what typing costs) run the pause, the diff and the write it
// runs in the app.

import { act, render } from "@testing-library/react";
import type { SlateEditor } from "platejs";

import { applyOps, orderedBlocks } from "@repo/notes/library/block-ops";
import type { ItemState, LibraryOp } from "@repo/notes/library/block-ops";
import { blockHash } from "@repo/notes/library/block-hash";
import { noteFields } from "@repo/notes/test-support/library-items";

import { importItem } from "../codec/item-markdown";
import type { Deferred } from "../deferred";
import { ItemEditor } from "../item/item-editor";
import type { HeldItem, ItemSessionPorts, ItemStore, ItemStoreChange } from "../item/item-session";
import { getLiveEditor } from "../live-editor";
import { pretendLibrary } from "./codec-ports";

// how many turns of the microtask queue an item's read gets to land in before the mount gives up
const OPEN_TURNS = 50;

const heldOf = (state: ItemState): HeldItem => ({
  blocks: orderedBlocks(state.blocks),
  bodyHeld: true,
  fields: state.fields,
});

// what holds the store's next read or write until the case lets it go: a read waits while its
// gate is set, a write takes its gate with it
interface HeldCalls {
  read: Deferred<null> | null;
  write: Deferred<null> | null;
}

export interface MemoryItems {
  readonly store: ItemStore;
  readonly held: HeldCalls;
  // the item as the store holds it now
  readonly item: (itemId: string) => ItemState | undefined;
  // an item made elsewhere, or set as it stands
  readonly put: (itemId: string, state: ItemState) => void;
  // `ops` landed on the item from elsewhere, another device or the agent, and told to the
  // listeners unless `quiet`, as a word still on its way
  readonly landElsewhere: (
    itemId: string,
    ops: readonly LibraryOp[],
    options?: { readonly quiet?: boolean },
  ) => void;
  // tells the listeners the item moved, whether or not it did
  readonly tell: (itemId: string) => void;
}

export const memoryItems = (start: Iterable<readonly [string, ItemState]> = []): MemoryItems => {
  const items = new Map(start);
  const listeners = new Set<(change: ItemStoreChange) => void>();
  const held: HeldCalls = { read: null, write: null };

  const tell = (itemId: string): void => {
    const change: ItemStoreChange = {
      ids: new Set([itemId]),
      overlapped: new Set(),
      reset: false,
    };
    for (const listener of listeners) {
      listener(change);
    }
  };

  const store: ItemStore = {
    item: async (itemId) => {
      await held.read?.promise;
      const state = items.get(itemId);
      return state === undefined ? null : heldOf(state);
    },
    onChange: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    write: async (itemId, input) => {
      const waiting = held.write;
      held.write = null;
      await waiting?.promise;
      const state = items.get(itemId);
      if (state === undefined) {
        return { kind: "missing" };
      }
      const landed = applyOps(state, input.ops);
      if (landed.kind === "conflict") {
        return { item: heldOf(state), kind: "changed" };
      }
      if (landed.kind === "invalid") {
        return { fields: landed.fields, kind: "invalid" };
      }
      items.set(itemId, landed.state);
      return { kind: "queued" };
    },
  };

  return {
    held,
    item: (itemId) => items.get(itemId),
    landElsewhere: (itemId, ops, options = {}) => {
      const state = items.get(itemId);
      const landed = state === undefined ? null : applyOps(state, ops);
      if (landed?.kind !== "applied") {
        throw new Error(`ops from elsewhere did not land: ${JSON.stringify(landed)}`);
      }
      items.set(itemId, landed.state);
      if (options.quiet !== true) {
        tell(itemId);
      }
    },
    put: (itemId, state) => {
      items.set(itemId, state);
      tell(itemId);
    },
    store,
    tell,
  };
};

const itemOfMarkdown = (markdown: string): ItemState => {
  const read = importItem({ name: "Item", text: markdown }, pretendLibrary().importPorts());
  if (!read.ok) {
    throw new Error("the item reads in");
  }
  return {
    blocks: new Map(
      read.item.blocks.map(({ block, ord, section }) => [
        block.id,
        { block, hash: blockHash(block), ord, section },
      ]),
    ),
    fields: noteFields({ title: read.item.fields.title }),
  };
};

export interface MountedItem {
  readonly editor: SlateEditor;
  readonly editable: HTMLElement;
  readonly unmount: () => void;
}

// the item `markdown` reads in as, open in the item editor once its blocks are in
export const mountItem = async (itemId: string, markdown: string): Promise<MountedItem> => {
  const ports: ItemSessionPorts = {
    // the app's own pause, on whatever timers the suite runs
    after: (ms, run) => {
      const timer = setTimeout(run, ms);
      return () => {
        clearTimeout(timer);
      };
    },
    notifyOverlap: () => {},
    store: memoryItems([[itemId, itemOfMarkdown(markdown)]]).store,
  };
  const view = render(<ItemEditor itemId={itemId} ports={ports} onSession={() => {}} />);
  for (let turn = 0; turn < OPEN_TURNS; turn += 1) {
    const editable = view.container.querySelector<HTMLElement>('[data-slate-editor="true"]');
    const editor = getLiveEditor(itemId);
    if (editable !== null && editor !== null) {
      return { editable, editor, unmount: view.unmount };
    }
    await act(async () => {
      await Promise.resolve();
    });
  }
  throw new Error("the item opened in no editor");
};
