import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  shell: { openExternal: vi.fn() },
}));

vi.mock("@/main/executor/executor-client", () => ({
  execute: vi.fn(),
}));

import { execute } from "@/main/executor/executor-client";
import { fetchHttpText, openHttpUrl, widgetCallTool } from "@/main/widget-actions";

const mockExecute = vi.mocked(execute);

describe("widget action network helpers", () => {
  it("rejects non-http fetch URLs before calling fetch", async () => {
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(fetchHttpText("file:///tmp/secret", { fetchImpl })).rejects.toThrow(
      "Only http(s) URLs can be fetched",
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects redirects to non-http URLs", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    fetchImpl.mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "file:///tmp/secret" },
      }),
    );

    await expect(fetchHttpText("https://example.com", { fetchImpl })).rejects.toThrow(
      "Only http(s) URLs can be fetched",
    );
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("follows relative redirects", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    fetchImpl
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "/next" },
        }),
      )
      .mockResolvedValueOnce(new Response("ok"));

    await expect(fetchHttpText("https://example.com/start", { fetchImpl })).resolves.toBe("ok");
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://example.com/next",
      expect.objectContaining({ redirect: "manual" }),
    );
  });

  it("caps fetched text", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    fetchImpl.mockResolvedValue(new Response("abcdef"));

    await expect(fetchHttpText("https://example.com", { fetchImpl, textCap: 3 })).resolves.toBe(
      "abc",
    );
  });

  it("does not open non-http URLs", async () => {
    const openExternal = vi.fn(async (_url: string) => undefined);

    await expect(openHttpUrl("ftp://example.com/file", openExternal)).resolves.toBe(false);
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("opens http URLs through the injected opener", async () => {
    const openExternal = vi.fn(async (_url: string) => undefined);

    await expect(openHttpUrl("https://example.com", openExternal)).resolves.toBe(true);
    expect(openExternal).toHaveBeenCalledWith("https://example.com");
  });
});

describe("widgetCallTool", () => {
  it("rejects tool paths that aren't a plain namespaced accessor", async () => {
    for (const bad of ["", "github", "github.search; rm -rf /", "tools['x']", "a.b()"]) {
      await expect(widgetCallTool(bad, {})).rejects.toThrow(/Invalid tool path/);
    }
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("runs a namespaced call with JSON-serialized input and returns the unwrapped data", async () => {
    mockExecute.mockResolvedValue({
      status: "completed",
      text: "",
      structured: [{ title: "issue 1" }],
      isError: false,
    });

    const data = await widgetCallTool("github.search_issues", { query: "bug" });

    expect(data).toEqual([{ title: "issue 1" }]);
    const code = mockExecute.mock.calls[0]?.[0] ?? "";
    expect(code).toContain("tools.github.search_issues(__input)");
    expect(code).toContain('{"query":"bug"}');
    // unwraps the { ok, data } envelope
    expect(code).toContain("__r.ok !== true");
  });

  it("surfaces an execution error", async () => {
    mockExecute.mockResolvedValue({
      status: "completed",
      text: "rate limited",
      structured: undefined,
      isError: true,
    });

    await expect(widgetCallTool("github.search_issues", {})).rejects.toThrow("rate limited");
  });

  it("rejects when the execution pauses for interaction", async () => {
    mockExecute.mockResolvedValue({ status: "paused", text: "", structured: undefined });

    await expect(widgetCallTool("github.search_issues", {})).rejects.toThrow(
      "requires interaction",
    );
  });
});
