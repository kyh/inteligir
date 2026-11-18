// CLAUDE.md § Where the tab is rides the URL. An address's one spelling, flat so a person can read
// and type it: a scope by one parameter (`?scope=unsorted`, `?folder=<id>`, `?tag=<name>`), the
// kind it is narrowed to, the item open over them and the words a search found it by.

import { isItemKind } from "@repo/contract/items/item-kind";
import type { ItemKind } from "@repo/contract/items/item-kind";
import { LIBRARY_PAGE_PATH } from "@repo/contract/library-page";
import { libraryScopeSchema, listedScope } from "@repo/contract/library-scope";
import type { LibraryScope } from "@repo/contract/library-scope";
import { z } from "zod";

const SETTINGS_PATH = `${LIBRARY_PAGE_PATH}/settings`;

export interface LibraryAddress {
  readonly scope: LibraryScope;
  readonly kind: ItemKind | null;
  readonly openItem: string | null;
  // the item's find bar opens on them, and the address drops them once it has
  readonly find: string | null;
  // Settings covers the workspace, which stays mounted under it
  readonly settings: boolean;
}

const itemId = z.uuid();

const EVERY_ITEM: LibraryScope = { kind: "all" };

// the scope one parameter names, as the listing would read it
const namedScope = (named: string | null, folderId: string | null, tag: string | null) => {
  if (folderId !== null && folderId !== "") {
    return { folderId, kind: "folder" };
  }
  if (tag !== null && tag !== "") {
    return { kind: "tag", tag };
  }
  return { kind: named };
};

const scopeOf = (search: URLSearchParams): LibraryScope => {
  const named = search.get("scope");
  const folderId = search.get("folder");
  const tag = search.get("tag");
  // two scopes at once name neither
  const given = [named, folderId, tag].filter((value) => value !== null && value !== "");
  if (given.length !== 1) {
    return EVERY_ITEM;
  }
  const scope = libraryScopeSchema.safeParse(namedScope(named, folderId, tag));
  return scope.success ? scope.data : EVERY_ITEM;
};

// anything an address carries that names nothing is no part of it
export const parseLibraryAddress = (pathname: string, search: URLSearchParams): LibraryAddress => {
  const kind = search.get("kind");
  const item = search.get("item");
  const find = search.get("find");
  return {
    find: find === "" ? null : find,
    kind: kind !== null && isItemKind(kind) ? kind : null,
    openItem: itemId.safeParse(item).success ? item : null,
    scope: scopeOf(search),
    settings: pathname === SETTINGS_PATH,
  };
};

// the one parameter that names a scope, All items naming none
const scopeParams = (scope: LibraryScope) => {
  switch (scope.kind) {
    case "all": {
      return [];
    }
    case "folder": {
      return [["folder", scope.folderId]];
    }
    case "tag": {
      return [["tag", scope.tag]];
    }
    case "deleted":
    case "unsorted": {
      return [["scope", scope.kind]];
    }
    // no default
  }
};

// All items with nothing open is the bare address, which a fresh tab opens on
export const libraryHref = (address: LibraryAddress): string => {
  const search = new URLSearchParams(scopeParams(address.scope));
  if (address.kind !== null) {
    search.set("kind", address.kind);
  }
  if (address.openItem !== null) {
    search.set("item", address.openItem);
  }
  if (address.find !== null) {
    search.set("find", address.find);
  }
  const query = search.toString();
  const path = address.settings ? SETTINGS_PATH : LIBRARY_PAGE_PATH;
  return query === "" ? path : `${path}?${query}`;
};

// the scope the tab shows: its address's, a folder judged once the rail's scopes have answered
export const shownScope = (
  addressed: LibraryScope,
  listed: { readonly folders: readonly { readonly id: string }[] } | undefined,
): LibraryScope => (listed === undefined ? addressed : listedScope(addressed, listed.folders));
