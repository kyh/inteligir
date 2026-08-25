// The client half of the ws invalidation bus: which query families a changed
// message sweeps, and who it tells directly.
//
// The doc case is the one with a cost attached. The open note reads its own
// file (note/note-disk.ts), so a `vaultFile` query invalidated alongside the
// notification made the SAME event answered twice — two reads of the same
// bytes for every agent write. The assertion is therefore about what does NOT
// happen: a doc change invalidates nothing.

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
    // The DERIVED family only: the links this doc holds are somebody else's
    // backlinks and somebody else's relatedness, and the prefix is swept
    // whole because which somebody is not knowable from here. Nothing that
    // would re-fetch the doc's own bytes.
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
      [...orpc.vault.trashList.key()],
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
