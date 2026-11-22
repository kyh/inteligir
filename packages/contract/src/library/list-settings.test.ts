import { describe, expect, it } from "vitest";

import type { JsonValue } from "./canonical-json";
import { listSettingsSchema } from "./library-item";
import { groupsOf, NEW_LIST, renamedProperties } from "./list-settings";

const row = (id: string, status?: string) => {
  const properties: Record<string, JsonValue> = status === undefined ? {} : { Status: status };

  return { id, properties };
};

describe(groupsOf, () => {
  it("groups by the select in its options' order, the unset last and only when held", () => {
    const groups = groupsOf(NEW_LIST, [
      row("a", "Done"),
      row("b"),
      row("c", "To do"),
      row("d", "Gone"),
    ]);

    expect(groups.map(({ items, option }) => [option, items.map(({ id }) => id)])).toStrictEqual([
      ["To do", ["c"]],
      ["In progress", []],
      ["Done", ["a"]],
      [null, ["b", "d"]],
    ]);
    expect(groupsOf(NEW_LIST, [row("a", "Done")]).map(({ option }) => option)).toStrictEqual([
      "To do",
      "In progress",
      "Done",
    ]);
  });

  it("is one group when nothing groups it", () => {
    expect(groupsOf({ ...NEW_LIST, groupBy: null }, [row("a")])).toStrictEqual([
      { items: [row("a")], option: null },
    ]);
  });
});

describe("a list's settings", () => {
  it("names each property and option once and groups only by a select", () => {
    expect(listSettingsSchema.safeParse(NEW_LIST).success).toBe(true);
    expect(
      listSettingsSchema.safeParse({
        groupBy: null,
        properties: [
          { name: "Link", type: "url" },
          { name: "link", type: "text" },
        ],
      }).success,
    ).toBe(false);
    expect(
      listSettingsSchema.safeParse({ groupBy: "Link", properties: [{ name: "Link", type: "url" }] })
        .success,
    ).toBe(false);
  });

  it("lets a renamed value win over a key the item already held, whatever the keys' order", () => {
    expect(
      renamedProperties({ Stage: "Old", Status: "Done" }, [{ from: "Status", to: "Stage" }]),
    ).toStrictEqual({ Stage: "Done" });
    expect(
      renamedProperties({ Status: "Done", Stage: "Old" }, [{ from: "Status", to: "Stage" }]),
    ).toStrictEqual({ Stage: "Done" });
  });

  it("carries a value across a rename and leaves the rest", () => {
    expect(
      renamedProperties({ Notes: "x", Status: "Done" }, [{ from: "Status", to: "Stage" }]),
    ).toStrictEqual({
      Notes: "x",
      Stage: "Done",
    });
  });
});
