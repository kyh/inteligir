import { ITEM_FIELD_CAPS } from "../library/library-item";
import { describe, expect, it } from "vitest";

import { fieldLine, savedFacts } from "./saved-facts";

describe("a page's facts as an item keeps them", () => {
  it("trims each, clips it to its field's cap, and keeps nothing for a blank one", () => {
    expect(fieldLine("  A. Writer \n")).toBe("A. Writer");
    expect(fieldLine("   ")).toBeNull();
    expect(fieldLine(null)).toBeNull();
    expect(fieldLine("x".repeat(ITEM_FIELD_CAPS.line + 5))).toHaveLength(ITEM_FIELD_CAPS.line);
    expect(
      savedFacts({
        author: " A. Writer ",
        description: ` ${"d".repeat(ITEM_FIELD_CAPS.description + 1)} `,
        lang: "",
        published: null,
        site: "Pages",
      }),
    ).toEqual({
      author: "A. Writer",
      description: "d".repeat(ITEM_FIELD_CAPS.description),
      lang: null,
      published: null,
      site: "Pages",
    });
    expect(
      savedFacts({ author: null, description: "  ", lang: null, published: null, site: null }),
    ).toMatchObject({ description: null });
  });
});
