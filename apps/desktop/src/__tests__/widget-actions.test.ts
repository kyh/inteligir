import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  shell: { openExternal: vi.fn() },
}));

import { fetchHttpText, openHttpUrl } from "@/main/widget-actions";

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
