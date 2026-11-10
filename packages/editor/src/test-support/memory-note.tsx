// A note's object in memory, open in the item editor as a host mounts it: the item read in from
// markdown seeds the object's document, and the surface dials it over the fake socket, syncs and
// binds, so the suites that measure the surface (its runs of blocks, its per-block store work,
// what typing costs) run the binding and the connection the app runs. The suite installs the
// editor host first.

import { act, render } from "@testing-library/react";
import type { SlateEditor } from "platejs";

import { importItem } from "../codec/item-markdown";
import { ItemEditor } from "../item/item-editor";
import { seedDoc } from "../live/note-blocks";
import { getLiveEditor } from "../live-editor";
import { pretendLibrary } from "./codec-ports";
import { noteServer } from "./note-server";
import type { NoteServer } from "./note-server";

// how many turns of the microtask queue a note's dial and sync get before the mount gives up
const OPEN_TURNS = 100;

// seeds the note's object with the item `markdown` reads in as
const seedNote = (server: NoteServer, itemId: string, markdown: string): void => {
  const read = importItem({ name: "Item", text: markdown }, pretendLibrary().importPorts());
  if (!read.ok) {
    throw new Error("the item reads in");
  }
  seedDoc(
    server.note(itemId).doc,
    read.item.blocks.map(({ block, section }) => ({ block, section })),
  );
};

export interface MountedNote {
  readonly editor: SlateEditor;
  readonly editable: HTMLElement;
  readonly server: NoteServer;
  readonly unmount: () => void;
}

// the note `markdown` reads in as, open in the item editor once its document has synced
export const mountNote = async (itemId: string, markdown: string): Promise<MountedNote> => {
  const server = noteServer();
  seedNote(server, itemId, markdown);
  const view = render(<ItemEditor itemId={itemId} onNote={() => {}} />);
  for (let turn = 0; turn < OPEN_TURNS; turn += 1) {
    const editable = view.container.querySelector<HTMLElement>('[contenteditable="true"]');
    const editor = getLiveEditor(itemId);
    if (editable !== null && editor !== null) {
      return { editable, editor, server, unmount: view.unmount };
    }
    await act(async () => {
      await Promise.resolve();
    });
  }
  throw new Error("the note opened in no editor");
};
