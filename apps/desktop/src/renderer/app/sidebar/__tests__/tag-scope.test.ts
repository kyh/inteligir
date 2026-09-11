import { describe, expect, it } from "vitest";

import { tagScopeCountLabel } from "../tag-scope";

describe("the scoped list's count", () => {
  it("says the whole count, and 'listed of total' while the listing is cut", () => {
    expect(tagScopeCountLabel({ listed: 3, total: 3 })).toBe("3");
    expect(tagScopeCountLabel({ listed: 100, total: 250 })).toBe("100 of 250");
  });
});
