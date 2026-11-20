import { titleKey } from "@repo/contract/library/derive-item";
import type { HeldNote, NoteSave, NoteSaved } from "@repo/contract/library/held-note";
import type { LibraryBlock } from "@repo/contract/library/library-nodes";
import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";

import { foldTitle } from "@repo/editor/mention/rank-titles";
import type { FoldedTitle } from "@repo/editor/mention/rank-titles";

export interface LinkTarget {
  readonly id: string;
  readonly title: string;
}

export interface LibraryTitles {
  readonly targets: readonly (LinkTarget & FoldedTitle)[];
  readonly byId: ReadonlyMap<string, string>;
  readonly byKey: ReadonlyMap<string, LinkTarget | null>;
}

const titles = createStore<LibraryTitles>()(() => ({
  byId: new Map(),
  byKey: new Map(),
  targets: [],
}));

export const libraryTitles: Pick<
  StoreApi<LibraryTitles>,
  "getState" | "getInitialState" | "subscribe"
> = titles;

export const setLibraryTitles = (targets: readonly LinkTarget[]) => {
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
  readonly openItem: (itemId: string) => void;
  readonly readItemBlocks: (itemId: string) => Promise<readonly LibraryBlock[] | null>;
  readonly fileSrc: (sha: string) => Promise<string>;
  readonly readFile: ((sha: string) => Promise<Blob>) | null;
  readonly keepFile: (
    bytes: Uint8Array<ArrayBuffer>,
    mime: string,
  ) => Promise<{ readonly sha: string }>;
  readonly fileMaxBytes: number;
  readonly notes: NoteHost;
}

export interface Reach {
  readonly get: () => boolean;
  readonly subscribe: (listener: () => void) => () => void;
}

export interface NoteStanding {
  readonly version: number;
  readonly deleted: boolean;
}

export interface NoteHost {
  readonly read: (itemId: string) => Promise<HeldNote | null>;
  readonly save: (save: NoteSave, outlives: boolean) => Promise<NoteSaved>;
  readonly follow: (itemId: string, listener: (standing: NoteStanding) => void) => () => void;
  readonly reach: Reach;
}

interface AgentRequestActions {
  askAboutSelection: (selectionText: string) => void;
}

interface NewNote {
  readonly title: string;
  readonly blocks: readonly LibraryBlock[];
}

export interface ItemActions {
  readonly createNote: (note: NewNote) => Promise<string>;
  readonly showTag: (tag: string) => void;
}

export interface EditorHostActions {
  readonly agent: AgentRequestActions;
  readonly items: ItemActions;
}

export interface EditorHost {
  readonly io: EditorHostIo;
  readonly actions: EditorHostActions;
}

let installed: EditorHost | null = null;

export const installEditorHost = (host: EditorHost) => {
  installed = host;
};

const installedHost = () => {
  if (installed === null) {
    throw new Error("no editor host installed — the app must installEditorHost() before mounting");
  }

  return installed;
};

export const getEditorHostIo = () => installedHost().io;

export const getEditorHostActions = () => installedHost().actions;
