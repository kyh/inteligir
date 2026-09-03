import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { orpc } from "../api";
import { applyChangedMessage } from "../workspace-context";

interface Applied {
  invalidated: readonly unknown[][];
  docs: (string | null)[];
  threads: number;
}

function apply(message: Parameters<typeof applyChangedMessage>[3]): Applied {
  const queryClient = new QueryClient();
  const invalidated: unknown[][] = [];
  vi.spyOn(queryClient, "invalidateQueries").mockImplementation(async (filters) => {
    invalidated.push([...(filters?.queryKey ?? [])]);
  });
  const docs: (string | null)[] = [];
  let threads = 0;
  applyChangedMessage(
    queryClient,
    (docId) => docs.push(docId),
    () => {
      threads += 1;
    },
    message,
  );
  return { invalidated, docs, threads };
}

describe("a doc change", () => {
  it("reaches the open note's reader and re-reads none of its bytes", () => {
    const applied = apply({
      type: "changed",
      entity: "doc",
      id: "notes/open.md",
      changes: ["content-changed"],
    });

    expect(applied.docs).toEqual(["notes/open.md"]);
    // the open note reads its own file; a `vaultFile` invalidation here read the same bytes twice per agent write.
    expect(applied.invalidated).toEqual([[...orpc.knowledge.key()]]);
  });
});

describe("a vault change", () => {
  it("sweeps the tree and names each moved path once", () => {
    const applied = apply({
      type: "changed",
      entity: "vault",
      changes: ["files-changed"],
      paths: ["a.md", "b.md"],
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
    const applied = apply({ type: "changed", entity: "vault", changes: ["files-changed"] });

    expect(applied.docs).toEqual([null]);
  });

  it("sweeps sync status on its own kind", () => {
    const applied = apply({
      type: "changed",
      entity: "vault",
      changes: ["sync-status-changed"],
    });

    expect(applied.invalidated).toEqual([[...orpc.vault.status.key()]]);
    expect(applied.docs).toEqual([]);
  });
});

describe("the other entities", () => {
  it("sweeps the whole thread family once and forwards the message", () => {
    const applied = apply({
      type: "changed",
      entity: "thread",
      changes: ["events-appended"],
    });

    expect(applied.invalidated).toEqual([[...orpc.threads.key()]]);
    expect(applied.threads).toBe(1);
  });
});
