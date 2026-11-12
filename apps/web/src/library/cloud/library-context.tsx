// The page's library, handed to every screen through one context: the wire to the account's cell,
// the account's socket that says what moved, and what the host decides (where `/v1` is reached for
// bytes, how the session ends and where a sign-out goes). Mounted once, above the router's routes,
// so Settings and back keeps the one socket.

import { createContext, useContext } from "react";

import type { LeaveGuard } from "./leave-guard";
import type { FileCloud } from "./library-files";
import { libraryQueries } from "./library-queries";
import type { LibraryQueries } from "./library-queries";
import type { SignedIn } from "#lib/auth-client";
import { useLibrarySocket } from "./use-library-socket";
import type { LibrarySocket } from "./use-library-socket";
import type { CloudWire } from "./v1";

// why this device leaves its account: a sign-out, or the account deleted
export type LeaveReason = "signed-out" | "deleted";

export interface PageLibrary {
  readonly account: SignedIn;
  readonly wire: CloudWire;
  // `/v1` for the bytes the wire does not carry: a file a note names, an import's file
  readonly cloud: FileCloud;
  readonly socket: LibrarySocket;
  // what asks before the page leaves while the open item holds an edit not yet written
  readonly leave: LeaveGuard;
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

export const PageLibraryProvider = ({
  library,
  children,
}: {
  library: PageLibrary;
  children: React.ReactNode;
}) => {
  useLibrarySocket(library.socket);
  return <PageLibraryContext value={library}>{children}</PageLibraryContext>;
};
