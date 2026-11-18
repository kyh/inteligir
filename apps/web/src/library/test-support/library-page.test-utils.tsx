import { render } from "@testing-library/react";

import type { PageLibrary } from "../cloud/library-context";
import { libraryQueries } from "../cloud/library-queries";
import { createPageQueryClient } from "../cloud/v1";
import { LibraryLayout } from "../library-layout";
import type { TabOpening } from "../library-tab";

export const renderLibraryAt = (entry: string, opening: TabOpening) => {
  window.history.replaceState(null, "", entry);
  render(<LibraryLayout opening={opening} />);
};

export const openedOver = async (library: PageLibrary) => {
  const queryClient = createPageQueryClient();
  await queryClient.query(libraryQueries(library.wire).scopes());

  return { kind: "open", library, queryClient } satisfies TabOpening;
};

export const addressed = (name: string) => new URLSearchParams(window.location.search).get(name);
