// The page's item mode: the store an item session reads and writes (`@repo/editor/item/item-session`)
// is the phone's replica on the other end of the bridge, so the page holds no copy of the library.
// A link names its item by id, which is the key the editor resolves and opens it by: the page writes
// what it holds and asks the native stack to push that item. A highlight the editor marks is
// written to the item as its bare entry beside the markers the item's next write carries, its note
// the same way, and a tap on a marked passage opens the phone's sheet of its highlights, as the
// library's page does. What the page has no door to (a file by its path, a picked image, an html
// block's frame) answers that nothing is there.

import { installEditorHost } from "@repo/editor/host-io";
import type { EditorHostIo, VaultActions } from "@repo/editor/host-io";
import type { ItemSession, ItemStore } from "@repo/editor/item/item-session";
import { createLinkResolverFeed } from "@repo/editor/link-resolver-feed";
import type { WikiTarget } from "@repo/notes/knowledge/wiki-target";
import { toast } from "@repo/ui/components/sonner";

import type { PageBridge } from "../bridge/page-bridge";

const base64Of = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCodePoint(byte);
  }
  return btoa(binary);
};

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
    await bridge.request("writeItem", {
      files: (input.files ?? []).map(({ bytes, mime }) => ({
        base64: base64Of(bytes),
        mediaType: mime,
      })),
      itemId,
      ops: [...input.ops],
    }),
});

// what an item page does when the editor asks for a door it has not got: nothing
const nothingToDo = (): void => {
  /* an item page has no note by path and no agent of its own */
};

const nothingThere = async (): Promise<never> => {
  await Promise.resolve();
  throw new Error("an item page reads no file by its path");
};

export interface ItemPageHost {
  // the session the page's editor follows, once it mounts
  readonly attach: (session: ItemSession | null) => void;
  readonly stop: () => void;
}

export const installItemPageHost = (bridge: PageBridge, itemId: string): ItemPageHost => {
  const feed = createLinkResolverFeed();
  let session: ItemSession | null = null;
  let targets: readonly WikiTarget[] = [];

  // the items a link can name, by id and by title, and the names they go by now; a link shows the
  // title it was written with until the phone answers
  void (async () => {
    try {
      const { targets: read } = await bridge.request("wikiTargets", {});
      targets = read;
      feed.setTargets(read);
    } catch {
      // the next load asks again
    }
  })();

  // the resolver answers the path the phone lists an item under; the stack opens it by its id
  const open = (path: string): void => {
    const linked = targets.find((target) => target.path === path)?.id;
    if (linked === undefined) {
      return;
    }
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

  const vault: VaultActions = {
    closeFile: nothingToDo,
    createFile: async () => {
      await Promise.resolve();
    },
    createFileAt: async () => await Promise.resolve(null),
    createNewFileAt: async () => await Promise.resolve({ kind: "refused" as const }),
    deleteEntry: async () => await Promise.resolve(false),
    editNote: nothingToDo,
    flush,
    openFile: open,
    registerNoteSerializeFlush: nothingToDo,
    renameEntry: async () => await Promise.resolve(false),
  };

  const io: EditorHostIo = {
    linkResolver: feed.store,
    onVaultChanged: () => nothingToDo,
    opensFiles: false,
    pickImage: null,
    readVaultAsset: async () => await Promise.resolve({ error: "no file here", ok: false }),
    readVaultFile: nothingThere,
    vault,
    writeVaultAsset: nothingThere,
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
    },
    io,
  });

  const unsubscribe = bridge.onNative((event) => {
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
