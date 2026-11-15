import { describe, expect, it } from "vitest";

import { isPrintableAscii } from "./search-hits";

describe("a needle SQLite folds as the matcher does", () => {
  it("is printable ascii on one line", () => {
    expect(isPrintableAscii("deploy now")).toBe(true);
    expect(isPrintableAscii("acción")).toBe(false);
    expect(isPrintableAscii("a\tb")).toBe(false);
    expect(isPrintableAscii("a\nb")).toBe(false);
  });
});
