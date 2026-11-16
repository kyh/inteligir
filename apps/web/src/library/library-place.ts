// CLAUDE.md § Where the tab is rides the URL. Where an address says the tab is, and the ways it
// moves, over the router alone, so a command and the editor's host, which is asked outside React,
// go by one spelling and read the address as they are asked.

import type { ItemKind } from "@repo/contract/items/item-kind";
import { listedScope } from "@repo/contract/library-scope";
import type { LibraryScope } from "@repo/contract/library-scope";
import type { NavigateFn } from "@tanstack/react-router";
import type { z } from "zod";

import { librarySearchSchema } from "./library-search";

interface LibraryPlace {
  readonly scope: LibraryScope;
  readonly kind: ItemKind | null;
  readonly openItem: string | null;
}

export const placeOf = (search: z.infer<typeof librarySearchSchema>): LibraryPlace => ({
  kind: search.kind ?? null,
  openItem: search.item ?? null,
  scope: search.scope ?? { kind: "all" },
});

// the scope the tab shows: its address's, a folder judged once the rail's scopes have answered
export const shownScope = (
  addressed: LibraryScope,
  listed: { readonly folders: readonly { readonly id: string }[] } | undefined,
): LibraryScope => (listed === undefined ? addressed : listedScope(addressed, listed.folders));

interface PlaceRouter {
  readonly navigate: NavigateFn;
  // an address's search as it is spelled, which is the route's once parsed
  readonly state: { readonly location: { readonly search: unknown } };
}

export const libraryGoes = (router: PlaceRouter) => {
  const now = (): LibraryPlace => placeOf(librarySearchSchema.parse(router.state.location.search));
  // on the current route, so an open that lands while Settings covers the workspace keeps it; the
  // item already open is replaced, so a hit found in it adds no entry to go Back through
  const toItem = (itemId: string | null, find?: string, ignoreBlocker?: boolean): void => {
    void router.navigate({
      ignoreBlocker,
      replace: itemId === now().openItem,
      search: (prior) => ({ ...prior, find, item: itemId ?? undefined }),
      to: ".",
    });
  };
  return {
    // back to the grid; a leave made on the person's word is not asked about again
    closeItem: (leave?: { readonly unasked: true }): void => {
      toItem(null, undefined, leave?.unasked);
    },
    now,
    // with the words a search found it by, which its find bar opens on
    openItem: (itemId: string, find?: string): void => {
      toItem(itemId, find);
    },
    openSettings: (): void => {
      void router.navigate({ search: true, to: "/library/settings" });
    },
    // a narrowing of the scope, not a place of its own, so it replaces the entry Back would return to
    showKind: (kind: ItemKind | null): void => {
      void router.navigate({
        replace: true,
        search: (prior) => ({ ...prior, kind: kind ?? undefined }),
        to: ".",
      });
    },
    // a new entry with no kind and no item, so Back walks scopes and the leave guard asks once; All
    // items is the bare address, which a fresh tab opens on
    showScope: (scope: LibraryScope): void => {
      void router.navigate({
        search: { scope: scope.kind === "all" ? undefined : scope },
        to: "/library",
      });
    },
  };
};

export type LibraryGoes = ReturnType<typeof libraryGoes>;
