import { describe, expect, it, vi } from "vitest";

import type { BacklinkEntry } from "@repo/core/knowledge/link-graph-index";
import type { VaultEntry } from "@repo/features/ipc-registry";

import { handleBrokerRequest, type BrokerBridge, type BrokerDeps } from "./html-app-broker";

// A minimal in-memory Bridge slice standing in for the real host. `searchVault`
// is a substring stub (path OR content match), so tests seed paths and assert
// the {query,limit} routing directly; `getBacklinks` returns the seeded map.
function makeBridge(
  seed: Record<string, string> = {},
  opts: { backlinks?: Record<string, BacklinkEntry[]>; tags?: Record<string, string[]> } = {},
): {
  bridge: BrokerBridge;
  store: Map<string, string>;
  kinds: Map<string, VaultEntry["kind"]>;
  searchVault: ReturnType<typeof vi.fn>;
  getBacklinks: ReturnType<typeof vi.fn>;
  getNotesByTag: ReturnType<typeof vi.fn>;
} {
  const store = new Map<string, string>(Object.entries(seed));
  const kinds = new Map<string, VaultEntry["kind"]>();
  for (const path of store.keys()) kinds.set(path, path.endsWith(".md") ? "doc" : "other");
  const searchVault = vi.fn(async ({ query, limit }: { query: string; limit?: number }) => {
    const matches = [...store.keys()]
      .filter((path) => (kinds.get(path) ?? "doc") === "doc" && path.includes(query))
      .map((path) => ({ path, title: path, snippet: `hit:${query}`, score: 1 }));
    return typeof limit === "number" ? matches.slice(0, limit) : matches;
  });
  const getBacklinks = vi.fn(async ({ path }: { path: string }) => opts.backlinks?.[path] ?? []);
  const getNotesByTag = vi.fn(async ({ tag }: { tag: string }) => opts.tags?.[tag] ?? []);
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
    searchVault,
    getBacklinks,
    getNotesByTag,
  };
  return { bridge, store, kinds, searchVault, getBacklinks, getNotesByTag };
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

  it("bare list() is unchanged: every doc, no cap, {path,name}", async () => {
    const seed: Record<string, string> = {};
    for (let i = 0; i < 120; i++) seed[`n${i}.md`] = "x";
    const { bridge, searchVault } = makeBridge(seed);
    const result = await handleBrokerRequest("list", [], makeDeps(bridge));
    expect(result).toHaveLength(120);
    expect(searchVault).not.toHaveBeenCalled();
  });

  it("list with a query routes through searchVault and keeps snippets", async () => {
    const { bridge, searchVault } = makeBridge({
      "projects/a.md": "x",
      "projects/b.md": "y",
      "other.md": "z",
    });
    const result = await handleBrokerRequest("list", [{ query: "projects" }], makeDeps(bridge));
    expect(searchVault).toHaveBeenCalledWith({ query: "projects", limit: 50 });
    expect(result).toEqual([
      { path: "projects/a.md", name: "a.md", snippet: "hit:projects" },
      { path: "projects/b.md", name: "b.md", snippet: "hit:projects" },
    ]);
  });

  it("list withProperties (no query) attaches parsed frontmatter", async () => {
    const { bridge } = makeBridge({ "a.md": "---\ntag: x\n---\nbody\n" });
    const result = await handleBrokerRequest("list", [{ withProperties: true }], makeDeps(bridge));
    expect(result).toEqual([{ path: "a.md", name: "a.md", properties: { tag: "x" } }]);
  });

  it("list withProperties + query carries BOTH snippet and properties", async () => {
    const { bridge } = makeBridge({ "proj.md": "---\npriority: 1\n---\nbody\n" });
    const result = await handleBrokerRequest(
      "list",
      [{ query: "proj", withProperties: true }],
      makeDeps(bridge),
    );
    expect(result).toEqual([
      { path: "proj.md", name: "proj.md", snippet: "hit:proj", properties: { priority: 1 } },
    ]);
  });

  it("list with a tag routes through getNotesByTag as {path,name}", async () => {
    const { bridge, getNotesByTag, searchVault } = makeBridge(
      { "a.md": "x", "b.md": "y", "c.md": "z" },
      { tags: { meta: ["a.md", "b.md"] } },
    );
    const result = await handleBrokerRequest("list", [{ tag: "meta" }], makeDeps(bridge));
    expect(getNotesByTag).toHaveBeenCalledWith({ tag: "meta" });
    expect(searchVault).not.toHaveBeenCalled();
    expect(result).toEqual([
      { path: "a.md", name: "a.md" },
      { path: "b.md", name: "b.md" },
    ]);
  });

  it("list with tag + query narrows the search within the tagged set", async () => {
    const { bridge } = makeBridge(
      { "projects/a.md": "x", "projects/b.md": "y", "other.md": "z" },
      { tags: { meta: ["projects/a.md", "other.md"] } },
    );
    // searchVault matches by path substring "projects"; only projects/a.md is
    // also tagged, so projects/b.md (matched query, untagged) drops.
    const result = await handleBrokerRequest(
      "list",
      [{ tag: "meta", query: "projects" }],
      makeDeps(bridge),
    );
    expect(result).toEqual([{ path: "projects/a.md", name: "a.md", snippet: "hit:projects" }]);
  });

  it("list with tag + withProperties attaches parsed frontmatter", async () => {
    const { bridge } = makeBridge(
      { "a.md": "---\nk: v\n---\nbody\n" },
      { tags: { meta: ["a.md"] } },
    );
    const result = await handleBrokerRequest(
      "list",
      [{ tag: "meta", withProperties: true }],
      makeDeps(bridge),
    );
    expect(result).toEqual([{ path: "a.md", name: "a.md", properties: { k: "v" } }]);
  });

  it("list defaults limit to 50 and hard-caps it at 200", async () => {
    const { bridge, searchVault } = makeBridge();
    await handleBrokerRequest("list", [{ query: "x" }], makeDeps(bridge));
    expect(searchVault).toHaveBeenLastCalledWith({ query: "x", limit: 50 });
    await handleBrokerRequest("list", [{ query: "x", limit: 999 }], makeDeps(bridge));
    expect(searchVault).toHaveBeenLastCalledWith({ query: "x", limit: 200 });
  });

  it("list withProperties reads no more docs than the cap (cap-first)", async () => {
    const seed: Record<string, string> = {};
    for (let i = 0; i < 120; i++) seed[`n${i}.md`] = `---\ni: ${i}\n---\n`;
    const { bridge } = makeBridge(seed);
    const read = vi.spyOn(bridge, "readVaultDoc");
    const result = await handleBrokerRequest(
      "list",
      [{ withProperties: true, limit: 10 }],
      makeDeps(bridge),
    );
    expect(result).toHaveLength(10);
    expect(read).toHaveBeenCalledTimes(10);
  });

  it("list rejects unknown option keys", async () => {
    const { bridge } = makeBridge();
    await expect(handleBrokerRequest("list", [{ bogus: 1 }], makeDeps(bridge))).rejects.toThrow(
      /invalid list options/,
    );
  });

  it("backlinks returns deduped source paths (mirrors get_backlinks)", async () => {
    const { bridge } = makeBridge(
      { "t.md": "x" },
      {
        backlinks: {
          "t.md": [
            { sourcePath: "a.md", line: 1, snippet: "", kind: "wiki", embed: false },
            { sourcePath: "a.md", line: 5, snippet: "", kind: "wiki", embed: false },
            { sourcePath: "b.md", line: 2, snippet: "", kind: "md", embed: false },
          ],
        },
      },
    );
    const result = await handleBrokerRequest("backlinks", ["t.md"], makeDeps(bridge));
    expect(result).toEqual(["a.md", "b.md"]);
  });

  it("backlinks rejects an unsafe path before the Bridge", async () => {
    const { bridge, getBacklinks } = makeBridge();
    await expect(handleBrokerRequest("backlinks", ["../x.md"], makeDeps(bridge))).rejects.toThrow(
      /invalid vault path/,
    );
    expect(getBacklinks).not.toHaveBeenCalled();
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
