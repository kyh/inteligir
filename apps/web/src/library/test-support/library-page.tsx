// The library's page at an address, for a screen's suite: the layout the page draws, opened by what
// the suite hands in place of the tab's open, so a screen runs under the address, the QueryClient
// and the library it runs under in the tab.

import { render } from "@testing-library/react";

import type { PageLibrary } from "../cloud/library-context";
import { libraryQueries } from "../cloud/library-queries";
import { createPageQueryClient } from "../cloud/v1";
import { LibraryLayout } from "../library-layout";
import type { TabOpening } from "../library-tab";

export const renderLibraryAt = (entry: string, opening: TabOpening): void => {
  window.history.replaceState(null, "", entry);
  render(<LibraryLayout opening={opening} />);
};

// a tab opened over a suite's library, the rail's scopes read first as the tab's open reads them
export const openedOver = async (library: PageLibrary): Promise<TabOpening> => {
  const queryClient = createPageQueryClient();
  await queryClient.query(libraryQueries(library.wire).scopes());
  return { kind: "open", library, queryClient };
};

// the address's parameter as the tab last wrote it
export const addressed = (name: string): string | null =>
  new URLSearchParams(window.location.search).get(name);
