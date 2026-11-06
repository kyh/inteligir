// The page's item mode: the store an item session reads and writes (`@repo/editor/item/item-session`)
// is the phone's replica on the other end of the bridge, so the page holds no copy of the library.
// A link names its item by id, which is the key the editor resolves and opens it by: the page writes
// what it holds and asks the native stack to push that item. An embed draws the item's blocks as
// the phone's replica reads them; a file a note names by its sha is drawn from the phone's file
// cache, which fetches it from the cloud the first time, and one pasted into the text is kept by
// the phone's replica, which sends it up ahead of the write that names it. A highlight the editor
// marks is written to the item as its bare entry beside the markers the item's next write carries,
// its note the same way, and a tap on a marked passage opens the phone's sheet of its highlights,
// as the library's page does; a note the editor makes (an extract, a link's Create) the phone
// makes in the item's folder. The page hands no file on to the system: its WebView opens nothing
// but web links.

import { installEditorHost } from "@repo/editor/host-io";
import type { EditorHostIo } from "@repo/editor/host-io";
import type { ItemSession, ItemStore } from "@repo/editor/item/item-session";
import { createLinkResolverFeed } from "@repo/editor/link-resolver-feed";
import type { ItemInit } from "@repo/editor-bridge/protocol";
import { toast } from "@repo/ui/components/sonner";

import type { PageBridge } from "../bridge/page-bridge";

const base64Of = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCodePoint(byte);
  }
  return btoa(binary);
};

const bytesOf = (base64: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(atob(base64), (character) => character.codePointAt(0) ?? 0);

export const bridgeItemStore = (bridge: PageBridge): ItemStore => ({
  item: async (itemId) => {
    const { item } = await bridge.request("item", { itemId });
    return item;
  },
  onChange: (listener) =>
    bridge.onNative((event) => {
      if (event.type === "itemChanged") {
        listener({
          ids: new Set(event.ids),
          overlapped: new Set(event.overlapped),
          reset: event.reset,
        });
      }
    }),
  write: async (itemId, input) =>
    await bridge.request("writeItem", { itemId, ops: [...input.ops] }),
});

// what an item page does when the editor asks for a door it has not got: nothing
const nothingToDo = (): void => {
  /* an item page has no agent of its own */
};

export interface ItemPageHost {
  // the session the page's editor follows, once it mounts
  readonly attach: (session: ItemSession | null) => void;
  readonly stop: () => void;
}

export const installItemPageHost = (bridge: PageBridge, init: ItemInit): ItemPageHost => {
  const { itemId } = init;
  const feed = createLinkResolverFeed();
  let session: ItemSession | null = null;

  // the items a link can name, by id and by title, and the names they go by now, read again as
  // the library moves; a link shows the title it was written with until the phone answers, and one
  // read at a time runs, the last move it missed asked once it ends
  let reading = false;
  let readAgain = false;
  const readTargets = async (): Promise<void> => {
    if (reading) {
      readAgain = true;
      return;
    }
    reading = true;
    try {
      const { targets } = await bridge.request("linkTargets", {});
      feed.setTargets(targets);
    } catch {
      // the next move asks again
    } finally {
      reading = false;
    }
    if (readAgain) {
      readAgain = false;
      await readTargets();
    }
  };
  void readTargets();

  // the stack opens the linked item by its id, once what this page holds is written
  const open = (linked: string): void => {
    void (async () => {
      await session?.flush();
      const status = session?.status();
      if (status?.kind === "open" && status.unsaved) {
        toast.error("Couldn't save this item — resolve that before leaving it.");
        return;
      }
      bridge.emit({ itemId: linked, type: "openItem" });
    })();
  };

  const flush = async (): Promise<boolean> => {
    await session?.flush();
    const status = session?.status();
    return status?.kind !== "open" || !status.unsaved;
  };

  const io: EditorHostIo = {
    fileMaxBytes: init.fileMaxBytes,
    keepFile: async (bytes, mime) =>
      await bridge.request("keepFile", { base64: base64Of(bytes), mediaType: mime }),
    linkResolver: feed.store,
    onItemsChanged: (listener) =>
      bridge.onNative((event) => {
        if (event.type === "itemChanged") {
          listener(event.reset ? null : new Set(event.ids));
        }
      }),
    openItem: open,
    readFile: async (sha) => {
      const { file } = await bridge.request("readFile", { sha });
      if (file === null) {
        throw new Error("the phone holds no copy of this file now");
      }
      return new Blob([bytesOf(file.base64)], { type: file.mediaType });
    },
    // none while the item's body is still to come to the phone, as the open item waits for it
    readItemBlocks: async (embedded) => {
      const { item } = await bridge.request("item", { itemId: embedded });
      return item?.bodyHeld === true ? item.blocks.map(({ block }) => block) : null;
    },
    savesFiles: false,
  };

  installEditorHost({
    actions: {
      agent: { askAboutSelection: nothingToDo, showTag: nothingToDo },
      annotations: {
        create: async (id, quote) => {
          const { queued } = await bridge.request("addHighlight", { id, itemId, quote });
          return queued;
        },
        edit: async (id, text) => {
          const { queued } = await bridge.request("noteHighlight", { id, itemId, text });
          return queued;
        },
        open: (ids) => {
          const [first, ...rest] = ids;
          if (first !== undefined) {
            bridge.emit({ ids: [first, ...rest], type: "showAnnotations" });
          }
        },
      },
      items: {
        createNote: async (note) => {
          const { id } = await bridge.request("createNote", {
            besideId: itemId,
            blocks: [...note.blocks],
            title: note.title,
          });
          return id;
        },
      },
    },
    io,
  });

  const unsubscribe = bridge.onNative((event) => {
    if (event.type === "itemChanged") {
      // another item moved, or every one: a link's target may be among them
      if (event.reset || event.ids.some((id) => id !== itemId)) {
        void readTargets();
      }
      return;
    }
    if (event.type !== "flush") {
      return;
    }
    void (async () => {
      const ok = await flush();
      bridge.emit({ id: event.id, ok, type: "flushed" });
    })();
  });

  return {
    attach: (next) => {
      session = next;
    },
    stop: unsubscribe,
  };
};
