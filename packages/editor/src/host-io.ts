import { titleKey } from "@repo/contract/library/derive-item";
import type { HeldNote, NoteSave, NoteSaved } from "@repo/contract/library/held-note";
import type { LibraryBlock } from "@repo/contract/library/library-nodes";
import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";

import { foldTitle } from "@repo/editor/mention/rank-titles";
import type { FoldedTitle } from "@repo/editor/mention/rank-titles";

// The host as a module singleton rather than context: kit factories, paste handlers and a deep
// node's click run outside React or with no route to the shell's owner, and host.ts hands
// components the same object. The shell implements these types; declaring them beside the app's
// provider would put a type edge back across the package boundary. Everything is the library's own
// key: an item by its id, a file by its bytes' sha.

// an item as an item link names it, from the library's titles: its id and the title it goes by now
export interface LinkTarget {
  readonly id: string;
  readonly title: string;
}

export interface LibraryTitles {
  // in the library's order, which the `[[` picker ranks within
  readonly targets: readonly (LinkTarget & FoldedTitle)[];
  // the name an item goes by now, the one its card shows
  readonly byId: ReadonlyMap<string, string>;
  // the item words name by `titleKey`, and null for words two or more items go by, which the
  // library's own `[[Title]]` leaves as text; an untitled one goes by none
  readonly byKey: ReadonlyMap<string, LinkTarget | null>;
}

// Beside the host rather than in it: the titles move with the library while the host never
// changes, so only an item link and the picker re-render, and the titles outlive a host installed
// again. Each keystroke in the picker reads them, so every key and fold is made once per listing.
const titles = createStore<LibraryTitles>()(() => ({
  byId: new Map(),
  byKey: new Map(),
  targets: [],
}));

export const libraryTitles: Pick<
  StoreApi<LibraryTitles>,
  "getState" | "getInitialState" | "subscribe"
> = titles;

// what a host hands the editor each time its listing of the library's titles answers
export const setLibraryTitles = (targets: readonly LinkTarget[]): void => {
  const byKey = new Map<string, LinkTarget | null>();
  for (const target of targets) {
    const key = titleKey(target.title);
    if (key !== "") {
      byKey.set(key, byKey.has(key) ? null : target);
    }
  }
  titles.setState({
    byId: new Map(targets.map((target) => [target.id, target.title])),
    byKey,
    targets: targets.map((target) => ({ ...target, folded: foldTitle(target.title) })),
  });
};

export interface EditorHostIo {
  // shows the item a link, an embed or a chip names
  readonly openItem: (itemId: string) => void;
  // an item's blocks in reading order, as the library holds them now; null for an item the library
  // holds none of
  readonly readItemBlocks: (itemId: string) => Promise<readonly LibraryBlock[] | null>;
  // where an <img> or a <video> loads a file of the library by its sha: the cloud's own address
  // where the page reaches it, or one of the page's own over bytes the device holds; rejects while
  // the device can reach no copy of it
  readonly fileSrc: (sha: string) => Promise<string>;
  // a file's bytes whole, for a file card's Download, where the host can hand a file to the system
  // to save, as a browser tab and the Mac's window can; null where it cannot, as on the phone
  readonly readFile: ((sha: string) => Promise<Blob>) | null;
  // bytes a block is about to name (a picture pasted into the text): kept on this device by their
  // sha and sent up ahead of the write that names them; rejects when they could not be kept
  readonly keepFile: (
    bytes: Uint8Array<ArrayBuffer>,
    mime: string,
  ) => Promise<{ readonly sha: string }>;
  // the most one file can be, past which the library takes none
  readonly fileMaxBytes: number;
  readonly notes: NoteHost;
}

// whether the host can reach the cloud, and a listener told each time that changes: the network
// alone, on the phone too, where going behind must not stop the hidden flush
export interface Reach {
  readonly get: () => boolean;
  readonly subscribe: (listener: () => void) => () => void;
}

// what the library says of an open note as it learns of a change: its body's version, and Deleted
export interface NoteStanding {
  readonly version: number;
  readonly deleted: boolean;
}

// How an open note is read and saved whole (`item/note-save.ts`).
export interface NoteHost {
  // the note as the library holds it, or as the device last read it while it reaches no cloud;
  // null for an item that is gone; rejects when neither answers
  readonly read: (itemId: string) => Promise<HeldNote | null>;
  // `outlives`: the save is small enough to be sent so it lands though the page goes away; rejects
  // when the network failed it, which is tried again
  readonly save: (save: NoteSave, outlives: boolean) => Promise<NoteSaved>;
  // tells `listener` each time the library learns the note moved, until the stop it answers
  readonly follow: (itemId: string, listener: (standing: NoteStanding) => void) => () => void;
  // the host's own word on whether it reaches the cloud, which turns an open note read-only at once
  readonly reach: Reach;
}

export interface AgentRequestActions {
  askAboutSelection: (selectionText: string) => void;
  /** The rail shows that tag's notes. */
  showTag: (tag: string) => void;
}

// a note a host makes of blocks the editor moves out of an item: its title, and its blocks in
// reading order, all of them the person's writing
interface NewNote {
  readonly title: string;
  readonly blocks: readonly LibraryBlock[];
}

export interface ItemActions {
  // makes `note` in the folder of the item the editor shows and answers its id; rejects when the
  // note was not made
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
