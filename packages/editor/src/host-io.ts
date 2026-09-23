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

// The knowledge index's resolver over the listing, so a link the editor draws lands where the
// index (and so Problems and a rename) says it does. Identity changes when the listing or aliases
// refresh, so a link re-renders on that alone.
export interface LinkResolver {
  resolveWikiTarget: (target: string) => string | null;
  /** `target` is an md url as `mdLinkTarget` reads it; tried beside `fromPath`, then from the root. */
  resolveMdTarget: (target: string, fromPath: string) => string | null;
}

// The read half only: the app owns the writer. A store rather than a field because the resolver
// is rebuilt on every vault refresh while the actions never change, so only its readers re-render.
export type LinkResolverStore = Pick<
  StoreApi<LinkResolver>,
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
  linkResolver: LinkResolverStore;
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
