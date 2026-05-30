import { describe, expect, it } from "vitest";
import { Value } from "@sinclair/typebox/value";

import { ManageUiSchema } from "@/agent/ui/schema";

describe("ManageUiSchema", () => {
  it("allows trusted delete by id without a revision", () => {
    expect(Value.Check(ManageUiSchema, { action: "delete", id: "notes" })).toBe(true);
  });

  it("still requires revisions for spec writes", () => {
    expect(
      Value.Check(ManageUiSchema, {
        action: "update",
        id: "notes",
        title: "Notes",
        spec: { root: "r", elements: { r: { type: "Text" } } },
      }),
    ).toBe(false);
  });
});
