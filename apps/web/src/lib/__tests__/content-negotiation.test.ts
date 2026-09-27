import { describe, expect, it } from "vitest";

import { markdownResponse, prefersMarkdown } from "../content-negotiation";

describe("prefersMarkdown", () => {
  it.each([
    "text/markdown",
    "text/markdown, text/html;q=0.9",
    "text/html;q=0.5, text/markdown",
    "text/markdown, */*;q=0.1",
  ])("serves markdown for %s", (accept) => {
    expect(prefersMarkdown(accept)).toBe(true);
  });

  it.each([
    null,
    "",
    "*/*",
    "text/*",
    "text/html",
    "text/html, text/markdown",
    "text/markdown;q=0, */*",
    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "application/json",
  ])("keeps the HTML page for %s", (accept) => {
    expect(prefersMarkdown(accept)).toBe(false);
  });
});

describe("markdownResponse", () => {
  it("answers markdown that varies on Accept", async () => {
    const response = markdownResponse("# Hi");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(response.headers.get("vary")).toContain("Accept");
    expect(await response.text()).toBe("# Hi");
  });

  it("keeps a caller's status and headers", () => {
    const response = markdownResponse("gone", {
      headers: { "Cache-Control": "no-store" },
      status: 404,
    });
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("vary")).toContain("Accept");
  });
});
