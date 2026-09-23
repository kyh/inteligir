import type { CollectedFormula } from "@repo/notes/formulas/collect-formulas";
import type { BacklinkEntry, WikiTarget } from "@repo/notes/knowledge/link-graph-index";
import type { StoreApi } from "zustand/vanilla";

// The host as a module singleton rather than context: kit factories and paste handlers run
// outside React, and host.ts hands components the same object. The shell implements these
// types; declaring them beside the app's provider would put a type edge back across the
// package boundary.

export interface VaultEntry {
  path: string;
  name: string;
  kind: "doc" | "other";
}

export interface VaultActions {
  /** A failed flush of the current note refuses to navigate. */
  openFile: (path: string) => void;
  /** Keyed by path: a teardown or surface switch can emit after the open note changed, and those bytes must no-op. */
  editNote: (path: string, content: string) => void;
  /** Drains the serialize debounce before a save/rename/delete; keyed by path for the same reason as editNote. */
  registerNoteSerializeFlush: (path: string, flush: () => void) => void;
  /** Open-or-create: an existing file opens untouched, so templates and daily notes can re-run it. */
  createFile: (path: string, content?: string) => Promise<void>;
  /** Creates without opening; an existing file counts as success. */
  createFileAt: (path: string, seedContent?: string) => Promise<string | null>;
  renameEntry: (from: string, to: string) => Promise<boolean>;
  deleteEntry: (path: string) => Promise<void>;
  flush: () => Promise<boolean>;
}

export interface WikiResolver {
  /** Identity changes when the listing or aliases refresh, so chips re-render on that alone. */
  resolveWikiTarget: (target: string, alias?: string) => string | null;
}

// The read half only: the app owns the writer. A store rather than a field because the resolver
// is rebuilt on every vault refresh while the actions never change, so only its readers re-render.
export type WikiResolverStore = Pick<
  StoreApi<WikiResolver>,
  "getState" | "getInitialState" | "subscribe"
>;

// A Blob, not base64: the asset route already answers the media type, and re-deriving it from the extension is a second allowlist.
export type ReadVaultAssetResult = { ok: true; bytes: Blob } | { ok: false; error: string };

export type DeleteVaultEntryResult =
  | { readonly outcome: "removed" }
  | { readonly outcome: "absent" };

// `files` moved a listing row (a create, rename, delete or a change the watcher saw), and
// `paths: null` is one nobody could attribute, so every reader re-checks; `content` rewrote one
// file in place and moved no row.
export type VaultChangedEvent =
  | { readonly kind: "files"; readonly paths: readonly string[] | null }
  | { readonly kind: "content"; readonly path: string };

export const vaultChangeTouches = (event: VaultChangedEvent, path: string): boolean =>
  event.kind === "files" ? event.paths === null || event.paths.includes(path) : event.path === path;

export interface EditorHostIo {
  actions: VaultActions;
  wikiResolver: WikiResolverStore;
  readVaultFile: (payload: { path: string }) => Promise<string>;
  readVaultAsset: (payload: { path: string }) => Promise<ReadVaultAssetResult>;
  /** Picks a collision-free name from `baseName`; the host decides the folder from the vault's attachments choice and the open note. */
  writeVaultAsset: (payload: { baseName: string; file: Blob }) => Promise<{ path: string }>;
  /** Notes first, then attachments. */
  listWikiTargets: () => Promise<WikiTarget[]>;
  getBacklinks: (payload: { path: string }) => Promise<BacklinkEntry[]>;
  readNoteFormulas: (payload: { noteId: string }) => Promise<{
    path: string;
    formulas: CollectedFormula[];
  } | null>;
  onVaultChanged: (listener: (event: VaultChangedEvent) => void) => () => void;
}

let installed: EditorHostIo | null = null;

export const setEditorHostIo = (io: EditorHostIo): void => {
  installed = io;
};

export const getEditorHostIo = (): EditorHostIo => {
  if (installed === null) {
    throw new Error("EditorHostIo not installed — the app must setEditorHostIo() before mounting");
  }
  return installed;
};
