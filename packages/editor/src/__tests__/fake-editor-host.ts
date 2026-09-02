import type { VaultEntry } from "@repo/editor/host-io";
import type { EditorHost, VaultActions } from "@repo/editor/host";

export type HostCall = { readonly action: keyof VaultActions; readonly args: readonly unknown[] };

export type FakeEditorHostOptions = {
  readonly resolveWikiTarget?: (target: string) => string | null;
  readonly entries?: VaultEntry[];
  readonly folderName?: string;
};

export type FakeEditorHost = { readonly host: EditorHost; readonly calls: HostCall[] };

export function fakeEditorHost(options: FakeEditorHostOptions = {}): FakeEditorHost {
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

  return {
    calls,
    host: {
      actions,
      listing: {
        entries: options.entries ?? [],
        folderName: options.folderName ?? "vault",
        resolveWikiTarget: options.resolveWikiTarget ?? (() => null),
      },
    },
  };
}
