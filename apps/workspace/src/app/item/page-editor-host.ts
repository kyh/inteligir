// The editor's host on this page: what the editor's kits ask of the page, answered from the
// replica. A link names its item by id, which the resolver maps to the item the replica holds, and
// opening it opens that item; a highlight the chord makes is written to the open item as its own
// entry, beside the markers the editor put around the passage, which the item's next write carries.
// What the page has no door to (a file by its path, a picked image, an html block's frame)
// answers that nothing is there.

import { installEditorHost } from "@repo/editor/host-io";
import type { EditorHostIo, VaultActions } from "@repo/editor/host-io";
import { createLinkResolverFeed } from "@repo/editor/link-resolver-feed";
import type { LibraryReplica } from "@repo/library-replica/library-replica";
import type { WikiTarget } from "@repo/notes/knowledge/wiki-target";

export interface PageEditorHost {
  // the item the editor shows now, whose highlights the chord writes; null over the library
  readonly showing: (itemId: string | null) => void;
  // the library's items moved: the links' targets are read again
  readonly refreshTargets: () => void;
}

export interface PageEditorPorts {
  readonly replica: LibraryReplica;
  readonly openItem: (itemId: string) => void;
  readonly askAgent: (selection: string) => void;
  readonly showTag: (tag: string) => void;
  readonly openAnnotations: (ids: string[]) => void;
}

// an item as a link resolves it: by its id first, then by its title, under a path of its own so
// two items of one title are two targets
const targetOf = (row: { id: string; title: string }): WikiTarget => ({
  id: row.id,
  path: `${row.title.replaceAll("/", " ")}.md`,
  title: row.title,
  type: "doc",
});

const nothingToDo = (): void => {
  /* the page has no door for this */
};

const nothingThere = async (): Promise<never> => {
  await Promise.resolve();
  throw new Error("the library's page reads no file by its path");
};

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

export const installPageEditorHost = (ports: PageEditorPorts): PageEditorHost => {
  const { replica } = ports;
  const feed = createLinkResolverFeed();
  let showing: string | null = null;
  let targets: readonly WikiTarget[] = [];

  const refreshTargets = (): void => {
    const page = replica.listing({
      deleted: false,
      limit: Math.max(1, replica.scopes().total),
      offset: 0,
      sort: "title",
    });
    targets = page.items.map(targetOf);
    feed.setTargets(targets);
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
    // the item session writes on its own pause; nothing of a note's path is left to flush
    flush: async () => await Promise.resolve(true),
    openFile: (path) => {
      const itemId = targets.find((target) => target.path === path)?.id;
      if (itemId !== undefined) {
        ports.openItem(itemId);
      }
    },
    registerNoteSerializeFlush: nothingToDo,
    renameEntry: async () => await Promise.resolve(false),
  };

  const io: EditorHostIo = {
    htmlFrameUrl: null,
    linkResolver: feed.store,
    onVaultChanged: () => nothingToDo,
    opensFiles: false,
    pickImage: null,
    readNoteFormulas: async () => await Promise.resolve(null),
    readVaultAsset: async () => await Promise.resolve({ error: "no file here", ok: false }),
    readVaultFile: nothingThere,
    vault,
    writeVaultAsset: nothingThere,
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
