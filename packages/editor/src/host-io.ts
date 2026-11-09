import type { LibraryBlock } from "@repo/contract/library/library-nodes";
import type { StoreApi } from "zustand/vanilla";

// The host as a module singleton rather than context: kit factories, paste handlers and a deep
// node's click run outside React or with no route to the shell's owner, and host.ts hands
// components the same object. The shell implements these types; declaring them beside the app's
// provider would put a type edge back across the package boundary. Everything is the library's own
// key: an item by its id, a file by its bytes' sha.

// an item a link can name, as the host feeds it: its id and the title it goes by now
export interface LinkTarget {
  readonly id: string;
  readonly title: string;
}

// The resolver over the items the host feeds, so a link the editor draws reaches the item the
// library holds by that id or that title. Identity changes when the items refresh, so a link
// re-renders on that alone.
export interface LinkResolver {
  // the item a `[[…]]` names: by the id it carries (`alias`), else by the title it is written with
  resolveWikiTarget: (target: string, alias?: string) => string | null;
  // what the `[[` picker lists, in the host's order
  targets: readonly LinkTarget[];
  // the name an item goes by now, the one its card shows, so a link that names it by id shows it
  // as it is; null for an item the host does not feed
  titleOf: (itemId: string) => string | null;
}

// The read half only: the host feeds the writer (`link-resolver-feed.ts`). A store rather than a
// field because the resolver is rebuilt as the library moves while the actions never change, so
// only its readers re-render.
export type LinkResolverStore = Pick<
  StoreApi<LinkResolver>,
  "getState" | "getInitialState" | "subscribe"
>;

export interface EditorHostIo {
  readonly linkResolver: LinkResolverStore;
  // shows the item a link, an embed or a chip names
  readonly openItem: (itemId: string) => void;
  // an embedded item's blocks in reading order, as this device holds them now; null for an item it
  // holds none of, or whose body it has still to pull
  readonly readItemBlocks: (itemId: string) => Promise<readonly LibraryBlock[] | null>;
  // these items moved, or `null`: any of them may have
  readonly onItemsChanged: (listener: (ids: ReadonlySet<string> | null) => void) => () => void;
  // a file of the library by its sha, from where this device draws its files, its type the one the
  // file was kept as; rejects while the device can reach no copy of it
  readonly readFile: (sha: string) => Promise<Blob>;
  // bytes a block is about to name (a picture pasted into the text): kept on this device by their
  // sha and sent up ahead of the write that names them; rejects when they could not be kept
  readonly keepFile: (
    bytes: Uint8Array<ArrayBuffer>,
    mime: string,
  ) => Promise<{ readonly sha: string }>;
  // the most one file can be, past which the library takes none
  readonly fileMaxBytes: number;
  // whether a file card can hand a file's bytes to the system to save, as a browser tab and the
  // Mac's window can; the phone's page cannot
  readonly savesFiles: boolean;
}

export interface AgentRequestActions {
  askAboutSelection: (selectionText: string) => void;
  /** The rail shows that tag's notes. */
  showTag: (tag: string) => void;
}

// a note a host makes of blocks the editor moves out of an item: its title, and its blocks in
// reading order, each at the order key it is placed by
interface NewNote {
  readonly title: string;
  readonly blocks: readonly { readonly block: LibraryBlock; readonly ord: string }[];
}

export interface ItemActions {
  /**
   * Makes `note` in the folder of the item the editor shows, through the replica's outbox, and
   * answers its id; rejects when the note was not made.
   */
  readonly createNote: (note: NewNote) => Promise<string>;
}

// What the editor asks the shell for beyond reading the library. Every field is required, so a
// host that leaves one out fails to typecheck rather than drawing a button that does nothing.
export interface EditorHostActions {
  readonly agent: AgentRequestActions;
  readonly items: ItemActions;
}

export interface EditorHost {
  readonly io: EditorHostIo;
  readonly actions: EditorHostActions;
}

let installed: EditorHost | null = null;

// Installed once, ahead of the first render: the item the boot opens mounts hooks that read the
// host as they render. It stays installed until the next install replaces it, because an answer in
// flight when the item unmounts still reads it.
export const installEditorHost = (host: EditorHost): void => {
  installed = host;
};

const installedHost = (): EditorHost => {
  if (installed === null) {
    throw new Error("no editor host installed — the app must installEditorHost() before mounting");
  }
  return installed;
};

export const getEditorHostIo = (): EditorHostIo => installedHost().io;

export const getEditorHostActions = (): EditorHostActions => installedHost().actions;
