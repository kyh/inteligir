import type { WikiTarget } from "@repo/notes/knowledge/wiki-target";
import type { LibraryBlock } from "@repo/notes/library/library-nodes";
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

export interface VaultActions {
  /** Opens what a link or a file card names, by the path the resolver answers it at. */
  openFile: (path: string) => void;
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
  /** The name an item goes by now, the one its card shows, so a link that names it by id shows it as it is; null for an item the targets do not hold. */
  titleOf: (itemId: string) => string | null;
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

// `files` moved a listing row (a create, rename, delete or a change from elsewhere), and
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
  onVaultChanged: (listener: (event: VaultChangedEvent) => void) => () => void;
  /** A native photo picker that writes what it picks; null where paste and drop are the only way in. */
  pickImage: (() => Promise<PickImageResult>) | null;
  /** True where `vault.openFile` shows a file that is no note in a viewer of the host's own (the phone), so a file card's Open goes there; false where the page hands the file's bytes to the system's viewer. */
  opensFiles: boolean;
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

// a note a host makes of blocks the editor moves out of an item: its title, and its blocks in
// reading order, each at the order key it is placed by
interface NewNote {
  readonly title: string;
  readonly blocks: readonly { readonly block: LibraryBlock; readonly ord: string }[];
}

export interface ItemActions {
  /** Makes `note` in the folder of the item the editor shows, through the replica's outbox, and answers its id; rejects when the note was not made. */
  readonly createNote: (note: NewNote) => Promise<string>;
}

// What the editor asks the shell for beyond the vault. Every field is required, so a host that
// leaves one out fails to typecheck rather than drawing a button that does nothing.
export interface EditorHostActions {
  readonly agent: AgentRequestActions;
  readonly annotations: AnnotationActions;
  readonly items: ItemActions;
}

export interface EditorHost {
  readonly io: EditorHostIo;
  readonly actions: EditorHostActions;
}

let installed: EditorHost | null = null;

// Installed once, ahead of the first render: the item the boot opens mounts hooks that read the
// host as they render. It stays installed until the next install replaces it, because an answer in
// flight when the item unmounts still reads it.
export const installEditorHost = (host: EditorHost): void => {
  installed = host;
};

const installedHost = (): EditorHost => {
  if (installed === null) {
    throw new Error("no editor host installed — the app must installEditorHost() before mounting");
  }
  return installed;
};

export const getEditorHostIo = (): EditorHostIo => installedHost().io;

export const getEditorHostActions = (): EditorHostActions => installedHost().actions;
