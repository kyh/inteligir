// A note the library holds in memory, open in the item editor as a host mounts it: the item read in
// from markdown is seeded as its stored body, and the surface reads it and draws, so the suites
// that measure the surface (its runs of blocks, its per-block store work, what typing costs) run
// the read and the saves the app runs. The suite installs the editor host first and hands its
// notes over.

import { act, render } from "@testing-library/react";
import type { SlateEditor } from "platejs";
import { vi } from "vitest";

import { importItem } from "../headless/codec/item-markdown";
import { ItemEditor } from "../item/item-editor";
import { getLiveEditor } from "../live-editor";
import { pretendLibrary } from "./codec-ports";
import type { MemoryNotes } from "./memory-notes";

// how many turns of the microtask queue a note's read gets before the mount gives up
const OPEN_TURNS = 100;

const nextTurn = async (): Promise<void> => {
  await (vi.isFakeTimers() ? vi.advanceTimersByTimeAsync(0) : Promise.resolve());
};

// seeds the note with the item `markdown` reads in as
const seedNote = (notes: MemoryNotes, itemId: string, markdown: string): void => {
  const read = importItem({ name: "Item", text: markdown }, pretendLibrary().importPorts());
  if (!read.ok) {
    throw new Error("the item reads in");
  }
  notes.seed(
    itemId,
    read.item.blocks.map(({ block, section }) => ({ block, section })),
  );
};

export interface MountedNote {
  readonly editor: SlateEditor;
  readonly editable: HTMLElement;
  readonly unmount: () => void;
}

// the note `markdown` reads in as, open in the item editor once it is read
export const mountNote = async (
  notes: MemoryNotes,
  itemId: string,
  markdown: string,
): Promise<MountedNote> => {
  seedNote(notes, itemId, markdown);
  const view = render(<ItemEditor itemId={itemId} onNote={() => {}} />);
  for (let turn = 0; turn < OPEN_TURNS; turn += 1) {
    const editable = view.container.querySelector<HTMLElement>('[contenteditable="true"]');
    const editor = getLiveEditor(itemId);
    if (editable !== null && editor !== null) {
      return { editable, editor, unmount: view.unmount };
    }
    await act(async () => {
      await nextTurn();
    });
  }
  throw new Error("the note opened in no editor");
};
