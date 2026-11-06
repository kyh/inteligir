// The editor's host on this page: what the editor's kits ask of the page, answered from the
// replica. A link names its item by id, which the resolver maps to the item the replica holds, and
// opening it opens that item; a highlight the chord makes is written to the open item as its own
// entry, beside the markers the editor put around the passage, which the item's next write
// carries; a note the editor makes (an extract, a link's Create) is made in that item's folder.
// What the page has no door to (a file inside a note) answers that nothing is there.

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
    openFile: (path) => {
      const itemId = targets.find((target) => target.path === path)?.id;
      if (itemId !== undefined) {
        ports.openItem(itemId);
      }
    },
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
          const made = await replica.createNote({
            blocks: note.blocks.map(({ block, ord }) => ({ block, ord, section: "note" })),
            folderId: showing === null ? null : (replica.row(showing)?.fields.folderId ?? null),
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
