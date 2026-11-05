import { describe, expect, it } from "vitest";

import { handleLibraryPage, isLibraryPagePath, libraryPagePolicy } from "./library-page";

const DOCUMENT = "<!doctype html><div id=root></div>";

// the asset server as the build lays it out: the page's document at its directory's slash, and a
// file the build holds by its own path
const assets = (files: Readonly<Record<string, string>>) => ({
  fetch: async (input: RequestInfo | URL): Promise<Response> => {
    const { pathname } = new URL(input instanceof Request ? input.url : input);
    const body = pathname === "/library/" ? DOCUMENT : files[pathname];
    await Promise.resolve();
    return body === undefined ? new Response("missing", { status: 404 }) : new Response(body);
  },
});

const ask = async (path: string, method = "GET") =>
  await handleLibraryPage(new Request(`https://inteligir.com${path}`, { method }), assets({}));

describe("the library's page", () => {
  it("owns its prefix and nothing that only starts like it", () => {
    expect(isLibraryPagePath("/library")).toBe(true);
    expect(isLibraryPagePath("/library/settings")).toBe(true);
    expect(isLibraryPagePath("/libraryish")).toBe(false);
    expect(isLibraryPagePath("/app/sign-in")).toBe(false);
  });

  it("answers its document for every path under it, a deep link's included", async () => {
    for (const path of ["/library", "/library/", "/library/settings", "/library/?item=x"]) {
      const response = await ask(path);
      expect(response.status, path).toBe(200);
      expect(await response.text()).toBe(DOCUMENT);
      expect(response.headers.get("cache-control")).toBe("no-cache");
    }
  });

  it("answers a file the build holds as it is", async () => {
    const response = await handleLibraryPage(
      new Request("https://inteligir.com/library/favicon.svg"),
      assets({ "/library/favicon.svg": "<svg/>" }),
    );
    expect(await response.text()).toBe("<svg/>");
  });

  it("carries the page's own policy: its scripts and SQLite's wasm, calls to this origin alone", async () => {
    const policy = (await ask("/library")).headers.get("content-security-policy") ?? "";
    expect(policy).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(policy).toContain("connect-src 'self' wss://inteligir.com");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(libraryPagePolicy(new URL("http://localhost:5174/library"))).toContain(
      "ws://localhost:5174",
    );
  });

  it("refuses a write, and says when the deploy carries no page", async () => {
    expect((await ask("/library", "POST")).status).toBe(405);
    const unbuilt = await handleLibraryPage(new Request("https://inteligir.com/library"), {
      fetch: async () => await Promise.resolve(new Response("missing", { status: 404 })),
    });
    expect(unbuilt.status).toBe(503);
  });
});
