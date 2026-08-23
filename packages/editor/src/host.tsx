import type { VaultEntry } from "@repo/editor/host-io";
import { createContext, useContext, type ReactNode } from "react";

// ---------------------------------------------------------------------------
// The editor's view of the app around it.
//
// @repo/editor sits BELOW @repo/workspace: the Plate tree, the markdown
// round-trip and the note runtime must not reach up into the shell that mounts
// them. Everything the editor needs from that shell arrives here — the vault
// mutation surface, the file listing (which resolves `[[wiki targets]]`), and
// the one panel the shell owns but renders inside the editor column.
//
// Only things the SHELL owns cross. A capability that lives in this package
// already — the open-note store's mode and html-view setters, say — is imported
// where it is used: routing it through the host would be an identity forward
// that reads like a boundary and guards nothing.
//
// These types live HERE, not beside the provider, because the dependency runs
// this way: `workspace/vault-context.tsx` implements `VaultActions` and imports
// the type from this file. Declaring them in the shell would put a type edge
// back across the boundary and reintroduce the cycle the split removed.
// ---------------------------------------------------------------------------

export type VaultActions = {
  /** Open a file, replacing the current note, AND bring the editor surface up.
   * Both halves, always: a note opened from the graph or the tasks view has to
   * show the note rather than leave the user on the surface they clicked from.
   * Pending edits on the current note are flushed first; a failed flush refuses
   * to navigate. */
  openFile: (path: string) => void;
  /** Record an edit to a SPECIFIC note's buffer (debounced autosave). Bytes
   * always carry the path of the editor that produced them: teardown settles
   * and surface switches can emit after the open note already changed,
   * and those bytes must no-op rather than land on the wrong file. */
  editNote: (path: string, content: string) => void;
  /** Register a SPECIFIC note's pre-flush hook on its runtime (the Rich
   * editor's serialize flush — drains a keystroke still in the serialize
   * debounce into the buffer before any save/rename/delete persists it).
   * Routed by path like editNote: a registration from an editor whose note
   * already closed must not land on the next note's runtime. */
  registerNoteSerializeFlush: (path: string, flush: () => void) => void;
  /** Open the note at `path` (e.g. "folder/note.md"); if it doesn't exist
   * yet, create it seeded with `content` (byte-exact, default empty) FIRST,
   * then open it. An existing file is opened untouched — open-or-create
   * semantics that templates + daily notes rely on, so re-running it never
   * clobbers a note the user already has. */
  createFile: (path: string, content?: string) => Promise<void>;
  /** Create a file WITHOUT opening it (wiki create-on-complete), seeded with
   * `seedContent` (default empty). An existing file is left untouched and
   * counts as success. Resolves the normalized path, or null on failure. */
  createFileAt: (path: string, seedContent?: string) => Promise<string | null>;
  /** Rename/move the file at `from` to `to`. Resolves `false` if the rename
   * failed (so callers like the title field can roll back their UI). */
  renameEntry: (from: string, to: string) => Promise<boolean>;
  /** Delete a file (closes it if open). */
  deleteEntry: (path: string) => Promise<void>;
  /** Persist the open note's pending edits now (e.g. before delegating a
   * checkbox). Resolves `true` once the buffer is clean. */
  flush: () => Promise<boolean>;
  /** Re-list the vault now (re-list + reindex). */
  refreshVault: () => void;
};

export type VaultListing = {
  /** Flat listing of every file in the vault (the tree is derived from it). */
  entries: VaultEntry[];
  /** The vault root name (display only). */
  folderName: string;
  /** Resolve a wiki target (`[[target]]`) against the current file listing —
   * the same Obsidian-style tiers the host's knowledge index uses. Identity
   * changes when the resolver rebuilds (listing / alias refresh), so chips
   * that render a resolved/unresolved state re-render exactly then. */
  resolveWikiTarget: (target: string) => string | null;
};

export type EditorHost = {
  actions: VaultActions;
  listing: VaultListing;
};

// Split like the shell's own contexts: `actions` identity is fixed for the
// app's life, `listing` changes only on a structural refresh. One context
// carrying both would re-render every action-only consumer on each refresh.
const ActionsContext = createContext<VaultActions | null>(null);
const ListingContext = createContext<VaultListing | null>(null);

export function EditorHostProvider({ host, children }: { host: EditorHost; children: ReactNode }) {
  return (
    <ActionsContext.Provider value={host.actions}>
      <ListingContext.Provider value={host.listing}>{children}</ListingContext.Provider>
    </ActionsContext.Provider>
  );
}

/** A missing provider is a mount-order bug, never a state the UI renders
 * around — throw rather than make every call site carry a dead null check. */
function required<T>(value: T | null, name: string): T {
  if (value === null) throw new Error(`${name} used outside <EditorHostProvider>`);
  return value;
}

export function useVaultActions(): VaultActions {
  return required(useContext(ActionsContext), "useVaultActions");
}

export function useVaultListing(): VaultListing {
  return required(useContext(ListingContext), "useVaultListing");
}
