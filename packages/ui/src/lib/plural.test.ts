import { describe, expect, it } from "vitest";

import { formatCount, plural } from "./plural";

describe("a count in product copy", () => {
  it("groups thousands, alone and before its noun", () => {
    expect(formatCount(8512)).toBe("8,512");
    expect(plural(8512, "item")).toBe("8,512 items");
    expect(plural(1, "item")).toBe("1 item");
    expect(plural(0, "library call")).toBe("0 library calls");
  });
});
