import { fileSha } from "@repo/contract/library/file-sha";
import type { LibraryBlock } from "@repo/contract/library/library-nodes";

import { installEditorHost, setLibraryTitles } from "@repo/editor/host-io";
import type {
  AgentRequestActions,
  EditorHostIo,
  ItemActions,
  LinkTarget,
  Reach,
} from "@repo/editor/host-io";

import { memoryNotes } from "./memory-notes";
import type { MemoryNotes } from "./memory-notes";

type HostCall =
  | { readonly action: "openItem"; readonly args: readonly [string] }
  | { readonly action: "createNote"; readonly args: readonly unknown[] }
  | { readonly action: "keepFile"; readonly args: readonly [Uint8Array, string] };

export interface FakeEditorHostOptions {
  // the library's titles, as a host hands them over
  readonly titles?: readonly LinkTarget[];
  // an item's blocks by its id, as the device holds them now; null reads as not on the device
  readonly itemBlocks?: (itemId: string) => readonly LibraryBlock[] | null;
  // the library's files by sha, which a kept file joins
  readonly files?: ReadonlyMap<string, Blob>;
  // answers a kept file in place of keeping it, still recorded, so a case can refuse it
  readonly keepFile?: EditorHostIo["keepFile"];
  readonly fileMaxBytes?: number;
  // false for a host that hands no file to the system to save, as the phone's page
  readonly savesFiles?: boolean;
  // answers a new note in place of a fresh id, still recorded, so a case can hold it in flight or
  // refuse it
  readonly createNote?: ItemActions["createNote"];
  readonly agent?: AgentRequestActions;
  // whether the host starts with no connection, which `goOffline` changes
  readonly offline?: boolean;
  // the note bodies the host reads and saves, so a case can seed one and hold it to account
  readonly notes?: MemoryNotes;
}

const ignore = (): void => {
  // the fake shell has no panel, rail or composer to answer with
};

// the library's cap, as the hosts install it
const FILE_MAX_BYTES = 100 * 1024 * 1024;

// where the fake draws a file it holds, under its sha
export const FILES_ORIGIN = "https://files.test";

// Installs the singleton the hooks read and hands the editor the library's titles; the io half
// answers from the items and files it is handed, keeps a file by its real sha and then draws it
// under `FILES_ORIGIN` (refusing one with no type, as the hosts do), reads and saves a note's body
// in `notes`, the shell hears every other ask as nothing, and an open, a new note and a kept file
// are recorded in `calls`. `goOffline` says the connection went or came back.
export const installFakeEditorHost = (options: FakeEditorHostOptions = {}) => {
  const calls: HostCall[] = [];
  const files = new Map(options.files);
  const reachListeners = new Set<() => void>();
  let offline = options.offline ?? false;
  let made = 0;
  const notes = options.notes ?? memoryNotes();
  const reach: Reach = {
    get: () => !offline,
    subscribe: (listener) => {
      reachListeners.add(listener);
      return () => {
        reachListeners.delete(listener);
      };
    },
  };

  const items: ItemActions = {
    createNote: async (note) => {
      calls.push({ action: "createNote", args: [note] });
      if (options.createNote !== undefined) {
        return await options.createNote(note);
      }
      made += 1;
      return await Promise.resolve(`note-${String(made)}`);
    },
  };

  setLibraryTitles(options.titles ?? []);
  const io: EditorHostIo = {
    fileMaxBytes: options.fileMaxBytes ?? FILE_MAX_BYTES,
    keepFile: async (bytes, mime) => {
      calls.push({ action: "keepFile", args: [bytes, mime] });
      if (options.keepFile !== undefined) {
        return await options.keepFile(bytes, mime);
      }
      // as the hosts do, which keep no file without a type
      if (mime === "") {
        return await Promise.reject(new Error("a file is kept under a type"));
      }
      const sha = fileSha(bytes);
      files.set(sha, new Blob([bytes], { type: mime }));
      return await Promise.resolve({ sha });
    },
    openItem: (itemId) => {
      calls.push({ action: "openItem", args: [itemId] });
    },
    fileSrc: async (sha) =>
      await (files.has(sha)
        ? Promise.resolve(`${FILES_ORIGIN}/${sha}`)
        : Promise.reject(new Error(`no file ${sha}`))),
    readFile:
      options.savesFiles === false
        ? null
        : async (sha) => {
            const file = files.get(sha);
            return await (file === undefined
              ? Promise.reject(new Error(`no file ${sha}`))
              : Promise.resolve(file));
          },
    notes: notes.host(reach),
    readItemBlocks: async (itemId) => await Promise.resolve(options.itemBlocks?.(itemId) ?? null),
  };

  installEditorHost({
    actions: {
      agent: options.agent ?? { askAboutSelection: ignore, showTag: ignore },
      items,
    },
    io,
  });

  return {
    calls,
    files,
    notes,
    goOffline: (next: boolean) => {
      offline = next;
      for (const listener of reachListeners) {
        listener();
      }
    },
  };
};
