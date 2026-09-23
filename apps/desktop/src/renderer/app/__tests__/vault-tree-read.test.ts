// @vitest-environment jsdom
// The rail observes the vault tree and the note session reads it: a frame that moves rows costs the
// server one walk between the two, and the session's own re-list is never served from the cache.

import { QueryObserver } from "@tanstack/react-query";
import { RPC_PREFIX } from "@repo/api/local/routes";
import type { VaultTreeResponse } from "@repo/api/local/vault/vault-schema";
import { afterEach, describe, expect, it, vi } from "vitest";
import { orpc } from "../api";
import { readVaultTree } from "../vault-hooks";
import { ChangeBatch, createWorkspaceQueryClient } from "../workspace-context";

const TREE: VaultTreeResponse = {
  entries: [{ kind: "file", path: "a.md" }],
  name: "vault",
  root: "/vault",
};

// the oRPC client speaks `{ json }` both ways; any other procedure is a 404.
const countTreeWalks = (): (() => number) => {
  let walks = 0;
  vi.stubGlobal("fetch", async (input: string | URL | Request) => {
    const url = new URL(String(input instanceof Request ? input.url : input), "http://localhost");
    if (url.pathname !== `${RPC_PREFIX}/vault/tree`) {
      return new Response("not stubbed", { status: 404 });
    }
    walks += 1;
    return await Promise.resolve(Response.json({ json: TREE }));
  });
  return () => walks;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the vault tree", () => {
  it("is walked once for a frame naming thirty paths, by the rail and the note session together", async () => {
    const walks = countTreeWalks();
    const queryClient = createWorkspaceQueryClient();
    const rail = new QueryObserver(queryClient, orpc.vault.tree.queryOptions());
    const unsubscribe = rail.subscribe(() => {});
    await vi.waitFor(() => {
      expect(rail.getCurrentResult().data).toEqual(TREE);
    });

    const batch = new ChangeBatch();
    batch.add({
      changes: ["files-changed"],
      entity: "vault",
      paths: Array.from({ length: 30 }, (_, index) => `n${index}.md`),
      type: "changed",
    });
    const reads: Promise<VaultTreeResponse>[] = [];
    batch.apply(
      queryClient,
      () => {
        reads.push(readVaultTree(queryClient));
      },
      () => {},
    );
    await Promise.all(reads);

    expect(reads).toHaveLength(1);
    expect(walks()).toBe(2);
    unsubscribe();
  });

  it("is walked afresh when the note session re-lists before any frame invalidated it", async () => {
    const walks = countTreeWalks();
    const queryClient = createWorkspaceQueryClient();
    await readVaultTree(queryClient);
    await readVaultTree(queryClient);

    expect(walks()).toBe(2);
  });
});
