// The page's library, handed to every screen through one context: the wire to the account's
// library, what asks what moved in it, asking while the page shows the library, what the host
// decides (where `/v1` is reached for bytes, how the session ends and where a sign-out goes), and
// what the tab's shell holds (`../workspace-store.ts`). Mounted once, above the workspace and
// Settings, so Settings and back keeps asking on one beat.

import type { SessionEnd } from "@repo/contract/rpc/call-outcome";
import { createContext, useContext, useEffect } from "react";

import type { FileCloud } from "./library-files";
import { libraryQueries } from "./library-queries";
import type { LibraryQueries } from "./library-queries";
import { libraryWrites } from "./library-writes";
import type { LibraryWrites } from "./library-writes";
import type { SignedIn } from "#lib/auth-client";
import type { LibraryChanges } from "@repo/client/library-changes";
import type { WorkspaceStore } from "../workspace-store";
import type { CloudWire } from "./v1";

// why this device leaves its account: a sign-out, or the account deleted
export type LeaveReason = "signed-out" | "deleted";

// where the tab's session stands: live; ended by the cloud, an `outdated` end keeping the session
// and saying the browser is too old, any other sending the tab to sign in; or left, by this
// device's own sign-out or its account deleted. The first end wins, and every later one does
// nothing
export type TabSession =
  | { readonly kind: "live" }
  | { readonly kind: "ended"; readonly why: SessionEnd }
  | { readonly kind: "left" };

export interface TabSessionStore {
  readonly get: () => TabSession;
  readonly subscribe: (heard: () => void) => () => void;
}

export interface PageLibrary {
  readonly account: SignedIn;
  readonly wire: CloudWire;
  // `/v1` for the bytes the wire does not carry: a file a note names, an import's file
  readonly cloud: FileCloud;
  readonly changes: Pick<LibraryChanges, "start">;
  readonly session: TabSessionStore;
  readonly workspace: WorkspaceStore;
  // this device has left its account: the host's next screen
  readonly left: (reason: LeaveReason) => void;
}

const PageLibraryContext = createContext<PageLibrary | null>(null);

export const usePageLibrary = (): PageLibrary => {
  const library = useContext(PageLibraryContext);
  if (library === null) {
    throw new Error("usePageLibrary must be used inside PageLibraryProvider");
  }
  return library;
};

export const useLibraryQueries = (): LibraryQueries => libraryQueries(usePageLibrary().wire);

export const useLibraryWrites = (): LibraryWrites => libraryWrites(usePageLibrary());

export const PageLibraryProvider = ({
  library,
  children,
}: {
  library: PageLibrary;
  children: React.ReactNode;
}) => {
  const { changes } = library;
  useEffect(() => changes.start(), [changes]);
  return <PageLibraryContext value={library}>{children}</PageLibraryContext>;
};
