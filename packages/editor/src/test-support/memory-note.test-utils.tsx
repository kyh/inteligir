import { act, render } from "@testing-library/react";
import type { SlateEditor } from "platejs";
import { vi } from "vitest";

import { importItem } from "../headless/codec/item-markdown";
import { ItemEditor } from "../item/item-editor";
import { getLiveEditor } from "../live-editor";
import { pretendLibrary } from "./codec-ports.test-utils";
import type { MemoryNotes } from "./memory-notes.test-utils";

const OPEN_TURNS = 100;

const nextTurn = async () => {
  await (vi.isFakeTimers() ? vi.advanceTimersByTimeAsync(0) : Promise.resolve());
};

const seedNote = (notes: MemoryNotes, itemId: string, markdown: string) => {
  const read = importItem({ name: "Item", text: markdown }, pretendLibrary().importPorts());

  if (!read.ok) {
    throw new Error("the item reads in");
  }

  notes.seed(
    itemId,
    read.item.blocks.map(({ block, section }) => ({ block, section })),
  );
};

interface MountedNote {
  readonly editor: SlateEditor;
  readonly editable: HTMLElement;
  readonly unmount: () => void;
}

export const mountNote = async (notes: MemoryNotes, itemId: string, markdown: string) => {
  seedNote(notes, itemId, markdown);
  const view = render(<ItemEditor itemId={itemId} onNote={() => {}} />);

  for (let turn = 0; turn < OPEN_TURNS; turn += 1) {
    const editable = view.container.querySelector<HTMLElement>('[contenteditable="true"]');
    const editor = getLiveEditor(itemId);

    if (editable !== null && editor !== null) {
      return { editable, editor, unmount: view.unmount } satisfies MountedNote;
    }

    await act(async () => {
      await nextTurn();
    });
  }

  throw new Error("the note opened in no editor");
};
