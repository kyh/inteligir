import { createStore } from "zustand/vanilla";

import { setEditorHostIo, type VaultActions, type WikiResolver } from "@repo/editor/host-io";

export type HostCall = { readonly action: keyof VaultActions; readonly args: readonly unknown[] };

export type FakeEditorHostOptions = {
  readonly resolveWikiTarget?: (target: string) => string | null;
};

// Installs the singleton the hooks read; the io half answers as an empty, read-only vault.
export function installFakeEditorHost(options: FakeEditorHostOptions = {}) {
  const calls: HostCall[] = [];
  const record =
    <T>(action: keyof VaultActions, answer: T) =>
    (...args: readonly unknown[]): T => {
      calls.push({ action, args });
      return answer;
    };

  const actions: VaultActions = {
    openFile: record("openFile", undefined),
    editNote: record("editNote", undefined),
    registerNoteSerializeFlush: record("registerNoteSerializeFlush", undefined),
    createFile: record("createFile", Promise.resolve()),
    createFileAt: (path) => {
      calls.push({ action: "createFileAt", args: [path] });
      return Promise.resolve(path);
    },
    renameEntry: record("renameEntry", Promise.resolve(true)),
    deleteEntry: record("deleteEntry", Promise.resolve()),
    flush: record("flush", Promise.resolve(true)),
    refreshVault: record("refreshVault", undefined),
  };

  const wikiResolver = createStore<WikiResolver>()(() => ({
    resolveWikiTarget: options.resolveWikiTarget ?? (() => null),
  }));

  setEditorHostIo({
    actions,
    wikiResolver,
    readVaultFile: ({ path }) => Promise.reject(new Error(`ENOENT ${path}`)),
    readVaultAsset: () => Promise.resolve({ ok: false, error: "no assets" }),
    writeVaultAsset: () => Promise.reject(new Error("read-only")),
    listWikiTargets: () => Promise.resolve([]),
    getBacklinks: () => Promise.resolve([]),
    readNoteFormulas: () => Promise.resolve(null),
    getForwardLinks: () => Promise.resolve([]),
    onVaultChanged: () => () => {},
    onKnowledgeUpdated: () => () => {},
  });

  return { calls };
}
