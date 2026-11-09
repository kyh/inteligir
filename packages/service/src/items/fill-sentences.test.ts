import { describe, expect, it } from "vitest";

import { failureOf, fileOnlyLinked } from "./fill-sentences";

describe("the fill's sentences", () => {
  it("says each failure the way the item does", () => {
    expect(failureOf({ kind: "refused", refusal: "private-network" }).sentence).toBe(
      "This address is on a private network, which the cloud can't reach, so its page isn't read.",
    );
    expect(failureOf({ kind: "refused", refusal: "private-from-public" }).sentence).toBe(
      "The page pointed at an address on your own network, so it isn't read.",
    );
    expect(
      failureOf({ kind: "status", reason: "not found", status: 404, transient: false }),
    ).toStrictEqual({
      sentence: "The site answered 404 (not found).",
      transient: false,
    });
    expect(failureOf({ kind: "timeout" })).toStrictEqual({
      sentence: "The page took too long to answer.",
      transient: true,
    });
    expect(fileOnlyLinked(24 * 1024 * 1024)).toBe(
      "The file is 24 MB; only its link is kept (the limit is 10 MB).",
    );
    // a size that rounds to the limit, or none at all, is never said as the limit itself
    expect(fileOnlyLinked(10 * 1024 * 1024 + 1)).toBe(
      "The file is over 10 MB; only its link is kept.",
    );
    expect(fileOnlyLinked(null)).toBe("The file is over 10 MB; only its link is kept.");
  });
});
