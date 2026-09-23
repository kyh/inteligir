import { createStore } from "zustand/vanilla";

import type { WikiTarget } from "@repo/notes/knowledge/link-graph-index";

import { setEditorHostIo } from "@repo/editor/host-io";
import type {
  EditorHostIo,
  LinkResolver,
  ReadVaultAssetResult,
  VaultActions,
} from "@repo/editor/host-io";

export interface HostCall {
  readonly action: keyof VaultActions;
  readonly args: readonly unknown[];
}

export interface FakeEditorHostOptions {
  readonly resolveWikiTarget?: (target: string) => string | null;
  readonly resolveMdTarget?: (target: string, fromPath: string) => string | null;
  readonly readVaultAsset?: (path: string) => ReadVaultAssetResult;
  readonly wikiTargets?: readonly WikiTarget[];
  // a create the session refuses answers null, as the real one does after it has said why
  readonly refuseCreates?: boolean;
  // answers the rename in place of the immediate success, so a case can hold it in flight
  readonly renameEntry?: VaultActions["renameEntry"];
  readonly readNoteFormulas?: EditorHostIo["readNoteFormulas"];
}

// Installs the singleton the hooks read; the io half answers as an empty, read-only vault.
export const installFakeEditorHost = (options: FakeEditorHostOptions = {}) => {
  const calls: HostCall[] = [];
  const record =
    <T>(action: keyof VaultActions, answer: T) =>
    (...args: readonly unknown[]): T => {
      calls.push({ action, args });
      return answer;
    };
  const recordVoid =
    (action: keyof VaultActions) =>
    (...args: readonly unknown[]): void => {
      calls.push({ action, args });
    };

  const actions: VaultActions = {
    createFile: record("createFile", Promise.resolve()),
    createFileAt: async (path, seedContent) => {
      calls.push({ action: "createFileAt", args: [path, seedContent] });
      return await Promise.resolve(options.refuseCreates === true ? null : path);
    },
    deleteEntry: record("deleteEntry", Promise.resolve()),
    editNote: recordVoid("editNote"),
    flush: record("flush", Promise.resolve(true)),
    openFile: recordVoid("openFile"),
    registerNoteSerializeFlush: recordVoid("registerNoteSerializeFlush"),
    renameEntry: options.renameEntry ?? record("renameEntry", Promise.resolve(true)),
  };

  const linkResolver = createStore<LinkResolver>()(() => ({
    resolveMdTarget: options.resolveMdTarget ?? (() => null),
    resolveWikiTarget: options.resolveWikiTarget ?? (() => null),
  }));

  setEditorHostIo({
    actions,
    getBacklinks: async () => await Promise.resolve([]),
    linkResolver,
    listWikiTargets: async () => await Promise.resolve([...(options.wikiTargets ?? [])]),
    onVaultChanged: () => () => {},
    readNoteFormulas: options.readNoteFormulas ?? (async () => await Promise.resolve(null)),
    readVaultAsset: async ({ path }) =>
      await Promise.resolve(options.readVaultAsset?.(path) ?? { error: "no assets", ok: false }),
    readVaultFile: async ({ path }) => await Promise.reject(new Error(`ENOENT ${path}`)),
    writeVaultAsset: async () => await Promise.reject(new Error("read-only")),
  });

  return { calls };
};
