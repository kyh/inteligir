import type { PhrasingContent } from "mdast";
import { toMarkdown } from "mdast-util-to-markdown";
import { describe, expect, it } from "vitest";

import { MD_STRINGIFY } from "../md-plugins";

const breakAfter = (before: PhrasingContent): string =>
  toMarkdown(
    {
      children: [
        {
          children: [before, { type: "break" }, { type: "text", value: "next" }],
          type: "paragraph",
        },
      ],
      type: "root",
    },
    MD_STRINGIFY,
  );

describe("MD_STRINGIFY hard break", () => {
  it("is a backslash after ordinary text", () => {
    expect(breakAfter({ type: "text", value: "line" })).toBe("line\\\nnext\n");
  });

  it("is two trailing spaces after a bare url, which would read a backslash as its own", () => {
    const rows: [PhrasingContent, string][] = [
      [{ type: "text", value: "see https://example.com/a" }, "see https://example.com/a  \nnext\n"],
      [{ type: "html", value: "www.example.com" }, "www.example.com  \nnext\n"],
      [
        { children: [{ type: "text", value: "http://example.com" }], type: "strong" },
        "**http://example.com**  \nnext\n",
      ],
    ];
    for (const [before, expected] of rows) {
      expect(breakAfter(before)).toBe(expected);
    }
  });

  it("stays a backslash after a url in link syntax", () => {
    const link: PhrasingContent = {
      children: [{ type: "text", value: "https://example.com" }],
      type: "link",
      url: "https://example.com",
    };
    expect(breakAfter(link)).toBe("[https://example.com](https://example.com)\\\nnext\n");
  });
});
