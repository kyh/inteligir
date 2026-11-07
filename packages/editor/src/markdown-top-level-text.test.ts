import { describe, expect, it, vi } from "vitest";

import { analyzeMarkdown, parseMarkdown } from "@repo/editor/markdown/markdown-doc";

// No rule in the table yields a text at the root, so the conversion is stubbed to break that
// invariant: analysis must refuse the note rather than hand Slate a root it cannot hold.
vi.mock(import("@platejs/markdown"), async (importOriginal) => ({
  ...(await importOriginal()),
  mdastToSlate: () => [{ text: "stray" }],
}));

const REFUSED = { kind: "pipeline-error" };

describe("a conversion that yields text outside any block", () => {
  it("is refused by the parse the editor loads", () => {
    expect(parseMarkdown("stray\n")).toStrictEqual({ ok: false, reason: REFUSED });
  });

  it("opens the note raw", () => {
    expect(analyzeMarkdown("stray\n")).toStrictEqual(REFUSED);
  });
});
