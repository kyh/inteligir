// The page's host: the library, reached through the phone on the other end of the bridge, so the
// page holds no copy of it. The page draws an item from the blocks the phone holds and takes no
// edit, so it dials no note, keeps no file and makes no note. A link names its item by id, which
// the native stack opens; an embed draws the item's blocks as the phone holds them; a file a note
// names by its sha is drawn from the phone's file cache, which fetches it from the cloud the first
// time. The page hands no file on to the system: its WebView opens nothing but web links.

import { notePath } from "@repo/contract/library/library-socket";
import { installEditorHost, setLibraryTitles } from "@repo/editor/host-io";
import type { EditorHostIo, NoteHost } from "@repo/editor/host-io";
import type { RequestResult } from "@repo/editor-bridge/protocol";

import type { PageBridge } from "../bridge/page-bridge";

export type HeldItem = Exclude<RequestResult<"item">["item"], null>;

const bytesOf = (base64: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(atob(base64), (character) => character.codePointAt(0) ?? 0);

// what an item page does when the editor asks for a door it has not got: nothing
const nothingToDo = (): void => {
  /* an item page has no agent of its own */
};

const takesNoEdit = async (): Promise<never> => {
  await Promise.resolve();
  throw new Error("the phone's page takes no edit");
};

// the page binds no note's live document, so nothing dials it: it reads as offline for good
const NO_NOTES: NoteHost = {
  notePath,
  offline: () => true,
  onOfflineChange: () => nothingToDo,
  socketTicket: takesNoEdit,
};

// one read at a time, the last move it missed asked once it ends; a read that fails waits for the
// next move
export const oneReadAtATime = (read: () => Promise<void>): (() => Promise<void>) => {
  let reading = false;
  let readAgain = false;
  const run = async (): Promise<void> => {
    if (reading) {
      readAgain = true;
      return;
    }
    reading = true;
    try {
      await read();
    } catch {
      // the next move asks again
    } finally {
      reading = false;
    }
    if (readAgain) {
      readAgain = false;
      await run();
    }
  };
  return run;
};

export interface ItemPageHost {
  readonly stop: () => void;
}

export const installItemPageHost = (bridge: PageBridge, itemId: string): ItemPageHost => {
  // the library's titles, which a link reads, read again as another item moves; a link shows the
  // title it was written with until the phone answers
  const readTargets = oneReadAtATime(async () => {
    const { targets } = await bridge.request("linkTargets", {});
    setLibraryTitles(targets);
  });
  void readTargets();

  const io: EditorHostIo = {
    // the page takes no file, so it holds every one past its cap
    fileMaxBytes: 0,
    keepFile: takesNoEdit,
    notes: NO_NOTES,
    onItemsChanged: (listener) =>
      bridge.onNative((event) => {
        listener(event.reset ? null : new Set(event.ids));
      }),
    openItem: (linked) => {
      bridge.emit({ itemId: linked, type: "openItem" });
    },
    readFile: async (sha) => {
      const { file } = await bridge.request("readFile", { sha });
      if (file === null) {
        throw new Error("the phone holds no copy of this file now");
      }
      return new Blob([bytesOf(file.base64)], { type: file.mediaType });
    },
    readItemBlocks: async (embedded) => {
      const { item } = await bridge.request("item", { itemId: embedded });
      return item?.blocks.map(({ block }) => block) ?? null;
    },
    savesFiles: false,
  };

  installEditorHost({
    actions: {
      agent: { askAboutSelection: nothingToDo, showTag: nothingToDo },
      items: { createNote: takesNoEdit },
    },
    io,
  });

  const stop = bridge.onNative((event) => {
    // another item moved, or every one: a link's target may be among them
    if (event.reset || event.ids.some((id) => id !== itemId)) {
      void readTargets();
    }
  });

  return { stop };
};
