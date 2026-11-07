import { agentViewContextSchema } from "@repo/contract/cloud/library/library-wire";
import { describe, expect, it } from "vitest";

import { TIDY_VIEW_CONTEXT, tidyMessage } from "./tidy-library";

describe("Tidy my library", () => {
  it("asks the same request whatever the library's rules, and adds what the person typed", () => {
    const bare = tidyMessage("  ");
    expect(bare).toContain("Unsorted");
    expect(bare).not.toMatch(/rules/iu);
    expect(tidyMessage(" Leave recipes alone. ")).toBe(`${bare}\n\nLeave recipes alone.`);
  });

  it("is asked from Unsorted, a screen the cell takes", () => {
    expect(agentViewContextSchema.parse(TIDY_VIEW_CONTEXT)).toStrictEqual(TIDY_VIEW_CONTEXT);
  });
});
