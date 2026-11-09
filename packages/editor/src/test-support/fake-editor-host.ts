import { fileSha } from "@repo/contract/library/file-sha";
import type { LibraryBlock } from "@repo/contract/library/library-nodes";

import { installEditorHost } from "@repo/editor/host-io";
import type {
  AgentRequestActions,
  EditorHostIo,
  ItemActions,
  LinkTarget,
} from "@repo/editor/host-io";
import { createLinkResolverFeed } from "@repo/editor/link-resolver-feed";

type HostCall =
  | { readonly action: "openItem"; readonly args: readonly [string] }
  | { readonly action: "createNote"; readonly args: readonly unknown[] }
  | { readonly action: "keepFile"; readonly args: readonly [Uint8Array, string] };

/** @internal */
export interface FakeEditorHostOptions {
  // the items a link can name, resolved as a host's feed resolves them
  readonly linkTargets?: readonly LinkTarget[];
  // an item's blocks by its id, as the device holds them now; null reads as not on the device
  readonly itemBlocks?: (itemId: string) => readonly LibraryBlock[] | null;
  // the library's files by sha, which a kept file joins
  readonly files?: ReadonlyMap<string, Blob>;
  // answers a kept file in place of keeping it, still recorded, so a case can refuse it
  readonly keepFile?: EditorHostIo["keepFile"];
  readonly fileMaxBytes?: number;
  readonly savesFiles?: boolean;
  // answers a new note in place of a fresh id, still recorded, so a case can hold it in flight or
  // refuse it
  readonly createNote?: ItemActions["createNote"];
  readonly agent?: AgentRequestActions;
}

const ignore = (): void => {
  // the fake shell has no panel, rail or composer to answer with
};

// the library's cap, as the hosts install it
const FILE_MAX_BYTES = 100 * 1024 * 1024;

// Installs the singleton the hooks read; the io half answers from the items and files it is
// handed, keeps a file by its real sha and then draws it (refusing one with no type, as the hosts
// do), the shell hears every other ask as nothing, and an open, a new note and a kept file are
// recorded in `calls`. `changed` says items moved, as a host's change
// feed does.
/** @internal */
export const installFakeEditorHost = (options: FakeEditorHostOptions = {}) => {
  const calls: HostCall[] = [];
  const files = new Map(options.files);
  const listeners = new Set<(ids: ReadonlySet<string> | null) => void>();
  let made = 0;

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

  const feed = createLinkResolverFeed();
  feed.setTargets(options.linkTargets ?? []);
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
    linkResolver: feed.store,
    onItemsChanged: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    openItem: (itemId) => {
      calls.push({ action: "openItem", args: [itemId] });
    },
    readFile: async (sha) => {
      const file = files.get(sha);
      return await (file === undefined
        ? Promise.reject(new Error(`no file ${sha}`))
        : Promise.resolve(file));
    },
    readItemBlocks: async (itemId) => await Promise.resolve(options.itemBlocks?.(itemId) ?? null),
    savesFiles: options.savesFiles ?? true,
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
    changed: (ids: ReadonlySet<string> | null) => {
      for (const listener of listeners) {
        listener(ids);
      }
    },
    files,
  };
};
