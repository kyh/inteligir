// The editor's host on this page: what the editor's kits ask of the page, answered by the cell. A
// note's live document is dialled on the cloud's origin, the page's own, on the account socket's
// ticket, and goes read-only the moment the browser says it has no connection. A link names its
// item by id, and opening it opens that item; an embed draws the item's blocks as the cell holds
// them; a file a note names by its sha is drawn from the cloud's own route, and one pasted or
// dropped into the text is sent up there before the edit that names it; a note the editor makes (an
// extract, a link's Create) is the page's to make, in the open item's folder. The library's titles a
// link and the `[[` picker read reach the editor from the page's own query of them.

import { BLOB_MAX_BYTES } from "@repo/contract/library/library-blobs";
import { isOrpcError, NotFoundError } from "@repo/contract/v1/errors";
import { notePath } from "@repo/contract/library/library-socket";
import { installEditorHost } from "@repo/editor/host-io";
import type { EditorHostIo, ItemActions } from "@repo/editor/host-io";
import { onlineManager } from "@tanstack/react-query";

import { readFile, uploadFile } from "../cloud/library-files";
import type { FileCloud } from "../cloud/library-files";
import type { LibrarySocket } from "@repo/client/library-cache";
import type { CloudWire } from "../cloud/v1";

// what a link, Ask the agent, a tag and a note the editor makes do on the page
interface PageEditorActions {
  readonly openItem: (itemId: string) => void;
  readonly askAgent: (selection: string) => void;
  readonly showTag: (tag: string) => void;
  readonly createNote: ItemActions["createNote"];
}

interface PageEditorHost {
  // the host is installed before an open item first renders, which is before the workspace's
  // effects can hand it these; until they are bound, a press does nothing and no note is made
  readonly bind: (actions: PageEditorActions | null) => void;
}

interface PageEditorPorts {
  readonly wire: Pick<CloudWire, "client">;
  readonly cloud: FileCloud;
  readonly socket: Pick<LibrarySocket, "onItems">;
}

// a read the cell answers NOT_FOUND for is no item, and any other refusal is the read's failure
const orNone = async <T>(read: Promise<T>): Promise<T | null> => {
  try {
    return await read;
  } catch (error) {
    if (isOrpcError(error) && error.code === NotFoundError.code) {
      return null;
    }
    throw error;
  }
};

export const installPageEditorHost = (ports: PageEditorPorts): PageEditorHost => {
  const { client } = ports.wire;
  let actions: PageEditorActions | null = null;

  const io: EditorHostIo = {
    fileMaxBytes: BLOB_MAX_BYTES,
    keepFile: async (bytes, mime) => ({ sha: await uploadFile(ports.cloud, bytes, mime) }),
    notes: {
      notePath,
      offline: () => !onlineManager.isOnline(),
      onOfflineChange: (listener) =>
        onlineManager.subscribe(() => {
          listener();
        }),
      socketOrigin: ports.cloud.origin,
      socketTicket: async () => {
        const { ticket } = await client.account.socketTicket();
        return ticket;
      },
    },
    onItemsChanged: ports.socket.onItems,
    openItem: (itemId) => {
      actions?.openItem(itemId);
    },
    readFile: async (sha) => await readFile(ports.cloud, sha),
    readItemBlocks: async (itemId) => {
      const item = await orNone(client.library.items.get({ id: itemId }));
      return item?.blocks.map(({ block }) => block) ?? null;
    },
    savesFiles: true,
  };

  installEditorHost({
    actions: {
      agent: {
        askAboutSelection: (selection) => {
          actions?.askAgent(selection);
        },
        showTag: (tag) => {
          actions?.showTag(tag);
        },
      },
      items: {
        createNote: async (note) => {
          if (actions === null) {
            throw new Error("The note couldn't be made.");
          }
          return await actions.createNote(note);
        },
      },
    },
    io,
  });

  return {
    bind: (next) => {
      actions = next;
    },
  };
};
