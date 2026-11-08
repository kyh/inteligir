import { describe, expect, it } from "vitest";

import { heldItem, listedItem } from "../test-support/cell-rows";
import { organizedOverlay } from "./library-verbs";

describe(organizedOverlay, () => {
  it("lays a tag change over a row as the cell makes it, case by case", () => {
    const row = listedItem("a", { tags: ["Spring", "trips"] });
    const laid = organizedOverlay({
      addTags: ["SPRING", "plans"],
      ids: ["a"],
      removeTags: ["TRIPS"],
    }).row(row);
    expect(laid?.fields.tags).toStrictEqual(["Spring", "plans"]);
    expect(laid?.tags).toStrictEqual(["Spring", "plans"]);
  });

  it("pins, moves and retitles the item and its card", () => {
    const item = heldItem("a", { folderId: "f1", title: "Plans" });
    const laid = organizedOverlay({
      folder: null,
      ids: ["a"],
      pinned: true,
      title: "Trip",
    }).item(item);
    expect(laid.fields.folderId).toBeNull();
    expect(laid.fields.pinnedAt).not.toBeNull();
    expect(laid.fields.title).toBe("Trip");
    expect(laid.card.title).toBe("Trip");
  });

  it("keeps what the write leaves alone, and an unpinned item's pin goes", () => {
    const row = listedItem("a", { folderId: "f1", pinnedAt: 5, title: "Plans" });
    const laid = organizedOverlay({ ids: ["a"], pinned: false }).row(row);
    expect(laid?.fields).toStrictEqual({ ...row.fields, pinnedAt: null });
    expect(laid?.card).toBe(row.card);
  });
});
