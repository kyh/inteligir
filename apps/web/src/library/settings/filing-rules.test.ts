import { describe, expect, it } from "vitest";

import { FILING_RULES_TEXT } from "./filing-rules";

describe("the starter filing rules", () => {
  it("say Unsorted is no folder, so the rule that keeps filed items still leaves its items to file", () => {
    expect(FILING_RULES_TEXT).toContain(
      "Unsorted is not a folder: its items are the ones to file.",
    );
    expect(FILING_RULES_TEXT).toContain("Never move an item already filed in a folder");
  });
});
