import type { VaultEntry } from "@repo/editor/host-io";
import { createContext, useContext, type ReactNode } from "react";

// The shell implements these types; declaring them beside the app's provider
// would put a type edge back across the package boundary.

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
  entries: VaultEntry[];
  folderName: string;
  /** Identity changes when the listing or aliases refresh, so chips re-render on that alone. */
  resolveWikiTarget: (target: string) => string | null;
};

export type EditorHost = {
  actions: VaultActions;
  listing: VaultListing;
};

// One context for both would re-render every action-only consumer on each listing refresh.
const ActionsContext = createContext<VaultActions | null>(null);
const ListingContext = createContext<VaultListing | null>(null);

export function EditorHostProvider({ host, children }: { host: EditorHost; children: ReactNode }) {
  return (
    <ActionsContext.Provider value={host.actions}>
      <ListingContext.Provider value={host.listing}>{children}</ListingContext.Provider>
    </ActionsContext.Provider>
  );
}

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
