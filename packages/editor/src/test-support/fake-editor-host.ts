import { createStore } from "zustand/vanilla";

import type { WikiTarget } from "@repo/notes/knowledge/link-graph-index";

import { setEditorHostIo } from "@repo/editor/host-io";
import type {
  CreateNewFileResult,
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
  // a note's bytes by path; a path it answers null for reads as missing
  readonly readVaultFile?: (path: string) => string | null;
  readonly wikiTargets?: readonly WikiTarget[];
  // a create the session refuses answers null or `refused`, as the real one does after it has said why
  readonly refuseCreates?: boolean;
  // answers the rename in place of the immediate success, so a case can hold it in flight
  readonly renameEntry?: VaultActions["renameEntry"];
  // answers the exclusive create in place of `created`, still recorded, so a case can hold it in
  // flight or find a name taken that the listing lacks
  readonly createNewFileAt?: VaultActions["createNewFileAt"];
  readonly readNoteFormulas?: EditorHostIo["readNoteFormulas"];
  // null is a host with no frame to run an html block in
  readonly htmlFrameUrl?: string | null;
  readonly pickImage?: EditorHostIo["pickImage"];
}

export const FAKE_HTML_FRAME_URL = "/html-frame-under-test";

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
    createNewFileAt: async (path, seedContent) => {
      calls.push({ action: "createNewFileAt", args: [path, seedContent] });
      if (options.createNewFileAt !== undefined) {
        return await options.createNewFileAt(path, seedContent);
      }
      const result: CreateNewFileResult =
        options.refuseCreates === true ? { kind: "refused" } : { kind: "created", path };
      return await Promise.resolve(result);
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
    targets: options.wikiTargets ?? [],
  }));

  setEditorHostIo({
    actions,
    htmlFrameUrl: options.htmlFrameUrl === undefined ? FAKE_HTML_FRAME_URL : options.htmlFrameUrl,
    linkResolver,
    onVaultChanged: () => () => {
      // the fake vault announces no change, so there is no subscription to end
    },
    pickImage: options.pickImage ?? null,
    readNoteFormulas: options.readNoteFormulas ?? (async () => await Promise.resolve(null)),
    readVaultAsset: async ({ path }) =>
      await Promise.resolve(options.readVaultAsset?.(path) ?? { error: "no assets", ok: false }),
    readVaultFile: async ({ path }) => {
      const content = options.readVaultFile?.(path) ?? null;
      return await (content === null
        ? Promise.reject(new Error(`ENOENT ${path}`))
        : Promise.resolve(content));
    },
    writeVaultAsset: async () => await Promise.reject(new Error("read-only")),
  });

  return { calls };
};
