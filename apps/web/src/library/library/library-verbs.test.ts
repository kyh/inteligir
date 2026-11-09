import { createFakeCell } from "@repo/contract/test-support/fake-cell";
import { describe, expect, it } from "vitest";

import { organizedOverlay } from "./library-verbs";

describe(organizedOverlay, () => {
  it("lays a tag change over a row as the cell makes it, case by case", () => {
    const cell = createFakeCell();
    const id = cell.seed.item({ tags: ["Spring", "trips"] });
    const laid = organizedOverlay({
      addTags: ["SPRING", "plans"],
      ids: [id],
      removeTags: ["TRIPS"],
    }).row(cell.listed(id));
    expect(laid?.fields.tags).toStrictEqual(["Spring", "plans"]);
    expect(laid?.tags).toStrictEqual(["Spring", "plans"]);
  });

  it("pins, moves and retitles the item and its card", () => {
    const cell = createFakeCell();
    const id = cell.seed.item({ folderId: cell.seed.folder("Trips"), title: "Plans" });
    const laid = organizedOverlay({
      folder: null,
      ids: [id],
      pinned: true,
      title: "Trip",
    }).item(cell.held(id));
    expect(laid.fields.folderId).toBeNull();
    expect(laid.fields.pinnedAt).not.toBeNull();
    expect(laid.fields.title).toBe("Trip");
    expect(laid.card.title).toBe("Trip");
  });

  it("keeps what the write leaves alone, and an unpinned item's pin goes", () => {
    const cell = createFakeCell();
    const id = cell.seed.item({ folderId: cell.seed.folder("Trips"), pinnedAt: 5, title: "Plans" });
    const row = cell.listed(id);
    const laid = organizedOverlay({ ids: [id], pinned: false }).row(row);
    expect(laid?.fields).toStrictEqual({ ...row.fields, pinnedAt: null });
    expect(laid?.card).toBe(row.card);
  });
});
