import { describe, expect, it } from "vitest";

import { atEnd } from "./follow-end";

const VIEW = 600;
const CONTENT = 2000;
const END = CONTENT - VIEW;

describe("whether a scroll rests at its end", () => {
  it("is at the end on its last point, past it and within a line of it", () => {
    expect(atEnd({ contentHeight: CONTENT, offset: END, viewportHeight: VIEW })).toBe(true);
    expect(atEnd({ contentHeight: CONTENT, offset: END + 34, viewportHeight: VIEW })).toBe(true);
    expect(atEnd({ contentHeight: CONTENT, offset: END - 20, viewportHeight: VIEW })).toBe(true);
  });

  it("is not once the reader has scrolled up by more than a line", () => {
    expect(atEnd({ contentHeight: CONTENT, offset: END - 40, viewportHeight: VIEW })).toBe(false);
    expect(atEnd({ contentHeight: CONTENT, offset: 0, viewportHeight: VIEW })).toBe(false);
  });

  it("holds content shorter than the view all at its end", () => {
    expect(atEnd({ contentHeight: 300, offset: 0, viewportHeight: VIEW })).toBe(true);
  });

  it("is not once a reply grows under a reader who rested at the end", () => {
    expect(atEnd({ contentHeight: CONTENT + 200, offset: END, viewportHeight: VIEW })).toBe(false);
  });
});
