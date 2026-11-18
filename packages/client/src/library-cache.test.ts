import { createORPCErrorFromJson } from "@orpc/client";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { QueryClient } from "@tanstack/query-core";
import type { QueryKey } from "@tanstack/query-core";
import { describe, expect, it } from "vitest";

import { createFakeCell } from "@repo/contract/test-support/fake-cell";

import { invalidateMoved, retryUnlessRefused } from "./library-cache";

const THREAD = "0199a4c2-0000-7000-8000-0000000000e1";

// a device holding two notes and every query a screen reads, once each
const heldReads = () => {
  const cell = createFakeCell();
  const note = cell.held(cell.seed.item({ title: "Note" }));
  const other = cell.held(cell.seed.item({ title: "Other" }));
  const queries = createTanstackQueryUtils(cell.device("tab").client);
  const { agent, items, listing } = queries.library;
  const queryClient = new QueryClient();
  const keys = {
    note: items.row.queryKey({ input: { id: note.id } }),
    other: items.get.queryKey({ input: { id: other.id } }),
    page: listing.page.queryKey({ input: { limit: 20, scope: { kind: "all" } } }),
    scopes: listing.scopes.queryKey(),
    threads: agent.list.queryKey({ input: {} }),
    titles: listing.titles.queryKey(),
    undoable: agent.undoable.queryKey({ input: { threadId: THREAD } }),
  } satisfies Record<string, QueryKey>;
  queryClient.setQueryData(keys.note, note);
  queryClient.setQueryData(keys.other, other);
  // each key as the cache files it, whatever the query reads
  const held: readonly QueryKey[] = [
    keys.page,
    keys.scopes,
    keys.threads,
    keys.titles,
    keys.undoable,
  ];
  for (const key of held) {
    queryClient.setQueryData(key, "held");
  }
  return {
    moved: (moved: Parameters<typeof invalidateMoved>[2]) =>
      invalidateMoved(queries, queryClient, moved),
    note,
    other,
    staleOf: () =>
      Object.entries(keys)
        .filter(([, key]) => queryClient.getQueryState(key)?.isInvalidated === true)
        .map(([name]) => name)
        .toSorted(),
  };
};

describe("what an answer of what moved reads again", () => {
  it("reads again an item it holds an older copy of, and what the library lists, and no more", () => {
    const { moved, note, other, staleOf } = heldReads();
    const items = moved({
      folders: false,
      items: [
        { id: note.id, seq: note.seq + 1 },
        { id: other.id, seq: other.seq },
      ],
      threads: [],
    });
    expect(staleOf()).toStrictEqual(["note", "page", "scopes", "titles"]);
    expect(items).toStrictEqual(new Set([note.id, other.id]));
  });

  it("reads again the rail's scopes for a folder that moved, and a thread for its turn or its undo", () => {
    const { moved, staleOf } = heldReads();
    expect(moved({ folders: true, items: [], threads: [THREAD] })).toStrictEqual(new Set());
    expect(staleOf()).toStrictEqual(["scopes", "threads", "undoable"]);
  });

  it("reads every item and every thread again when more moved than an answer names", () => {
    const { moved, staleOf } = heldReads();
    expect(moved({ folders: false, items: "all", threads: "all" })).toBeNull();
    expect(staleOf()).toStrictEqual([
      "note",
      "other",
      "page",
      "scopes",
      "threads",
      "titles",
      "undoable",
    ]);
  });
});

const defined = (code: string) =>
  createORPCErrorFromJson({ code, data: undefined, defined: true, message: code });

describe("a read that did not land", () => {
  it("is asked again when it met no answer or a busy cell, never for a refusal", () => {
    expect(retryUnlessRefused(0, new TypeError("Failed to fetch"))).toBe(true);
    expect(retryUnlessRefused(0, defined("TOO_MANY_REQUESTS"))).toBe(true);
    expect(retryUnlessRefused(3, new TypeError("Failed to fetch"))).toBe(false);
    expect(retryUnlessRefused(0, defined("NOT_FOUND"))).toBe(false);
    expect(retryUnlessRefused(0, defined("UNAUTHORIZED"))).toBe(false);
  });
});
