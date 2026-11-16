import { describe, expect, it } from "vitest";

import { listingView } from "./listing-view";

const COUNTS = { audio: 0, file: 0, image: 0, link: 0, note: 0, pdf: 0, video: 0 };

const rowsOf = (ids: readonly string[]) => ids.map((id) => ({ id }));

describe("the pages a device read of a listing", () => {
  it("is nothing until the first page answers", () => {
    expect(listingView([])).toBeUndefined();
  });

  it("lays the pages end to end, a row a later page answers again drawn once", () => {
    const view = listingView([
      { items: rowsOf(["a", "b"]), kindCounts: COUNTS, total: 4 },
      { items: rowsOf(["b", "c"]), kindCounts: { ...COUNTS, note: 3 }, total: 3 },
    ]);
    expect(view?.items.map((row) => row.id)).toStrictEqual(["a", "b", "c"]);
    expect(view?.total).toBe(3);
    expect(view?.kindCounts.note).toBe(3);
  });
});
