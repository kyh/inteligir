import { describe, expect, it, vi } from "vitest";

import type { VaultEntry } from "@repo/features/ipc-registry";

import { handleBrokerRequest, type BrokerBridge, type BrokerDeps } from "./html-app-broker";

// A minimal in-memory Bridge slice standing in for the real host.
function makeBridge(seed: Record<string, string> = {}): {
  bridge: BrokerBridge;
  store: Map<string, string>;
  kinds: Map<string, VaultEntry["kind"]>;
} {
  const store = new Map<string, string>(Object.entries(seed));
  const kinds = new Map<string, VaultEntry["kind"]>();
  for (const path of store.keys()) kinds.set(path, path.endsWith(".md") ? "doc" : "other");
  const bridge: BrokerBridge = {
    listVault: async () =>
      [...store.keys()].map((path) => ({
        path,
        name: path.split("/").pop() ?? path,
        kind: kinds.get(path) ?? "doc",
      })),
    readVaultDoc: async ({ path }) => {
      const content = store.get(path);
      if (content === undefined) throw new Error(`no such file: ${path}`);
      return content;
    },
    writeVaultDoc: async ({ path, content }) => {
      store.set(path, content);
    },
    deleteVaultEntry: async ({ path }) => ({ removed: store.delete(path) }),
  };
  return { bridge, store, kinds };
}

function makeDeps(bridge: BrokerBridge, over: Partial<BrokerDeps> = {}): BrokerDeps {
  return {
    bridge,
    openFile: vi.fn(),
    confirmRemove: async () => true,
    ...over,
  };
}

describe("handleBrokerRequest", () => {
  it("list returns docs only, as {path,name}", async () => {
    const { bridge } = makeBridge({ "a.md": "x", "b.md": "y", "img.png": "z" });
    const result = await handleBrokerRequest("list", [], makeDeps(bridge));
    expect(result).toEqual([
      { path: "a.md", name: "a.md" },
      { path: "b.md", name: "b.md" },
    ]);
  });

  it("read splits frontmatter into {path, body, properties}", async () => {
    const { bridge } = makeBridge({ "note.md": "---\ntitle: N\n---\nbody\n" });
    const result = await handleBrokerRequest("read", ["note.md"], makeDeps(bridge));
    expect(result).toEqual({ path: "note.md", body: "body\n", properties: { title: "N" } });
  });

  it("update merges the properties patch, preserving omitted keys", async () => {
    const { bridge, store } = makeBridge({ "n.md": "---\na: 1\nb: 2\n---\nbody\n" });
    await handleBrokerRequest("update", ["n.md", { properties: { b: 3, c: 4 } }], makeDeps(bridge));
    expect(store.get("n.md")).toBe("---\na: 1\nb: 3\nc: 4\n---\nbody\n");
  });

  it("update with properties:{k:null} deletes that property", async () => {
    const { bridge, store } = makeBridge({ "n.md": "---\na: 1\nb: 2\n---\nbody\n" });
    await handleBrokerRequest("update", ["n.md", { properties: { a: null } }], makeDeps(bridge));
    expect(store.get("n.md")).toBe("---\nb: 2\n---\nbody\n");
  });

  it("update can replace the body without touching properties", async () => {
    const { bridge, store } = makeBridge({ "n.md": "---\na: 1\n---\nold\n" });
    await handleBrokerRequest("update", ["n.md", { body: "new\n" }], makeDeps(bridge));
    expect(store.get("n.md")).toBe("---\na: 1\n---\nnew\n");
  });

  it("update rejects a missing file (never creates)", async () => {
    const { bridge } = makeBridge();
    await expect(
      handleBrokerRequest("update", ["missing.md", { body: "x" }], makeDeps(bridge)),
    ).rejects.toThrow(/no such file/);
  });

  it("create writes a new doc and errors if it already exists", async () => {
    const { bridge, store } = makeBridge();
    await handleBrokerRequest(
      "create",
      ["new.md", { body: "hi\n", properties: { title: "T" } }],
      makeDeps(bridge),
    );
    expect(store.get("new.md")).toBe("---\ntitle: T\n---\nhi\n");
    await expect(
      handleBrokerRequest("create", ["new.md", { body: "again" }], makeDeps(bridge)),
    ).rejects.toThrow(/already exists/);
  });

  it("remove deletes only after confirmation", async () => {
    const { bridge, store } = makeBridge({ "gone.md": "x" });
    const cancelled = await handleBrokerRequest(
      "remove",
      ["gone.md"],
      makeDeps(bridge, { confirmRemove: async () => false }),
    );
    expect(cancelled).toEqual({ removed: false });
    expect(store.has("gone.md")).toBe(true);

    const removed = await handleBrokerRequest("remove", ["gone.md"], makeDeps(bridge));
    expect(removed).toEqual({ removed: true });
    expect(store.has("gone.md")).toBe(false);
  });

  it("open delegates to openFile", async () => {
    const { bridge } = makeBridge({ "n.md": "x" });
    const openFile = vi.fn();
    const result = await handleBrokerRequest("open", ["n.md"], makeDeps(bridge, { openFile }));
    expect(openFile).toHaveBeenCalledWith("n.md");
    expect(result).toEqual({ opened: "n.md" });
  });

  it("rejects traversal / absolute / scheme-looking paths before the Bridge", async () => {
    const { bridge } = makeBridge({ "n.md": "x" });
    const read = vi.spyOn(bridge, "readVaultDoc");
    for (const bad of [
      "../secret.md",
      "/etc/passwd",
      "a/../../b.md",
      "vault-app://app/x",
      "C:\\x",
    ]) {
      await expect(handleBrokerRequest("read", [bad], makeDeps(bridge))).rejects.toThrow(
        /invalid vault path/,
      );
    }
    expect(read).not.toHaveBeenCalled();
  });

  it("rejects an unknown method", async () => {
    const { bridge } = makeBridge();
    await expect(handleBrokerRequest("evict", [], makeDeps(bridge))).rejects.toThrow(
      /unknown method/,
    );
  });
});
