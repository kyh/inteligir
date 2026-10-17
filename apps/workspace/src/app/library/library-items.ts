// CLAUDE.md § THE BUS IS APPLIED ONCE PER FRAME: the grid reads the listing one 100-row window at
// a time, one `knowledge.items` query per window that intersects the view, never an infinite
// query whose pages refetch together on every change. Every query here sits under the knowledge
// family, so the bus's sweep refreshes what is mounted.

import { keepPreviousData, useQueries, useQuery } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type { LibraryScope } from "@repo/domain/library-scope";
import type { ItemKind } from "@repo/notes/items/item-kind";
import { UNSORTED_FOLDER } from "@repo/notes/items/item-kind";
import { KNOWLEDGE_ITEM_PATHS_MAX } from "@repo/contract/local/knowledge/knowledge-schema";
import type {
  KnowledgeItemPathsRequest,
  KnowledgeItemsResponse,
} from "@repo/contract/local/knowledge/knowledge-schema";
import type { ItemRowWire } from "@repo/contract/local/items/items-schema";

import { client, orpc } from "../api";
import { isUrlItem } from "./item-labels";

export const LIBRARY_WINDOW = 100;

export type LibrarySort = "saved" | "modified" | "title";

// what the grid lists: a scope that is not Deleted, the chip, the palette's search and the sort
export interface LibraryFilter {
  readonly scope: Exclude<LibraryScope, { kind: "deleted" }>;
  readonly kind: ItemKind | null;
  readonly q: string | null;
  readonly sort: LibrarySort;
}

type ItemFilterRequest = Omit<KnowledgeItemPathsRequest, "limit" | "offset">;

// the listing's fields for a scope: Unsorted is its folder and what is under it
const scopeRequest = (scope: Exclude<LibraryScope, { kind: "deleted" }>): ItemFilterRequest => {
  switch (scope.kind) {
    case "all": {
      return {};
    }
    case "unsorted": {
      return { folder: UNSORTED_FOLDER };
    }
    case "folder": {
      return { folder: scope.path };
    }
    case "tag": {
      return { tag: scope.tag };
    }
    default: {
      const exhaustive: never = scope;
      return exhaustive;
    }
  }
};

// a search ranks, so the sort is the server's default for it; otherwise the person's
export const filterRequest = (filter: LibraryFilter): ItemFilterRequest => {
  const request = scopeRequest(filter.scope);
  if (filter.kind !== null) {
    request.kinds = [filter.kind];
  }
  if (filter.q === null) {
    request.sort = filter.sort;
  } else {
    request.q = filter.q;
  }
  return request;
};

const windowOptions = (filter: LibraryFilter, windowIndex: number) =>
  orpc.knowledge.items.queryOptions({
    input: {
      ...filterRequest(filter),
      limit: LIBRARY_WINDOW,
      offset: windowIndex * LIBRARY_WINDOW,
    },
  });

// one window of the listing; the previous key's answer stands in while a new filter loads, so a
// scope switch never blanks the grid
export const useLibraryWindow = (filter: LibraryFilter, windowIndex: number, enabled = true) =>
  useQuery({ ...windowOptions(filter, windowIndex), enabled, placeholderData: keepPreviousData });

// the windows a view needs at once, each its own query and cache entry
export const useLibraryWindows = (
  filter: LibraryFilter,
  windows: readonly number[],
  enabled = true,
): ReadonlyMap<number, KnowledgeItemsResponse> => {
  const results = useQueries({
    queries: windows.map((windowIndex) => ({
      ...windowOptions(filter, windowIndex),
      enabled,
      placeholderData: keepPreviousData,
    })),
  });
  const loaded = new Map<number, KnowledgeItemsResponse>();
  for (const [at, result] of results.entries()) {
    const windowIndex = windows[at];
    if (windowIndex !== undefined && result.data !== undefined) {
      loaded.set(windowIndex, result.data);
    }
  }
  return loaded;
};

// the windows that intersect the cells in view, and one either side
export const windowsAround = (range: { first: number; last: number }, total: number): number[] => {
  const lastWindow = Math.max(0, Math.ceil(total / LIBRARY_WINDOW) - 1);
  const from = Math.max(0, Math.floor(range.first / LIBRARY_WINDOW) - 1);
  const to = Math.min(lastWindow, Math.floor(Math.max(range.last, 0) / LIBRARY_WINDOW) + 1);
  const windows: number[] = [];
  for (let windowIndex = from; windowIndex <= to; windowIndex += 1) {
    windows.push(windowIndex);
  }
  return windows;
};

export const rowAt = (
  windows: ReadonlyMap<number, KnowledgeItemsResponse>,
  index: number,
): ItemRowWire | null =>
  windows.get(Math.floor(index / LIBRARY_WINDOW))?.items[index % LIBRARY_WINDOW] ?? null;

// the one item's row, read from the index: Info and Quick Look draw it, never a parse of the file
export const useItemRow = (path: string | null) =>
  useQuery({
    ...orpc.knowledge.itemsAt.queryOptions({ input: { paths: path === null ? [] : [path] } }),
    enabled: path !== null,
    select: (body) => body.items.find((row) => row.path === path) ?? null,
  });

// the web address of an item that came from one (a link, a video, a sound), null for any other
export const useItemSourceUrl = (path: string | null): string | null => {
  const row = useItemRow(path).data ?? null;
  return row !== null && isUrlItem(row) ? row.url : null;
};

const NO_FILTER: LibraryFilter = { kind: null, q: null, scope: { kind: "all" }, sort: "saved" };

// how many the listing holds, from its first window, which the grid shares through the cache
export const useListingTotal = (filter: LibraryFilter | null, enabled: boolean): number => {
  const head = useLibraryWindow(filter ?? NO_FILTER, 0, enabled && filter !== null);
  return head.data?.total ?? 0;
};

export const useLibraryScopes = () => useQuery(orpc.knowledge.scopes.queryOptions());

// the paths of a range of the listing, for ⌘A, a ⇧-click past the loaded rows and a bulk action
export const materializePaths = async (
  filter: LibraryFilter,
  from: number,
  to: number,
): Promise<string[]> => {
  const limit = Math.min(KNOWLEDGE_ITEM_PATHS_MAX, Math.max(1, to - from));
  const { paths } = await client.knowledge.itemPaths({
    ...filterRequest(filter),
    limit,
    offset: from,
  });
  return paths;
};

// a cached answer's rows, whichever knowledge query held them: the listing's windows and itemsAt
const cachedRowsSchema = z.looseObject({
  items: z.array(z.looseObject({ id: z.string().nullable(), path: z.string() })),
});

// the ids the rows already read name for these paths, read before a change refetches them: a path
// a rename took away (a fill's, an agent's) is followed by its item's id
export const cachedItemIds = (
  queryClient: QueryClient,
  paths: readonly string[],
): Map<string, string> => {
  const wanted = new Set(paths);
  const ids = new Map<string, string>();
  for (const key of [orpc.knowledge.items.key(), orpc.knowledge.itemsAt.key()]) {
    for (const [, data] of queryClient.getQueriesData({ queryKey: key })) {
      const parsed = cachedRowsSchema.safeParse(data);
      for (const row of parsed.success ? parsed.data.items : []) {
        if (row.id !== null && wanted.has(row.path)) {
          ids.set(row.path, row.id);
        }
      }
    }
  }
  return ids;
};
