import { describe, expect, it } from "vitest";

import { lettersKept } from "./markdown-doc";

describe(lettersKept, () => {
  it("is the share of the source's letters and digits the written text still holds", () => {
    expect(lettersKept("A page, of 12 words!", "a PAGE of 12 words")).toBe(1);
    expect(lettersKept("a&nbsp;b and a &mdash; b", "a b and a — b")).toBe(7 / 16);
  });

  it("does not pay a dropped letter back with one the writer added", () => {
    expect(lettersKept("abc", "abzzz")).toBe(2 / 3);
  });

  it("holds a source with no letters as kept whole", () => {
    expect(lettersKept(" … ", "")).toBe(1);
  });
});
