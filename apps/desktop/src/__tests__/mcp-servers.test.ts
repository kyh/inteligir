import { describe, it, expect } from "vitest";

import { type FsAdapter } from "@/main/lib/json-store";
import { McpServersManager } from "@/main/mcp/mcp-servers";
import { mcpServerSlug } from "@/shared/mcp";

function memoryFs(): FsAdapter & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    read: (path) => files.get(path) ?? null,
    write: (path, content) => {
      files.set(path, content);
    },
  };
}

function manager(fs = memoryFs()): { mgr: McpServersManager; fs: ReturnType<typeof memoryFs> } {
  return { mgr: new McpServersManager("/mcp.json", fs), fs };
}

describe("McpServersManager", () => {
  it("starts empty", () => {
    const { mgr } = manager();
    expect(mgr.list()).toEqual([]);
    expect(mgr.listEnabled()).toEqual([]);
  });

  it("adds a server enabled by default and persists it", () => {
    const { mgr, fs } = manager();
    const list = mgr.add({ name: "docs", url: "https://example.com/mcp" });

    expect(list).toEqual([{ name: "docs", url: "https://example.com/mcp", enabled: true }]);
    expect(JSON.parse(fs.files.get("/mcp.json")!)).toEqual({
      mcpServers: { docs: { url: "https://example.com/mcp", enabled: true } },
    });
  });

  it("stores headers only when present", () => {
    const { mgr } = manager();
    mgr.add({ name: "a", url: "https://a.test", headers: { Authorization: "Bearer x" } });
    mgr.add({ name: "b", url: "https://b.test", headers: {} });

    const byName = Object.fromEntries(mgr.list().map((s) => [s.name, s]));
    expect(byName["a"]?.headers).toEqual({ Authorization: "Bearer x" });
    expect(byName["b"]?.headers).toBeUndefined();
  });

  it("toggles enabled and filters listEnabled", () => {
    const { mgr } = manager();
    mgr.add({ name: "docs", url: "https://example.com/mcp" });
    mgr.setEnabled("docs", false);

    expect(mgr.list()[0]?.enabled).toBe(false);
    expect(mgr.listEnabled()).toEqual([]);

    mgr.setEnabled("docs", true);
    expect(mgr.listEnabled().map((s) => s.name)).toEqual(["docs"]);
  });

  it("setEnabled on an unknown server is a no-op", () => {
    const { mgr } = manager();
    expect(mgr.setEnabled("nope", false)).toEqual([]);
  });

  it("removes a server", () => {
    const { mgr } = manager();
    mgr.add({ name: "a", url: "https://a.test" });
    mgr.add({ name: "b", url: "https://b.test" });
    const list = mgr.remove("a");
    expect(list.map((s) => s.name)).toEqual(["b"]);
  });

  it("returns servers sorted by name", () => {
    const { mgr } = manager();
    mgr.add({ name: "zeta", url: "https://z.test" });
    mgr.add({ name: "alpha", url: "https://a.test" });
    expect(mgr.list().map((s) => s.name)).toEqual(["alpha", "zeta"]);
  });

  it("loads pre-existing config from disk", () => {
    const fs = memoryFs();
    fs.files.set(
      "/mcp.json",
      JSON.stringify({ mcpServers: { legacy: { url: "https://legacy.test" } } }),
    );
    const { mgr } = manager(fs);
    expect(mgr.list()).toEqual([{ name: "legacy", url: "https://legacy.test", enabled: true }]);
  });
});

describe("mcpServerSlug", () => {
  it("lowercases and collapses non-alphanumerics", () => {
    expect(mcpServerSlug("My Server")).toBe("my_server");
    expect(mcpServerSlug("foo-bar.baz")).toBe("foo_bar_baz");
    expect(mcpServerSlug("  trimmed  ")).toBe("trimmed");
  });

  it("falls back when nothing usable remains", () => {
    expect(mcpServerSlug("!!!")).toBe("server");
  });
});
