import { describe, expect, it } from "vitest";

import { libraryTextSchema } from "@repo/notes/library/library-nodes";

import { leaf, MARK_KEYS, marksOf, tidyInlines } from "./slate-leaves";

describe("a line of Slate text as the codec holds it", () => {
  it("names every mark the vocabulary's text carries, and nothing else", () => {
    const vocabulary = Object.keys(libraryTextSchema.shape).filter((key) => key !== "text");
    expect([...MARK_KEYS].toSorted()).toEqual(vocabulary.toSorted());
  });

  it("reads only the marks a leaf has set", () => {
    expect(marksOf({ bold: true, italic: false, text: "a" })).toEqual({ bold: true });
  });

  it("joins neighbours with one set of marks, and keeps an empty text only alone", () => {
    const joined = tidyInlines([
      leaf("a", { bold: true }),
      leaf("b", { bold: true }),
      leaf("", {}),
      leaf("c", {}),
    ]);
    expect(joined).toEqual([{ bold: true, text: "ab" }, { text: "c" }]);
    expect(tidyInlines([leaf("", {}), leaf("", { bold: true })])).toEqual([{ text: "" }]);
  });
});
