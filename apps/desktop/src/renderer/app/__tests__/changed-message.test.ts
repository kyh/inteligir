import { QueryClient } from "@tanstack/react-query";
import type { QueryKey } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { orpc } from "../api";
import { applyChangedMessage } from "../workspace-context";

interface Applied {
  invalidated: readonly unknown[][];
  docs: (string | null)[];
  threads: number;
}

const apply = (message: Parameters<typeof applyChangedMessage>[3]): Applied => {
  const queryClient = new QueryClient();
  const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue();
  const docs: (string | null)[] = [];
  let threads = 0;
  applyChangedMessage(
    queryClient,
    (docId) => {
      docs.push(docId);
    },
    () => {
      threads += 1;
    },
    message,
  );
  const invalidated = invalidateQueries.mock.calls.map(([filters]) => [
    ...(filters?.queryKey ?? []),
  ]);
  return { docs, invalidated, threads };
};

describe("a doc change", () => {
  it("reaches the open note's reader and re-reads none of its bytes", () => {
    const applied = apply({
      changes: ["content-changed"],
      entity: "doc",
      id: "notes/open.md",
      type: "changed",
    });

    expect(applied.docs).toEqual(["notes/open.md"]);
    // the open note reads its own file; a `vaultFile` invalidation here read the same bytes twice per agent write.
    expect(applied.invalidated).toEqual([[...orpc.knowledge.key()]]);
  });
});

describe("a vault change", () => {
  it("sweeps the tree and names each moved path once", () => {
    const applied = apply({
      changes: ["files-changed"],
      entity: "vault",
      paths: ["a.md", "b.md"],
      type: "changed",
    });

    expect(applied.invalidated).toEqual([
      [...orpc.vault.tree.key()],
      [...orpc.vault.deleted.key()],
      [...orpc.knowledge.key()],
      [...orpc.comments.key()],
    ]);
    expect(applied.docs).toEqual(["a.md", "b.md"]);
  });

  it("asserts nothing when it names no paths, so every note re-checks", () => {
    const applied = apply({ changes: ["files-changed"], entity: "vault", type: "changed" });

    expect(applied.docs).toEqual([null]);
  });

  it("sweeps sync status on its own kind", () => {
    const applied = apply({
      changes: ["sync-status-changed"],
      entity: "vault",
      type: "changed",
    });

    expect(applied.invalidated).toEqual([[...orpc.vault.status.key()]]);
    expect(applied.docs).toEqual([]);
  });
});

describe("the other entities", () => {
  it("sweeps the whole thread family once and forwards the message", () => {
    const applied = apply({
      changes: ["events-appended"],
      entity: "thread",
      type: "changed",
    });

    expect(applied.invalidated).toEqual([[...orpc.threads.key()]]);
    expect(applied.threads).toBe(1);
  });
});

describe("the unlinked-mentions scan", () => {
  it("is the one knowledge query a content change leaves alone", () => {
    const queryClient = new QueryClient();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue();
    applyChangedMessage(
      queryClient,
      () => {},
      () => {},
      { changes: ["content-changed"], entity: "doc", id: "a.md", type: "changed" },
    );
    // the predicate reads the key alone; the cache builds its Query from the same key
    const keys: readonly QueryKey[] = [
      orpc.knowledge.backlinks.key({ input: { path: "a.md" } }),
      orpc.knowledge.unlinkedMentions.key({ input: { path: "a.md" } }),
    ];
    const seen = invalidateQueries.mock.calls.flatMap(([filters]) =>
      keys.map((queryKey) => {
        const query = queryClient.getQueryCache().build(queryClient, { queryKey });
        return filters?.predicate === undefined || filters.predicate(query);
      }),
    );
    expect(seen).toEqual([true, false]);
  });
});
