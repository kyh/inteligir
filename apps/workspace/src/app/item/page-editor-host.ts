// The editor's host on this page: what the editor's kits ask of the page, answered from the
// replica. A link names its item by id, which the resolver maps to the item the replica holds, and
// opening it opens that item; an embed draws the item's blocks as the replica holds them; a file
// a note names by its sha is drawn from where the page draws its files (the cloud's own route in
// the tab, the shell's scheme on the Mac), and one pasted or dropped into the text is kept in the
// replica's outbox, which sends it up ahead of the write that names it; a highlight the chord
// makes is written to the open item as its own entry, beside the markers the editor put around the
// passage, which the item's next write carries; a note the editor makes (an extract, a link's
// Create) is made in that item's folder.

import { BLOB_MAX_BYTES } from "@repo/contract/cloud/library/library-blobs";
import { installEditorHost } from "@repo/editor/host-io";
import type { EditorHostIo, LinkTarget } from "@repo/editor/host-io";
import { createLinkResolverFeed } from "@repo/editor/link-resolver-feed";
import type { LibraryReplica } from "@repo/library-replica/library-replica";

export interface PageEditorHost {
  // the item the editor shows now, whose highlights the chord writes; null over the library
  readonly showing: (itemId: string | null) => void;
  // the library's items moved: the links' targets are read again
  readonly refreshTargets: () => void;
}

export interface PageEditorPorts {
  readonly replica: LibraryReplica;
  // a file of the library as the page's host draws it
  readonly readFile: (sha: string) => Promise<Blob>;
  readonly openItem: (itemId: string) => void;
  readonly askAgent: (selection: string) => void;
  readonly showTag: (tag: string) => void;
  readonly openAnnotations: (ids: string[]) => void;
}

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

export const installPageEditorHost = (ports: PageEditorPorts): PageEditorHost => {
  const { replica } = ports;
  const feed = createLinkResolverFeed();
  let showing: string | null = null;

  // every live item a link can name, by its id and the title its card shows
  const refreshTargets = (): void => {
    const page = replica.listing({
      deleted: false,
      limit: Math.max(1, replica.scopes().total),
      offset: 0,
      sort: "title",
    });
    feed.setTargets(page.items.map(({ id, title }): LinkTarget => ({ id, title })));
  };

  const io: EditorHostIo = {
    fileMaxBytes: BLOB_MAX_BYTES,
    keepFile: async (bytes, mime) => await replica.keepFile({ bytes, mime }),
    linkResolver: feed.store,
    onItemsChanged: (listener) =>
      replica.onChange((change) => {
        listener(change.reset ? null : change.ids);
      }),
    openItem: ports.openItem,
    readFile: ports.readFile,
    // none while the item's body is still to come, as the open item waits for it, so an embed
    // never draws a note this device has not pulled as an empty one
    readItemBlocks: async (itemId) => {
      const item = await replica.item(itemId);
      return item?.bodyHeld === true ? item.blocks.map(({ block }) => block) : null;
    },
    savesFiles: true,
  };

  installEditorHost({
    actions: {
      agent: { askAboutSelection: ports.askAgent, showTag: ports.showTag },
      annotations: {
        create: async (id, quote) => {
          if (showing === null) {
            return false;
          }
          const outcome = await replica.write(showing, {
            annotations: [
              {
                createdAt: nowSeconds(),
                id,
                occurrence: null,
                op: "add",
                parentId: null,
                quote,
                text: "",
              },
            ],
            ops: [],
          });
          return outcome.kind === "queued" || outcome.kind === "unchanged";
        },
        edit: async (id, text) => {
          if (showing === null) {
            return false;
          }
          const store = await replica.annotations(showing);
          const held = store[id];
          if (held === undefined) {
            return false;
          }
          const outcome = await replica.write(showing, {
            annotations: [{ base: held.text, id, op: "note", text }],
            ops: [],
          });
          return outcome.kind === "queued" || outcome.kind === "unchanged";
        },
        open: ports.openAnnotations,
      },
      items: {
        createNote: async (note) => {
          const beside = showing === null ? null : await replica.item(showing);
          const made = await replica.createNote({
            blocks: note.blocks.map(({ block, ord }) => ({ block, ord, section: "note" })),
            folderId: beside?.fields.folderId ?? null,
            tags: [],
            title: note.title,
          });
          return made.id;
        },
      },
    },
    io,
  });

  refreshTargets();
  return {
    refreshTargets,
    showing: (itemId) => {
      showing = itemId;
    },
  };
};
