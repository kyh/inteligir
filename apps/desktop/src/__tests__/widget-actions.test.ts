import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  shell: { openExternal: vi.fn() },
}));

vi.mock("@/main/executor/executor-client", () => ({
  execute: vi.fn(),
}));

import { execute } from "@/main/executor/executor-client";
import { fetchHttpText, openHttpUrl, widgetCallTool } from "@/main/widget-actions";

const mockExecute = vi.mocked(execute);

// Deterministic DNS for tests — hostnames resolve to a public address unless
// a test overrides it. Keeps fetchHttpText off the real resolver.
const publicLookup = async () => [{ address: "93.184.216.34" }];

describe("widget action network helpers", () => {
  it("rejects non-http fetch URLs before calling fetch", async () => {
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(
      fetchHttpText("file:///tmp/secret", { fetchImpl, lookup: publicLookup }),
    ).rejects.toThrow("Only http(s) URLs can be fetched");
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

    await expect(
      fetchHttpText("https://example.com", { fetchImpl, lookup: publicLookup }),
    ).rejects.toThrow("Only http(s) URLs can be fetched");
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

    await expect(
      fetchHttpText("https://example.com/start", { fetchImpl, lookup: publicLookup }),
    ).resolves.toBe("ok");
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://example.com/next",
      expect.objectContaining({ redirect: "manual" }),
    );
  });

  it("caps fetched text", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    fetchImpl.mockResolvedValue(new Response("abcdef"));

    await expect(
      fetchHttpText("https://example.com", { fetchImpl, lookup: publicLookup, textCap: 3 }),
    ).resolves.toBe("abc");
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

describe("fetchHttpText SSRF guard", () => {
  it.each([
    ["loopback", "http://127.0.0.1/admin"],
    ["loopback range", "http://127.1.2.3/"],
    ["10/8 private", "http://10.0.0.1/"],
    ["172.16/12 private (low edge)", "http://172.16.0.1/"],
    ["172.16/12 private (high edge)", "http://172.31.255.255/"],
    ["192.168/16 private", "http://192.168.1.1/"],
    ["169.254/16 link-local metadata", "http://169.254.169.254/latest/meta-data/"],
    ["0/8 this-network", "http://0.0.0.0/"],
    ["IPv6 loopback", "http://[::1]:8080/"],
    ["IPv6 unspecified", "http://[::]/"],
    ["IPv6 unique-local fc00::/7", "http://[fc00::1]/"],
    ["IPv6 unique-local fd00", "http://[fd12:3456::1]/"],
    ["IPv6 link-local fe80::/10", "http://[fe80::1]/"],
    ["IPv4-mapped IPv6 private", "http://[::ffff:10.0.0.1]/"],
    ["decimal-obfuscated loopback", "http://2130706433/"],
  ])("blocks %s without calling fetch", async (_label, url) => {
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(fetchHttpText(url, { fetchImpl, lookup: publicLookup })).rejects.toThrow(
      /private or reserved address/,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("blocks hostnames that resolve to a private address", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const lookup = vi.fn(async () => [{ address: "192.168.0.5" }]);

    await expect(
      fetchHttpText("http://internal.corp.example/", { fetchImpl, lookup }),
    ).rejects.toThrow(/private or reserved address \(internal\.corp\.example → 192\.168\.0\.5\)/);
    expect(lookup).toHaveBeenCalledWith("internal.corp.example");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("blocks hostnames when ANY resolved record is private (rebinding-shaped answers)", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const lookup = vi.fn(async () => [{ address: "93.184.216.34" }, { address: "10.0.0.7" }]);

    await expect(fetchHttpText("http://evil.example/", { fetchImpl, lookup })).rejects.toThrow(
      /private or reserved address/,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("blocks hostnames resolving to a private IPv6 address", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const lookup = vi.fn(async () => [{ address: "fe80::dead:beef" }]);

    await expect(fetchHttpText("http://router.example/", { fetchImpl, lookup })).rejects.toThrow(
      /private or reserved address/,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("blocks a redirect that lands on a private address", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    fetchImpl.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: "http://169.254.169.254/latest/meta-data/" },
      }),
    );

    await expect(
      fetchHttpText("https://example.com/start", { fetchImpl, lookup: publicLookup }),
    ).rejects.toThrow(/private or reserved address/);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("blocks a redirect to a hostname that resolves private", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    fetchImpl.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: "http://internal.corp.example/" },
      }),
    );
    const lookup = vi.fn(async (hostname: string) =>
      hostname === "internal.corp.example"
        ? [{ address: "127.0.0.1" }]
        : [{ address: "93.184.216.34" }],
    );

    await expect(fetchHttpText("https://example.com/start", { fetchImpl, lookup })).rejects.toThrow(
      /private or reserved address/,
    );
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("allows public literal IPs just outside the private ranges", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    fetchImpl.mockImplementation(async () => new Response("ok"));

    // 172.32.0.1 is the first address past 172.16/12; 11.0.0.1 past 10/8.
    await expect(
      fetchHttpText("http://172.32.0.1/", { fetchImpl, lookup: publicLookup }),
    ).resolves.toBe("ok");
    await expect(
      fetchHttpText("http://11.0.0.1/", { fetchImpl, lookup: publicLookup }),
    ).resolves.toBe("ok");
  });

  it("allows hostnames that resolve to public addresses", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    fetchImpl.mockResolvedValue(new Response("ok"));
    const lookup = vi.fn(async () => [{ address: "93.184.216.34" }, { address: "2606:2800::1" }]);

    await expect(fetchHttpText("https://example.com/", { fetchImpl, lookup })).resolves.toBe("ok");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("fails when the hostname does not resolve", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const lookup = vi.fn(async (): Promise<{ address: string }[]> => []);

    await expect(fetchHttpText("https://nowhere.example/", { fetchImpl, lookup })).rejects.toThrow(
      /Could not resolve host/,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("widgetCallTool", () => {
  beforeEach(() => {
    mockExecute.mockReset();
  });

  it("rejects tool paths that aren't a plain namespaced accessor", async () => {
    for (const bad of ["", "github", "github.search; rm -rf /", "tools['x']", "a.b()"]) {
      await expect(widgetCallTool(bad, {})).rejects.toThrow(/Invalid tool path/);
    }
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("rejects paths with JS meta segments that would reach runtime internals", async () => {
    for (const bad of [
      "github.constructor",
      "a.__proto__",
      "x.prototype",
      "__proto__.x",
      "ns.constructor.tool",
    ]) {
      await expect(widgetCallTool(bad, {})).rejects.toThrow(/Invalid tool path/);
    }
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("runs a namespaced call and returns the unwrapped data", async () => {
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
    // Input is parsed from a JSON string in-sandbox (not a JS literal), so a
    // "__proto__" key stays a data property instead of a prototype setter.
    expect(code).toContain("JSON.parse(");
    expect(code).toContain("query");
    // unwraps the { ok, data } envelope
    expect(code).toContain("__r.ok !== true");
  });

  it("embeds input as a parsed JSON string so a __proto__ key stays data", async () => {
    mockExecute.mockResolvedValue({
      status: "completed",
      text: "",
      structured: null,
      isError: false,
    });

    // Computed key avoids the literal __proto__ setter when building the input.
    const input = { ["__proto__"]: { polluted: true } };
    await widgetCallTool("ns.tool", input);

    const firstLine = (mockExecute.mock.calls[0]?.[0] ?? "").split("\n")[0];
    // The bug being guarded: `const __input = {"__proto__":{...}}` evaluates the
    // key as a prototype setter. Parsing a JSON string literal instead keeps it
    // a plain data property.
    expect(firstLine).toBe(`const __input = JSON.parse(${JSON.stringify(JSON.stringify(input))});`);
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
