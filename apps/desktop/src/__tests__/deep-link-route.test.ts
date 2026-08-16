import { describe, expect, it } from "vitest";

import { deepLinkPath, extractDeepLinkFromArgv } from "@/main/deep-link-route";

/** The query as a sorted list, so an assertion pins the PARAMETERS rather than
 * the order URLSearchParams happened to emit them in. */
function params(path: string | null): string[] {
  if (path === null) return [];
  const query = new URL(path, "https://example.com").searchParams;
  return [...query.entries()].map(([key, value]) => `${key}=${value}`).toSorted();
}

describe("deepLinkPath", () => {
  it("translates the capture verbs, forwarding the text unsanitized", () => {
    // Sanitizing here as well as in the page would double-escape: the page's
    // parse is the authoritative one.
    const path = deepLinkPath("inteligir://append?text=buy%20%5Bmilk%5D");
    expect(path?.startsWith("/app/link?")).toBe(true);
    expect(params(path)).toEqual(["text=buy [milk]", "verb=append"]);
    expect(params(deepLinkPath("inteligir://task?text=ship%20it"))).toEqual([
      "text=ship it",
      "verb=task",
    ]);
  });

  it("translates the nav verbs", () => {
    expect(params(deepLinkPath("inteligir://today"))).toEqual(["verb=today"]);
    expect(params(deepLinkPath("inteligir://note/notes/ideas.md"))).toEqual([
      "target=notes/ideas.md",
      "verb=note",
    ]);
    expect(params(deepLinkPath("inteligir://search?q=graph%20view"))).toEqual([
      "q=graph view",
      "verb=search",
    ]);
  });

  it("drops every parameter the verb does not name", () => {
    // A page anyone can link to must not be able to smuggle a parameter
    // through this process into a route that was not expecting it.
    expect(params(deepLinkPath("inteligir://today?redirect=https://evil.com&verb=append"))).toEqual(
      ["verb=today"],
    );
  });

  it("refuses the session verb — this shell holds no session to complete", () => {
    const code = "a".repeat(32);
    expect(deepLinkPath(`inteligir://session?code=${code}&state=${code}`)).toBeNull();
  });

  it("refuses anything outside the grammar", () => {
    expect(deepLinkPath("inteligir://unknown")).toBeNull();
    expect(deepLinkPath("https://inteligir.com/app")).toBeNull();
    expect(deepLinkPath("inteligir://note/app.html")).toBeNull();
    expect(deepLinkPath("inteligir://search?q=")).toBeNull();
    expect(deepLinkPath("not a url")).toBeNull();
  });
});

describe("extractDeepLinkFromArgv", () => {
  it("finds the scheme URL win/linux deliver on argv", () => {
    expect(
      extractDeepLinkFromArgv(["/Applications/Inteligir.app", "--flag", "inteligir://today"]),
    ).toBe("inteligir://today");
  });

  it("answers null when there is none", () => {
    expect(extractDeepLinkFromArgv(["/Applications/Inteligir.app", "--flag"])).toBeNull();
  });
});
