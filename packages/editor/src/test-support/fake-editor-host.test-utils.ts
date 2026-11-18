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

import { memoryNotes } from "./memory-notes.test-utils";
import type { MemoryNotes } from "./memory-notes.test-utils";

type HostCall =
  | { readonly action: "openItem"; readonly args: readonly [string] }
  | { readonly action: "createNote"; readonly args: readonly unknown[] }
  | { readonly action: "keepFile"; readonly args: readonly [Uint8Array, string] };

export interface FakeEditorHostOptions {
  readonly titles?: readonly LinkTarget[];
  readonly itemBlocks?: (itemId: string) => readonly LibraryBlock[] | null;
  readonly files?: ReadonlyMap<string, Blob>;
  readonly keepFile?: EditorHostIo["keepFile"];
  readonly fileMaxBytes?: number;
  readonly savesFiles?: boolean;
  readonly createNote?: ItemActions["createNote"];
  readonly agent?: AgentRequestActions;
  readonly offline?: boolean;
  readonly notes?: MemoryNotes;
}

const ignore = () => {};

const FILE_MAX_BYTES = 100 * 1024 * 1024;

export const FILES_ORIGIN = "https://files.test";

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
