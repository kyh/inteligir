// The editor's host on this page: what the editor's kits ask of the page, answered by the cell. A
// link names its item by id, which the resolver maps to the library's titles, and opening it opens
// that item; an embed draws the item's blocks as the cell holds them; a file a note names by its
// sha is drawn from the cloud's own route, and one pasted or dropped into the text is sent up
// there before the write that names it; a note the editor makes (an extract, a link's Create) is
// made in the open item's folder.

import { safe } from "@orpc/client";
import { BLOB_MAX_BYTES } from "@repo/contract/cloud/library/library-blobs";
import { installEditorHost } from "@repo/editor/host-io";
import type { EditorHostIo, LinkTarget } from "@repo/editor/host-io";
import { createLinkResolverFeed } from "@repo/editor/link-resolver-feed";

import { readFile, uploadFile } from "../cloud/library-files";
import type { FileCloud } from "../cloud/library-files";
import type { LibrarySocket } from "../cloud/use-library-socket";
import type { CloudWire } from "../cloud/v1";
import { newId } from "../library/new-id";

export interface PageEditorHost {
  // the item the editor shows now, whose folder a note it makes lands in; null over the library
  readonly showing: (itemId: string | null) => void;
  // every item a link can name, as the library's titles answer them
  readonly setTargets: (targets: readonly LinkTarget[]) => void;
}

export interface PageEditorPorts {
  readonly wire: Pick<CloudWire, "client">;
  readonly cloud: FileCloud;
  readonly socket: Pick<LibrarySocket, "onItems">;
  readonly openItem: (itemId: string) => void;
  readonly askAgent: (selection: string) => void;
  readonly showTag: (tag: string) => void;
}

export const installPageEditorHost = (ports: PageEditorPorts): PageEditorHost => {
  const { client } = ports.wire;
  const feed = createLinkResolverFeed();
  let showing: string | null = null;

  const itemOrNull = async (id: string) => {
    const answer = await safe(client.library.items.get({ id }));
    if (answer.isSuccess) {
      return answer.data;
    }
    if (answer.definedError?.code === "NOT_FOUND") {
      return null;
    }
    throw answer.error;
  };

  const io: EditorHostIo = {
    fileMaxBytes: BLOB_MAX_BYTES,
    keepFile: async (bytes, mime) => ({ sha: await uploadFile(ports.cloud, bytes, mime) }),
    linkResolver: feed.store,
    onItemsChanged: (listener) =>
      ports.socket.onItems((moved) => {
        listener(moved === null ? null : new Set(moved.keys()));
      }),
    openItem: ports.openItem,
    readFile: async (sha) => await readFile(ports.cloud, sha),
    readItemBlocks: async (itemId) => {
      const item = await itemOrNull(itemId);
      return item?.blocks.map(({ block }) => block) ?? null;
    },
    savesFiles: true,
  };

  installEditorHost({
    actions: {
      agent: { askAboutSelection: ports.askAgent, showTag: ports.showTag },
      items: {
        createNote: async (note) => {
          const beside = showing === null ? null : await itemOrNull(showing);
          const { item } = await client.library.items.create({
            blocks: note.blocks.map(({ block, ord }) => ({ block, ord, section: "note" })),
            folderId: beside?.fields.folderId ?? null,
            id: newId(),
            opId: crypto.randomUUID(),
            savedAt: Date.now(),
            tags: [],
            title: note.title,
          });
          return item.id;
        },
      },
    },
    io,
  });

  return {
    setTargets: feed.setTargets,
    showing: (itemId) => {
      showing = itemId;
    },
  };
};
