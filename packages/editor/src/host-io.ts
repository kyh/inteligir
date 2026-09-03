import type { CollectedFormula } from "@repo/notes/formulas/collect-formulas";
import type {
  BacklinkEntry,
  ForwardLinkEntry,
  WikiTarget,
} from "@repo/notes/knowledge/link-graph-index";
import type { StoreApi } from "zustand/vanilla";

// The host as a module singleton rather than context: kit factories and paste handlers run
// outside React, and host.ts hands components the same object. The shell implements these
// types; declaring them beside the app's provider would put a type edge back across the
// package boundary.

export type VaultEntry = {
  path: string;
  name: string;
  kind: "doc" | "other";
};

export type VaultActions = {
  /** Also raises the editor surface; a failed flush of the current note refuses to navigate. */
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
  refreshVault: () => void;
};

export type VaultListing = {
  entries: readonly VaultEntry[];
  /** Identity changes when the listing or aliases refresh, so chips re-render on that alone. */
  resolveWikiTarget: (target: string) => string | null;
};

// The read half only: the app owns the writer. A store rather than a field because the listing
// moves with every vault refresh while the actions never do, so only its readers re-render.
export type VaultListingStore = Pick<
  StoreApi<VaultListing>,
  "getState" | "getInitialState" | "subscribe"
>;

// A Blob, not base64: the asset route already answers the media type, and re-deriving it from the extension is a second allowlist.
export type ReadVaultAssetResult = { ok: true; bytes: Blob } | { ok: false; error: string };

export type HeldDeletions = {
  /** What the rolling window would hold after this call, not this call's own count. */
  readonly deletions: number;
  readonly liveCount: number;
  readonly limit: number;
  readonly windowMs: number;
  readonly sample: readonly string[];
};

export type DeleteVaultEntryResult =
  | { readonly outcome: "removed" }
  | { readonly outcome: "absent" }
  | { readonly outcome: "held"; readonly held: HeldDeletions };

// `changed` is null when the host re-announced without diffing; callers must re-read.
export type VaultChangedEvent = {
  readonly root: string;
  readonly changed: {
    readonly upserted: readonly string[];
    readonly removed: readonly string[];
  } | null;
};

export function vaultChangeTouches(event: VaultChangedEvent, path: string): boolean {
  const { changed } = event;
  if (changed === null) return true;
  return changed.upserted.includes(path) || changed.removed.includes(path);
}

export function heldDeletionMessage(held: HeldDeletions): string {
  const named = held.sample.map((path) => `"${path}"`).join(", ");
  const more = held.sample.length < held.deletions ? ", …" : "";
  return (
    `Held: this would make ${held.deletions} deletions inside ` +
    `${Math.round(held.windowMs / 60_000)} minutes, past the limit of ` +
    `${Math.round(held.limit)} for a vault of ${held.liveCount} files. ` +
    `Nothing was deleted (${named}${more}). The count is a rolling window that drains on ` +
    `its own — wait for it to clear, then delete again.`
  );
}

export type EditorHostIo = {
  actions: VaultActions;
  listing: VaultListingStore;
  readVaultFile(payload: { path: string }): Promise<string>;
  readVaultAsset(payload: { path: string }): Promise<ReadVaultAssetResult>;
  /** Picks a collision-free name from `baseName`. */
  writeVaultAsset(payload: { dir: string; baseName: string; file: Blob }): Promise<{
    path: string;
  }>;
  /** Notes first, then attachments. */
  listWikiTargets(): Promise<WikiTarget[]>;
  getBacklinks(payload: { path: string }): Promise<BacklinkEntry[]>;
  readNoteFormulas(payload: { noteId: string }): Promise<{
    path: string;
    formulas: CollectedFormula[];
  } | null>;
  getForwardLinks(payload: { path: string }): Promise<ForwardLinkEntry[]>;
  onVaultChanged(listener: (event: VaultChangedEvent) => void): () => void;
  onKnowledgeUpdated(listener: () => void): () => void;
};

let installed: EditorHostIo | null = null;

export function setEditorHostIo(io: EditorHostIo): void {
  installed = io;
}

export function getEditorHostIo(): EditorHostIo {
  if (installed === null) {
    throw new Error("EditorHostIo not installed — the app must setEditorHostIo() before mounting");
  }
  return installed;
}
