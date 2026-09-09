import { createStore } from "zustand/vanilla";

import type { WikiTarget } from "@repo/notes/knowledge/link-graph-index";

import { setEditorHostIo } from "@repo/editor/host-io";
import type { VaultActions, WikiResolver } from "@repo/editor/host-io";

export interface HostCall {
  readonly action: keyof VaultActions;
  readonly args: readonly unknown[];
}

export interface FakeEditorHostOptions {
  readonly resolveWikiTarget?: (target: string) => string | null;
  readonly wikiTargets?: readonly WikiTarget[];
  // a create the session refuses answers null, as the real one does after it has said why
  readonly refuseCreates?: boolean;
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
    refreshVault: recordVoid("refreshVault"),
    registerNoteSerializeFlush: recordVoid("registerNoteSerializeFlush"),
    renameEntry: record("renameEntry", Promise.resolve(true)),
  };

  const wikiResolver = createStore<WikiResolver>()(() => ({
    resolveWikiTarget: options.resolveWikiTarget ?? (() => null),
  }));

  setEditorHostIo({
    actions,
    getBacklinks: async () => await Promise.resolve([]),
    getForwardLinks: async () => await Promise.resolve([]),
    listWikiTargets: async () => await Promise.resolve([...(options.wikiTargets ?? [])]),
    onKnowledgeUpdated: () => () => {},
    onVaultChanged: () => () => {},
    readNoteFormulas: async () => await Promise.resolve(null),
    readVaultAsset: async () => await Promise.resolve({ error: "no assets", ok: false }),
    readVaultFile: async ({ path }) => await Promise.reject(new Error(`ENOENT ${path}`)),
    wikiResolver,
    writeVaultAsset: async () => await Promise.reject(new Error("read-only")),
  });

  return { calls };
};
