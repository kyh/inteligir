import { describe, it, expect, vi } from "vitest";

import type { BacklinkEntry, SearchResult } from "@repo/core/knowledge/knowledge-index";

import knowledgeExtension from "../agent/knowledge/extension";
import {
  validateToolParametersSchema,
  type AgentPorts,
  type KnowledgePort,
} from "../agent/extension";
import type { ExtensionAPI } from "@repo/features/server/pi/pi-types";

// ---------------------------------------------------------------------------
// A minimal ExtensionAPI stub that just records registered tools so we can
// invoke their execute() directly and assert on the formatted result text.
// ---------------------------------------------------------------------------

type RegisteredTool = {
  name: string;
  parameters?: unknown;
  execute: (
    toolCallId: string,
    params: unknown,
  ) => Promise<{ content: { type: string; text?: string }[] }>;
};

function capture(port: KnowledgePort): Map<string, RegisteredTool> {
  const tools = new Map<string, RegisteredTool>();
  const pi = {
    registerTool: (tool: RegisteredTool) => tools.set(tool.name, tool),
  } as unknown as ExtensionAPI;
  const ports = { knowledge: port } as unknown as AgentPorts;
  knowledgeExtension.register({ binDir: "/fake/bin", ports })(pi);
  return tools;
}

function tool(tools: Map<string, RegisteredTool>, name: string): RegisteredTool {
  const found = tools.get(name);
  if (!found) throw new Error(`tool ${name} not registered`);
  return found;
}

const text = (result: { content: { type: string; text?: string }[] }): string =>
  result.content.map((c) => c.text ?? "").join("");

function searchResult(path: string, snippet: string): SearchResult {
  return { path, title: path, snippet, score: 1 };
}

function backlink(sourcePath: string, line: number): BacklinkEntry {
  return { sourcePath, line, snippet: "", kind: "wiki", embed: false };
}

const emptyPort: KnowledgePort = { search: () => [], backlinks: () => [], notesWithTag: () => [] };

describe("knowledge extension tools", () => {
  it("registers search_vault and get_backlinks with valid schemas", () => {
    const tools = capture(emptyPort);
    expect([...tools.keys()].toSorted()).toEqual(["get_backlinks", "search_vault"]);
    for (const [, tool] of tools) {
      expect(() => validateToolParametersSchema(tool, "knowledge")).not.toThrow();
    }
  });

  it("search_vault formats hits as 'path — snippet', one per line", async () => {
    const search = vi.fn(() => [searchResult("a.md", "alpha"), searchResult("b.md", "beta")]);
    const tools = capture({ ...emptyPort, search });
    const result = await tool(tools, "search_vault").execute("id", { query: "x" });
    expect(text(result)).toBe("a.md — alpha\nb.md — beta");
  });

  it("search_vault returns the No matches. sentinel on empty results", async () => {
    const tools = capture(emptyPort);
    const result = await tool(tools, "search_vault").execute("id", { query: "nope" });
    expect(text(result)).toBe("No matches.");
  });

  it("search_vault applies the default limit and hard-caps at 50", async () => {
    const search = vi.fn(() => []);
    const tools = capture({ ...emptyPort, search });
    const searchTool = tool(tools, "search_vault");
    await searchTool.execute("id", { query: "x" });
    expect(search).toHaveBeenLastCalledWith("x", 20);
    await searchTool.execute("id", { query: "x", limit: 999 });
    expect(search).toHaveBeenLastCalledWith("x", 50);
    await searchTool.execute("id", { query: "x", limit: 3 });
    expect(search).toHaveBeenLastCalledWith("x", 3);
  });

  it("search_vault with tag alone lists the tagged notes (sorted)", async () => {
    const notesWithTag = vi.fn(() => ["b.md", "a.md"]);
    const tools = capture({ ...emptyPort, notesWithTag });
    const result = await tool(tools, "search_vault").execute("id", { tag: "meta" });
    expect(notesWithTag).toHaveBeenCalledWith("meta");
    expect(text(result)).toBe("a.md\nb.md");
  });

  it("search_vault with tag + query narrows within the tagged set", async () => {
    const search = vi.fn(() => [searchResult("a.md", "alpha"), searchResult("c.md", "gamma")]);
    const notesWithTag = vi.fn(() => ["a.md", "b.md"]);
    const tools = capture({ ...emptyPort, search, notesWithTag });
    const result = await tool(tools, "search_vault").execute("id", { tag: "meta", query: "x" });
    // c.md matched the query but isn't tagged, so it drops.
    expect(text(result)).toBe("a.md — alpha");
  });

  it("search_vault with an unknown tag returns No matches.", async () => {
    const tools = capture(emptyPort);
    const result = await tool(tools, "search_vault").execute("id", { tag: "nope" });
    expect(text(result)).toBe("No matches.");
  });

  it("get_backlinks lists unique source paths, one per line", async () => {
    const backlinks = vi.fn(() => [backlink("a.md", 1), backlink("a.md", 5), backlink("b.md", 2)]);
    const tools = capture({ ...emptyPort, backlinks });
    const result = await tool(tools, "get_backlinks").execute("id", { path: "t.md" });
    expect(text(result)).toBe("a.md\nb.md");
  });

  it("get_backlinks returns the No backlinks. sentinel on empty results", async () => {
    const tools = capture(emptyPort);
    const result = await tool(tools, "get_backlinks").execute("id", { path: "t.md" });
    expect(text(result)).toBe("No backlinks.");
  });
});
