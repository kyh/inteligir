import type { CollectedFormula } from "@repo/notes/formulas/collect-formulas";
import type { WikiTarget } from "@repo/notes/knowledge/link-graph-index";
import type { StoreApi } from "zustand/vanilla";

// The host as a module singleton rather than context: kit factories, paste handlers and a deep
// node's click run outside React or with no route to the shell's owner, and host.ts hands
// components the same object. The shell implements these types; declaring them beside the app's
// provider would put a type edge back across the package boundary.

export interface VaultEntry {
  path: string;
  name: string;
  kind: "doc" | "other";
}

// `exists` names a taken path without a notice, so a caller can step past it; `refused` is final,
// and the session has said whatever there was to say.
export type CreateNewFileResult =
  | { readonly kind: "created"; readonly path: string }
  | { readonly kind: "exists"; readonly path: string }
  | { readonly kind: "refused" };

export interface VaultActions {
  /** A failed flush of the current note refuses to navigate. */
  openFile: (path: string) => void;
  /** Leaves the open item for the library, written first as a switch to another item would be. */
  closeFile: () => void;
  /** Keyed by path: a teardown or surface switch can emit after the open note changed, and those bytes must no-op. */
  editNote: (path: string, content: string) => void;
  /** Drains the serialize debounce before a save/rename/delete; keyed by path for the same reason as editNote. */
  registerNoteSerializeFlush: (path: string, flush: () => void) => void;
  /** Open-or-create: an existing file opens untouched, so naming a note that exists opens it. */
  createFile: (path: string) => Promise<void>;
  /** Creates without opening; an existing file counts as success. */
  createFileAt: (path: string, seedContent?: string) => Promise<string | null>;
  /** Creates without opening, exclusively: a caller moving bytes into the file would drop them if an existing one counted as success. */
  createNewFileAt: (path: string, seedContent: string) => Promise<CreateNewFileResult>;
  renameEntry: (from: string, to: string) => Promise<boolean>;
  // answers whether the entry went
  deleteEntry: (path: string) => Promise<boolean>;
  flush: () => Promise<boolean>;
}

// The knowledge index's resolver over the listing, so a link the editor draws lands where the
// index (and so backlinks and a rename) says it does. Identity changes when the listing or aliases
// refresh, so a link re-renders on that alone.
export interface LinkResolver {
  resolveWikiTarget: (target: string, alias?: string) => string | null;
  /** `target` is an md url as `mdLinkTarget` reads it; tried beside `fromPath`, then from the root. */
  resolveMdTarget: (target: string, fromPath: string) => string | null;
  /** The index's wiki targets the resolver was built over: notes first, then attachments. */
  targets: readonly WikiTarget[];
}

// The read half only: the host feeds the writer (`link-resolver-feed.ts`). A store rather than a
// field because the resolver is rebuilt on every vault refresh while the actions never change, so
// only its readers re-render.
export type LinkResolverStore = Pick<
  StoreApi<LinkResolver>,
  "getState" | "getInitialState" | "subscribe"
>;

// A Blob, not base64: the asset route already answers the media type, and re-deriving it from the extension is a second allowlist.
export type ReadVaultAssetResult = { ok: true; bytes: Blob } | { ok: false; error: string };

// `files` moved a listing row (a create, rename, delete or a change the watcher saw), and
// `paths: null` is one nobody could attribute, so every reader re-checks; `content` rewrote one
// file in place and moved no row.
export type VaultChangedEvent =
  | { readonly kind: "files"; readonly paths: readonly string[] | null }
  | { readonly kind: "content"; readonly path: string };

export const vaultChangeTouches = (event: VaultChangedEvent, path: string): boolean =>
  event.kind === "files" ? event.paths === null || event.paths.includes(path) : event.path === path;

// `picked` is an image the host has already written to the vault; `refused` is one it would not
// take, and `message` says why in the user's words.
export type PickImageResult =
  | { readonly kind: "picked"; readonly path: string }
  | { readonly kind: "cancelled" }
  | { readonly kind: "refused"; readonly message: string };

export interface EditorHostIo {
  vault: VaultActions;
  linkResolver: LinkResolverStore;
  readVaultFile: (payload: { path: string }) => Promise<string>;
  readVaultAsset: (payload: { path: string }) => Promise<ReadVaultAssetResult>;
  /** Picks a collision-free name from `baseName`; the host decides the folder from the vault's attachments choice and the open note. */
  writeVaultAsset: (payload: { baseName: string; file: Blob }) => Promise<{ path: string }>;
  readNoteFormulas: (payload: { noteId: string }) => Promise<{
    path: string;
    formulas: CollectedFormula[];
  } | null>;
  onVaultChanged: (listener: (event: VaultChangedEvent) => void) => () => void;
  /** Where a note's html block runs: a same-origin document answered under its own sandbox policy, since a srcdoc frame inherits the page's and runs no inline script. Null where no server answers one, and the block offers no Run. */
  htmlFrameUrl: string | null;
  /** A native photo picker that writes what it picks; null where paste and drop are the only way in. */
  pickImage: (() => Promise<PickImageResult>) | null;
}

export interface AnnotationActions {
  /** A highlight's entry around the markers just minted, `quote` its passage's text. False means refused; the caller strips the markers it minted. */
  create: (id: string, quote: string) => Promise<boolean>;
  /** The note on an annotation that exists. False means refused. */
  edit: (id: string, text: string) => Promise<boolean>;
  open: (ids: string[]) => void;
}

export interface AgentRequestActions {
  askAboutSelection: (selectionText: string) => void;
  /** The rail shows that tag's notes. */
  showTag: (tag: string) => void;
}

// What the editor asks the shell for beyond the vault. Every field is required, so a host that
// leaves one out fails to typecheck rather than drawing a button that does nothing.
export interface EditorHostActions {
  readonly agent: AgentRequestActions;
  readonly annotations: AnnotationActions;
}

export interface EditorHost {
  readonly io: EditorHostIo;
  readonly actions: EditorHostActions;
}

let installed: EditorHost | null = null;

// The host a writer outside the note's tree flushes through (`flushOpenNote`). A disposer clears
// it only while it still names that disposer's host, so a dispose landing after a newer install
// keeps the newer one's flush.
let flushing: EditorHost | null = null;

// Installed once, ahead of the first render: the note the boot opens mounts hooks that read the
// host as they render. The disposer ends the host's flush and leaves the host installed until the
// next install replaces it, because an answer in flight when the note unmounts still reads it.
export const installEditorHost = (host: EditorHost): (() => void) => {
  installed = host;
  flushing = host;
  return () => {
    if (flushing === host) {
      flushing = null;
    }
  };
};

export const installedFlush = (): (() => Promise<boolean>) | null =>
  flushing === null ? null : flushing.io.vault.flush;

const installedHost = (): EditorHost => {
  if (installed === null) {
    throw new Error("no editor host installed — the app must installEditorHost() before mounting");
  }
  return installed;
};

export const getEditorHostIo = (): EditorHostIo => installedHost().io;

export const getEditorHostActions = (): EditorHostActions => installedHost().actions;
