import { describe, expect, it } from "vitest";

import { compareBlockPlaces, placeInOrder } from "./block-order";
import { isOrdKey, ordBetween, ordsBetween } from "./order-key";
import { mulberry32 } from "../test-support/seeded-random";

describe(compareBlockPlaces, () => {
  it("reads the note before the article, then by key, then by id between equal keys", () => {
    const places = [
      { blockId: "b", ord: "a0", section: "article" },
      { blockId: "z", ord: "a1", section: "note" },
      { blockId: "y", ord: "a1", section: "note" },
      { blockId: "a", ord: "Zz", section: "note" },
    ] as const;
    expect(places.toSorted(compareBlockPlaces).map((place) => place.blockId)).toStrictEqual([
      "a",
      "y",
      "z",
      "b",
    ]);
  });
});

const keyed = (ids: readonly string[], keys: readonly string[]) =>
  new Map(ids.map((id, index) => [id, keys[index] ?? ""]));

describe(placeInOrder, () => {
  it("restores the keys every block had when they still put it in order", () => {
    const before = keyed(["a", "b", "c"], ordsBetween(null, null, 3));
    const current = keyed(
      ["a", "c"],
      [before.get("a") ?? "", ordBetween(null, before.get("a") ?? null)],
    );
    expect(placeInOrder(["a", "b", "c"], current, before)).toStrictEqual(before);
  });

  it("moves no block the merged order keeps in place, and finds room for the rest", () => {
    const current = keyed(["a", "c"], ["a0", "a1"]);
    const placed = placeInOrder(["a", "b", "c"], current, new Map([["b", "a5"]]));
    expect(placed.get("a")).toBe("a0");
    expect(placed.get("c")).toBe("a1");
    const b = placed.get("b") ?? "";
    expect(b > "a0" && b < "a1").toBe(true);
  });

  it("answers keys that increase along the order, whatever it is handed (seeded)", () => {
    const rand = mulberry32(0x0c_a1);
    for (let trial = 0; trial < 300; trial += 1) {
      const ids = Array.from(
        { length: 1 + Math.floor(rand() * 8) },
        (_, index) => `b${String(index)}`,
      );
      const pool = ordsBetween(null, null, 12);
      const draw = () => pool[Math.floor(rand() * pool.length)] ?? "a0";
      const current = new Map(ids.filter(() => rand() < 0.7).map((id) => [id, draw()]));
      const restore = new Map(ids.filter(() => rand() < 0.7).map((id) => [id, draw()]));
      const order = ids.toSorted(() => rand() - 0.5);
      const placed = placeInOrder(order, current, restore);
      const keys = order.map((id) => placed.get(id) ?? "");
      for (let index = 1; index < keys.length; index += 1) {
        // oxlint-disable-next-line vitest/prefer-comparison-matcher -- toBeLessThan and its kin take numbers alone, and these are strings compared in code-unit order
        expect((keys[index - 1] ?? "") < (keys[index] ?? "")).toBe(true);
      }
      expect(keys.every(isOrdKey)).toBe(true);
    }
  });
});
