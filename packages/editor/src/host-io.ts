import type { CollectedFormula } from "@repo/notes/formulas/collect-formulas";
import type {
  BacklinkEntry,
  ForwardLinkEntry,
  WikiTarget,
} from "@repo/notes/knowledge/link-graph-index";

// ---------------------------------------------------------------------------
// The editor's I/O seam onto the app that mounts it.
//
// host.tsx carries what the SHELL owns and renders (vault actions, the file
// listing, panel slots); this file carries what the editor merely CALLS —
// reads, asset writes, knowledge queries and their invalidation events. It is
// a module singleton rather than context because kit factories and paste
// handlers run outside React; the app installs it once at mount, before any
// editor renders.
// ---------------------------------------------------------------------------

/** One file in the vault, relative to the vault root. `kind` splits editable
 * docs from everything else (images, pdfs, …). */
export type VaultEntry = {
  path: string;
  name: string;
  kind: "doc" | "other";
};

/** readVaultAsset result: an in-vault file's bytes, or an error. Rendering a
 * broken image is a UI state, not an exception — hence a Result, not a throw.
 * A Blob rather than base64 because the host's asset route already answers the
 * media type, and re-deriving it from the extension here is a second
 * allowlist that drifts from the one both asset routes share. */
export type ReadVaultAssetResult = { ok: true; bytes: Blob } | { ok: false; error: string };

/** The deletion gate's refusal, in the terms it is stated in. Every field is a
 * number the host computed, because the gate's policy is the host's. */
export type HeldDeletions = {
  /** How many deletions this call would bring the window to. */
  readonly deletions: number;
  /** Files the vault holds right now, for "N of M" phrasing. */
  readonly liveCount: number;
  /** The count above which the gate holds. */
  readonly limit: number;
  /** How long the rolling window is — the count drains by itself, and this is
   * how long that takes. */
  readonly windowMs: number;
  /** A few of the paths this call would remove. */
  readonly sample: readonly string[];
};

export type DeleteVaultEntryResult =
  | { readonly outcome: "trashed" }
  | { readonly outcome: "absent" }
  | { readonly outcome: "held"; readonly held: HeldDeletions };

/**
 * What one vault broadcast says moved. `changed` is `null` when the host
 * cannot say — a refresh re-announces the manifest without diffing it, so
 * every client re-reads.
 */
export type VaultChangedEvent = {
  readonly root: string;
  readonly changed: {
    readonly upserted: readonly string[];
    readonly removed: readonly string[];
  } | null;
};

/** Whether a vault broadcast may have changed `path` — true whenever the host
 * could not say what moved, so a caller that re-reads on true is never stale. */
export function vaultChangeTouches(event: VaultChangedEvent, path: string): boolean {
  const { changed } = event;
  if (changed === null) return true;
  return changed.upserted.includes(path) || changed.removed.includes(path);
}

/**
 * The sentence a held deletion is reported with — one phrasing, so the refusal
 * reads the same in a toast, in an agent tool's failure and in a log. It names
 * the recourse that EXISTS: the count is a rolling window, and it drains.
 */
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

/**
 * Everything the editor calls on the app. Subscriptions return their
 * unsubscribe.
 */
export type EditorHostIo = {
  readVaultFile(payload: { path: string }): Promise<string>;
  readVaultAsset(payload: { path: string }): Promise<ReadVaultAssetResult>;
  /** Write attachment bytes under `dir` with a collision-free name derived
   * from `baseName`; answer the vault-relative path they landed at. */
  writeVaultAsset(payload: { dir: string; baseName: string; file: Blob }): Promise<{
    path: string;
  }>;
  /** Every linkable target for the `[[`-autocomplete picker: notes first,
   * then attachments. */
  listWikiTargets(): Promise<WikiTarget[]>;
  getBacklinks(payload: { path: string }): Promise<BacklinkEntry[]>;
  /** A note's collected formulas by its frontmatter id (bound-reference
   * resolution) — null when no note carries that id. */
  readNoteFormulas(payload: { noteId: string }): Promise<{
    path: string;
    formulas: CollectedFormula[];
  } | null>;
  getForwardLinks(payload: { path: string }): Promise<ForwardLinkEntry[]>;
  onVaultChanged(listener: (event: VaultChangedEvent) => void): () => void;
  onKnowledgeUpdated(listener: () => void): () => void;
};

let installed: EditorHostIo | null = null;

/** Install the app's I/O implementation. Call once, before any editor mounts. */
export function setEditorHostIo(io: EditorHostIo): void {
  installed = io;
}

export function getEditorHostIo(): EditorHostIo {
  if (installed === null) {
    throw new Error("EditorHostIo not installed — the app must setEditorHostIo() before mounting");
  }
  return installed;
}
