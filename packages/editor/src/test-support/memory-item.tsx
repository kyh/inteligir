// An item read in from markdown by the codec and held in memory, mounted in the item editor as a
// host mounts it: the store answers it whole and lands each write's ops, so the surface runs the
// pause, the diff and the write it runs in the app. The suites that measure the surface (its runs
// of blocks, its per-block store work, what typing costs) open their items here.

import { act, render } from "@testing-library/react";
import type { SlateEditor } from "platejs";

import { applyOps, orderedBlocks } from "@repo/notes/library/block-ops";
import type { ItemState } from "@repo/notes/library/block-ops";
import { blockHash } from "@repo/notes/library/block-hash";
import { noteFields } from "@repo/notes/test-support/library-items";

import { importItem } from "../codec/item-markdown";
import { ItemEditor } from "../item/item-editor";
import type { HeldItem, ItemSessionPorts, ItemStore } from "../item/item-session";
import { getLiveEditor } from "../live-editor";
import { pretendLibrary } from "./codec-ports";

// how many turns of the microtask queue an item's read gets to land in before the mount gives up
const OPEN_TURNS = 50;

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

const heldOf = (state: ItemState): HeldItem => ({
  blocks: orderedBlocks(state.blocks),
  bodyHeld: true,
  fields: state.fields,
});

const portsOver = (itemId: string, held: ItemState): ItemSessionPorts => {
  let state = held;
  const store: ItemStore = {
    item: async (id) => await Promise.resolve(id === itemId ? heldOf(state) : null),
    onChange: () => () => {},
    write: async (id, input) => {
      await Promise.resolve();
      if (id !== itemId) {
        return { kind: "missing" };
      }
      const landed = applyOps(state, input.ops);
      if (landed.kind !== "applied") {
        return { item: heldOf(state), kind: "changed" };
      }
      ({ state } = landed);
      return { kind: "queued" };
    },
  };
  return {
    // the app's own pause, on whatever timers the suite runs
    after: (ms, run) => {
      const timer = setTimeout(run, ms);
      return () => {
        clearTimeout(timer);
      };
    },
    notifyOverlap: () => {},
    store,
  };
};

export interface MountedItem {
  readonly editor: SlateEditor;
  readonly editable: HTMLElement;
  readonly unmount: () => void;
}

// the item `markdown` reads in as, open in the item editor once its blocks are in
export const mountItem = async (itemId: string, markdown: string): Promise<MountedItem> => {
  const ports = portsOver(itemId, itemOfMarkdown(markdown));
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
