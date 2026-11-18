// The editor's host on this page: what the editor's kits ask of the page, answered by the cell, the
// tab's moves and its store, so it is whole the moment it is installed. A note is read whole and
// saved whole over the version it was read at, a save small enough sent so it lands though the
// page closes; it follows the item's row, which the library's changes keep, and goes read-only the
// moment the browser says it has no connection. A link names its item by id, and opening it
// opens that item; an embed draws the item's blocks as the cell holds them; a file a note names by
// its sha is drawn from the cloud's own route, and one pasted or dropped into the text is sent up
// there before the edit that names it; a note the editor makes (an extract, a link's Create) lands
// in the open item's folder; "Ask the agent" quotes the passage in the panel's composer. The
// library's titles a link and the `[[` picker read reach the editor as the page's query of them
// answers.

import { readNote, saveNote } from "@repo/client/note-bodies";
import { BLOB_MAX_BYTES } from "@repo/contract/library/library-blobs";
import { isOrpcError, NotFoundError } from "@repo/contract/rpc/v1-errors";
import { installEditorHost, setLibraryTitles } from "@repo/editor/host-io";
import type { EditorHostIo } from "@repo/editor/host-io";
import { MutationObserver, onlineManager, QueryObserver } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";

import { fileUrl, readFile, uploadFile } from "../cloud/library-files";
import type { FileCloud } from "../cloud/library-files";
import { libraryQueries } from "../cloud/library-queries";
import { libraryWrites } from "../cloud/library-writes";
import type { CloudWire } from "../cloud/v1";
import type { LibraryGoes } from "../library-history";
import type { WorkspaceStore } from "../workspace-store";

interface PageEditorPorts {
  readonly wire: CloudWire;
  readonly cloud: FileCloud;
  readonly queryClient: QueryClient;
  readonly goes: Pick<LibraryGoes, "now" | "openItem" | "showScope">;
  readonly workspace: Pick<WorkspaceStore, "compose" | "revealPanel">;
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

export const installPageEditorHost = ({
  cloud,
  goes,
  queryClient,
  wire,
  workspace,
}: PageEditorPorts): void => {
  const { client, outliving } = wire;
  const queries = libraryQueries(wire);
  const makeNote = new MutationObserver(queryClient, libraryWrites({ cloud, wire }).createNote());

  const titles = new QueryObserver(queryClient, queries.titles());
  const handTitles = (): void => {
    const { data } = titles.getCurrentResult();
    if (data !== undefined) {
      setLibraryTitles(data.targets);
    }
  };
  handTitles();
  titles.subscribe(handTitles);

  const io: EditorHostIo = {
    fileMaxBytes: BLOB_MAX_BYTES,
    fileSrc: async (sha) => await Promise.resolve(fileUrl(sha)),
    keepFile: async (bytes, mime) => ({ sha: await uploadFile(cloud, bytes, mime) }),
    notes: {
      follow: (itemId, listener) => {
        const row = new QueryObserver(queryClient, queries.item(itemId));
        return row.subscribe(({ data }) => {
          if (data !== undefined) {
            listener({ deleted: data.fields.deletedAt !== null, version: data.bodyVersion });
          }
        });
      },
      reach: {
        get: () => onlineManager.isOnline(),
        subscribe: (listener) =>
          onlineManager.subscribe(() => {
            listener();
          }),
      },
      read: async (itemId) => await readNote(wire.orpc, queryClient, itemId),
      save: async (save, outlives) => await saveNote(outlives ? outliving : client, save),
    },
    openItem: (itemId) => {
      goes.openItem(itemId);
    },
    readFile: async (sha) => await readFile(cloud, sha),
    readItemBlocks: async (itemId) => {
      const item = await orNone(client.library.items.get({ id: itemId }));
      return item?.blocks.map(({ block }) => block) ?? null;
    },
  };

  installEditorHost({
    actions: {
      agent: {
        askAboutSelection: (selection) => {
          workspace.compose({ kind: "asked", passage: selection });
          workspace.revealPanel("agent");
        },
        showTag: (tag) => {
          goes.showScope({ kind: "tag", tag });
        },
      },
      items: {
        // in the folder of the item open now, whose row its view has read
        createNote: async (note) => {
          const { openItem } = goes.now();
          const beside =
            openItem === null
              ? undefined
              : queryClient.getQueryData(queries.item(openItem).queryKey);
          return await makeNote.mutate({
            into: { folderId: beside?.fields.folderId ?? null, tags: [] },
            note,
          });
        },
      },
    },
    io,
  });
};
