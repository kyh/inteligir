import type { SessionEnd } from "@repo/contract/rpc/call-outcome";
import { createContext, useContext, useEffect } from "react";

import type { FileCloud } from "./library-files";
import { libraryQueries } from "./library-queries";
import { libraryWrites } from "./library-writes";
import type { SignedIn } from "#lib/auth-client";
import type { LibraryChanges } from "@repo/client/library-changes";
import type { WorkspaceStore } from "../workspace-store";
import type { CloudWire } from "./v1";

export type LeaveReason = "signed-out" | "deleted";

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
  readonly cloud: FileCloud;
  readonly changes: Pick<LibraryChanges, "start">;
  readonly session: TabSessionStore;
  readonly workspace: WorkspaceStore;
  readonly left: (reason: LeaveReason) => void;
}

const PageLibraryContext = createContext<PageLibrary | null>(null);

export const usePageLibrary = () => {
  const library = useContext(PageLibraryContext);

  if (library === null) {
    throw new Error("usePageLibrary must be used inside PageLibraryProvider");
  }

  return library;
};

export const useLibraryQueries = () => libraryQueries(usePageLibrary().wire);

export const useLibraryWrites = () => libraryWrites(usePageLibrary());

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
