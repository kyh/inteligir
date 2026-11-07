import { describe, expect, it } from "vitest";

import { mergeConflictLine } from "./merge-conflict-line";

describe(mergeConflictLine, () => {
  it("names the item by its title, or says this item while it has none", () => {
    expect(mergeConflictLine("Plans")).toMatch(/^Plans also changed elsewhere\./u);
    expect(mergeConflictLine("")).toMatch(/^This item also changed elsewhere\./u);
  });
});
