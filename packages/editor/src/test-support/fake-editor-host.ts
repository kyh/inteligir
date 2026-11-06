import { createStore } from "zustand/vanilla";

import type { WikiTarget } from "@repo/notes/knowledge/wiki-target";

import { installEditorHost } from "@repo/editor/host-io";
import type {
  AgentRequestActions,
  AnnotationActions,
  EditorHostIo,
  ItemActions,
  LinkResolver,
  ReadVaultAssetResult,
  VaultActions,
} from "@repo/editor/host-io";

interface HostCall {
  readonly action: keyof VaultActions | keyof ItemActions;
  readonly args: readonly unknown[];
}

/** @internal */
export interface FakeEditorHostOptions {
  readonly resolveWikiTarget?: (target: string) => string | null;
  readonly resolveMdTarget?: (target: string, fromPath: string) => string | null;
  readonly readVaultAsset?: (path: string) => ReadVaultAssetResult;
  // a note's bytes by path; a path it answers null for reads as missing
  readonly readVaultFile?: (path: string) => string | null;
  readonly wikiTargets?: readonly WikiTarget[];
  // answers a new note in place of a fresh id, still recorded, so a case can hold it in flight or
  // refuse it
  readonly createNote?: ItemActions["createNote"];
  readonly opensFiles?: boolean;
  readonly annotations?: AnnotationActions;
  readonly agent?: AgentRequestActions;
}

const ignore = (): void => {
  // the fake shell has no panel, rail or composer to answer with
};

// Installs the singleton the hooks read; the io half answers as an empty, read-only library, a new
// note is made under a fresh id, the shell refuses every annotation and hears every other ask as
// nothing, and an open or a new note is recorded in `calls`.
/** @internal */
export const installFakeEditorHost = (options: FakeEditorHostOptions = {}) => {
  const calls: HostCall[] = [];
  let made = 0;

  const vault: VaultActions = {
    openFile: (path) => {
      calls.push({ action: "openFile", args: [path] });
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

  const linkResolver = createStore<LinkResolver>()(() => ({
    resolveMdTarget: options.resolveMdTarget ?? (() => null),
    resolveWikiTarget: options.resolveWikiTarget ?? (() => null),
    targets: options.wikiTargets ?? [],
    titleOf: (itemId) =>
      (options.wikiTargets ?? []).find((target) => target.id === itemId)?.title ?? null,
  }));

  const io: EditorHostIo = {
    linkResolver,
    onVaultChanged: () => () => {
      // the fake vault announces no change, so there is no subscription to end
    },
    opensFiles: options.opensFiles ?? false,
    readVaultAsset: async ({ path }) =>
      await Promise.resolve(options.readVaultAsset?.(path) ?? { error: "no assets", ok: false }),
    readVaultFile: async ({ path }) => {
      const content = options.readVaultFile?.(path) ?? null;
      return await (content === null
        ? Promise.reject(new Error(`ENOENT ${path}`))
        : Promise.resolve(content));
    },
    vault,
  };

  installEditorHost({
    actions: {
      agent: options.agent ?? { askAboutSelection: ignore, showTag: ignore },
      annotations: options.annotations ?? {
        create: async () => await Promise.resolve(false),
        edit: async () => await Promise.resolve(false),
        open: ignore,
      },
      items,
    },
    io,
  });

  return { calls };
};
