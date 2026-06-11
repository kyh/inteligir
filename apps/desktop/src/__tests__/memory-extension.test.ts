import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildMemoryTool,
  createProfileCache,
  type MemoryToolClient,
} from "@/agent/memory/extension";
import { validateToolParametersSchema } from "@/agent/extension";
import { MemoryClient, MemoryUnavailableError, resolveMemoryConfig } from "@/agent/memory/client";

// The tool receives the client as a method surface (MemoryToolClient), so the
// test injects fakes directly instead of intercepting fetch.
const add = vi.fn<MemoryToolClient["add"]>();
const search = vi.fn<MemoryToolClient["search"]>();
const profile = vi.fn<MemoryToolClient["profile"]>();
const list = vi.fn<MemoryToolClient["list"]>();
const forget = vi.fn<MemoryToolClient["forget"]>();

const memoryTool = buildMemoryTool({ add, search, profile, list, forget });

function textOf(result: { content: [{ type: "text"; text: string }] }): string {
  return result.content[0].text;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("memory parameters schema", () => {
  it("passes provider root-shape validation (type: object, no root anyOf)", () => {
    expect(() => validateToolParametersSchema(memoryTool, "memory")).not.toThrow();
  });
});

describe("memory tool execute", () => {
  it("add stores content under the agent source tag", async () => {
    add.mockResolvedValue({ id: "doc-1", status: "queued" });
    const result = await memoryTool.execute("t1", { action: "add", content: "User likes tea" });
    expect(add).toHaveBeenCalledWith("User likes tea", { source: "agent" });
    expect(textOf(result)).toBe("Stored memory doc-1 (status: queued).");
  });

  it("add without content is a self-correcting error", async () => {
    const result = await memoryTool.execute("t1", { action: "add" });
    expect(add).not.toHaveBeenCalled();
    expect(textOf(result)).toContain("'content' is required");
  });

  it("search renders memory and chunk hits with scores", async () => {
    search.mockResolvedValue({
      results: [
        { id: "m1", memory: "User likes tea", similarity: 0.91 },
        { id: "c1", chunk: "tea > coffee", similarity: 0.5 },
      ],
      total: 2,
    });
    const result = await memoryTool.execute("t1", { action: "search", query: "drinks" });
    expect(search).toHaveBeenCalledWith("drinks", 10);
    expect(textOf(result)).toContain("[0.91] User likes tea (m1)");
    expect(textOf(result)).toContain("[0.50] tea > coffee (c1)");
  });

  it("clamps malformed limits before they reach the server", async () => {
    search.mockResolvedValue({ results: [], total: 0 });
    await memoryTool.execute("t1", { action: "search", query: "x", limit: 1e9 });
    expect(search).toHaveBeenLastCalledWith("x", 100);
    await memoryTool.execute("t1", { action: "search", query: "x", limit: -3 });
    expect(search).toHaveBeenLastCalledWith("x", 1);
    await memoryTool.execute("t1", { action: "search", query: "x", limit: 2.9 });
    expect(search).toHaveBeenLastCalledWith("x", 2);
    list.mockResolvedValue([]);
    await memoryTool.execute("t1", { action: "list", limit: Number.NaN });
    expect(list).toHaveBeenLastCalledWith(20);
  });

  it("search with no hits says so", async () => {
    search.mockResolvedValue({ results: [], total: 0 });
    const result = await memoryTool.execute("t1", { action: "search", query: "nothing" });
    expect(textOf(result)).toBe('No memories matched "nothing".');
  });

  it("profile formats static and dynamic sections", async () => {
    profile.mockResolvedValue({ static: ["Lives in SF"], dynamic: ["Planning a trip"] });
    const result = await memoryTool.execute("t1", { action: "profile" });
    expect(textOf(result)).toBe(
      "Stable facts:\n- Lives in SF\n\nRecent context:\n- Planning a trip",
    );
  });

  it("forget requires an id or content description", async () => {
    const result = await memoryTool.execute("t1", { action: "forget" });
    expect(forget).not.toHaveBeenCalled();
    expect(textOf(result)).toContain("'memoryId' or a 'content' description");
  });

  it("forget passes through id and reason", async () => {
    forget.mockResolvedValue({ id: "m1", forgotten: true });
    const result = await memoryTool.execute("t1", {
      action: "forget",
      memoryId: "m1",
      reason: "user asked",
    });
    expect(forget).toHaveBeenCalledWith({ id: "m1", reason: "user asked" });
    expect(textOf(result)).toBe("Forgot memory m1.");
  });

  it("an unreachable server turns into setup guidance, not a stack trace", async () => {
    search.mockRejectedValue(
      new MemoryUnavailableError("http://localhost:6767", new TypeError("fetch failed")),
    );
    const result = await memoryTool.execute("t1", { action: "search", query: "x" });
    expect(textOf(result)).toContain("npx supermemory local");
    expect(textOf(result)).toContain("Continue without memory");
  });

  it("a custom-configured server gets check-the-URL guidance, not local setup", async () => {
    search.mockRejectedValue(
      new MemoryUnavailableError("http://10.0.0.5:6767", new TypeError("fetch failed")),
    );
    const result = await memoryTool.execute("t1", { action: "search", query: "x" });
    expect(textOf(result)).toContain("SUPERMEMORY_BASE_URL");
    expect(textOf(result)).not.toContain("npx supermemory local");
  });

  it("other server errors are reported as tool errors", async () => {
    list.mockRejectedValue(new Error("boom"));
    const result = await memoryTool.execute("t1", { action: "list" });
    expect(textOf(result)).toBe("memory error: boom");
  });
});

describe("createProfileCache", () => {
  it("waits for the first load, then serves cached and refreshes in background", async () => {
    profile.mockResolvedValue({ static: ["a"], dynamic: [] });
    const cache = createProfileCache({ profile });

    expect(await cache.get()).toEqual({ static: ["a"], dynamic: [] });
    expect(profile).toHaveBeenCalledTimes(1);

    // Second read returns the cache immediately and schedules a refresh.
    profile.mockResolvedValue({ static: ["a", "b"], dynamic: [] });
    expect(await cache.get()).toEqual({ static: ["a"], dynamic: [] });
    expect(profile).toHaveBeenCalledTimes(2);
  });

  it("drops the cached profile when the server goes down", async () => {
    profile.mockResolvedValue({ static: ["a"], dynamic: [] });
    const cache = createProfileCache({ profile });
    expect(await cache.get()).toEqual({ static: ["a"], dynamic: [] });

    // Server goes away — the next settled refresh must clear the snapshot
    // so priming goes silent instead of replaying stale facts.
    profile.mockRejectedValue(
      new MemoryUnavailableError("http://localhost:6767", new TypeError("fetch failed")),
    );
    await cache.refresh();
    expect(await cache.get()).toBeNull();
  });

  it("keeps the last good profile through a transient server error", async () => {
    profile.mockResolvedValue({ static: ["a"], dynamic: [] });
    const cache = createProfileCache({ profile });
    expect(await cache.get()).toEqual({ static: ["a"], dynamic: [] });

    // Reachable server, failed request (e.g. HTTP 500) — durable facts
    // don't expire because one request failed.
    profile.mockRejectedValue(new Error("supermemory POST /v4/profile failed (500): boom"));
    await cache.refresh();
    expect(await cache.get()).toEqual({ static: ["a"], dynamic: [] });
  });

  it("returns null without throwing when the server is down", async () => {
    profile.mockRejectedValue(
      new MemoryUnavailableError("http://localhost:6767", new TypeError("fetch failed")),
    );
    const cache = createProfileCache({ profile }, 50);
    expect(await cache.get()).toBeNull();
  });

  it("spends the cold-start wait once, even while the first request hangs", async () => {
    // Every profile call hangs (slow/unreachable host) — worst case for
    // blocking. Only the first read may pay firstLoadWaitMs; later reads
    // must return immediately even though the first request never settled.
    profile.mockImplementation(() => new Promise<never>(() => {}));
    const cache = createProfileCache({ profile }, 500);

    const first = Date.now();
    expect(await cache.get()).toBeNull();
    expect(Date.now() - first).toBeGreaterThanOrEqual(450);

    const second = Date.now();
    expect(await cache.get()).toBeNull();
    expect(Date.now() - second).toBeLessThan(400);
  });
});

describe("MemoryClient error classification", () => {
  const client = new MemoryClient({ baseUrl: "http://localhost:6767" });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("add fails loudly when the server confirms no document id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("{}", { status: 200 }))),
    );
    await expect(client.add("fact")).rejects.toThrow(/no document id/);
  });

  it("connection failure becomes MemoryUnavailableError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("fetch failed"))),
    );
    await expect(client.profile()).rejects.toBeInstanceOf(MemoryUnavailableError);
  });

  it("timeout from a reachable-but-slow server is a plain error, not unavailability", async () => {
    const timeout = new Error("The operation was aborted due to timeout");
    timeout.name = "TimeoutError";
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(timeout)),
    );
    const err: unknown = await client.profile().then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(MemoryUnavailableError);
    if (err instanceof Error) expect(err.message).toMatch(/timed out after/);
  });
});

describe("resolveMemoryConfig", () => {
  it("defaults to the local server with no key", () => {
    expect(resolveMemoryConfig({})).toEqual({ baseUrl: "http://localhost:6767" });
  });

  it("honors SUPERMEMORY_BASE_URL (trailing slash stripped) and SUPERMEMORY_API_KEY", () => {
    expect(
      resolveMemoryConfig({
        SUPERMEMORY_BASE_URL: "http://10.0.0.5:6767/",
        SUPERMEMORY_API_KEY: "sm_test",
      }),
    ).toEqual({ baseUrl: "http://10.0.0.5:6767", apiKey: "sm_test" });
  });
});
