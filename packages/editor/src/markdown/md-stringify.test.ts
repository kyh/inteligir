import type { TElement } from "platejs";
import { describe, expect, it } from "vitest";

import { readValue, writeValue } from "@repo/editor/test-support/markdown-meaning";

const paragraph = (children: TElement["children"]): TElement => ({ children, type: "p" });

const link = (url: string): TElement => ({ children: [{ text: url }], type: "a", url });

// gfm reads a bare url off finished text, so the url a hard break follows must not take the
// break's backslash as its own
describe("a hard break", () => {
  it("is a backslash, and reads back a break after text, a url and a link alike", () => {
    const rows: [TElement, string][] = [
      [paragraph([{ text: "line\nnext" }]), "line\\\nnext\n"],
      [
        paragraph([{ text: "see " }, link("https://example.com/a"), { text: "\nnext" }]),
        "see <https://example.com/a>\\\nnext\n",
      ],
      [
        paragraph([link("https://example.com/a!"), { text: "\nnext" }]),
        "<https://example.com/a!>\\\nnext\n",
      ],
    ];
    for (const [block, written] of rows) {
      expect(writeValue([block])).toBe(written);
      const [read] = readValue(written);
      expect(read?.children.at(-2)).toStrictEqual({ text: "\n" });
      expect(read?.children.at(-1)).toStrictEqual({ text: "next" });
    }
  });

  it("keeps a typed url whole before it, which reads back as its link", () => {
    const written = writeValue([paragraph([{ text: "see https://example.com/a\nnext" }])]);
    expect(readValue(written)).toStrictEqual([
      paragraph([
        { text: "see " },
        link("https://example.com/a"),
        { text: "\n" },
        { text: "next" },
      ]),
    ]);
  });
});
