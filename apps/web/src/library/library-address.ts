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
  readonly find: string | null;
  readonly settings: boolean;
}

const itemId = z.uuid();

const EVERY_ITEM: LibraryScope = { kind: "all" };

const namedScope = (named: string | null, parentId: string | null, tag: string | null) => {
  if (parentId !== null && parentId !== "") {
    return { parentId, kind: "parent" };
  }

  if (tag !== null && tag !== "") {
    return { kind: "tag", tag };
  }

  return { kind: named };
};

const scopeOf = (search: URLSearchParams) => {
  const named = search.get("scope");
  const parentId = search.get("folder");
  const tag = search.get("tag");
  const given = [named, parentId, tag].filter((value) => value !== null && value !== "");

  if (given.length !== 1) {
    return EVERY_ITEM;
  }

  const scope = libraryScopeSchema.safeParse(namedScope(named, parentId, tag));

  return scope.success ? scope.data : EVERY_ITEM;
};

export const parseLibraryAddress = (pathname: string, search: URLSearchParams) => {
  const kind = search.get("kind");
  const item = search.get("item");
  const find = search.get("find");

  return {
    find: find === "" ? null : find,
    kind: kind !== null && isItemKind(kind) ? kind : null,
    openItem: itemId.safeParse(item).success ? item : null,
    scope: scopeOf(search),
    settings: pathname === SETTINGS_PATH,
  } satisfies LibraryAddress;
};

const scopeParams = (scope: LibraryScope) => {
  switch (scope.kind) {
    case "all": {
      return [];
    }

    case "parent": {
      return [["folder", scope.parentId]];
    }

    case "tag": {
      return [["tag", scope.tag]];
    }

    case "deleted":
    case "unsorted": {
      return [["scope", scope.kind]];
    }

    default: {
      throw new Error(`unexpected ${String(scope satisfies never)}`);
    }
  }
};

export const scopeAddress = (scope: LibraryScope) =>
  ({
    find: null,
    kind: null,
    openItem: null,
    scope,
    settings: false,
  }) satisfies LibraryAddress;

export const libraryHref = (address: LibraryAddress) => {
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

export const shownScope = (
  addressed: LibraryScope,
  listed: { readonly containers: readonly { readonly id: string }[] } | undefined,
) => (listed === undefined ? addressed : listedScope(addressed, listed.containers));
