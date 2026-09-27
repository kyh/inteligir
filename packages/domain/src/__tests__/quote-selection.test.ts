import { describe, expect, it } from "vitest";
import { quoteSelection } from "../quote-selection";

describe("quoteSelection", () => {
  it("quotes every line and leaves a blank line to type below", () => {
    expect(quoteSelection("first\nsecond")).toBe("> first\n> second\n\n");
  });

  it("quotes an empty line too, so a paragraph break stays inside the quote", () => {
    expect(quoteSelection("one\n\ntwo")).toBe("> one\n> \n> two\n\n");
  });
});
