import { describe, expect, it } from "vitest";
import { Value } from "@sinclair/typebox/value";

import { ManageUiSchema } from "@/agent/ui/schema";

describe("ManageUiSchema", () => {
  // The schema is intentionally a flat object with optional fields so OpenAI
  // accepts it as `type: "object"`. Per-action required-field validation
  // lives in the execute handler (extension.ts), not the schema.
  it("accepts a minimal delete-by-id", () => {
    expect(Value.Check(ManageUiSchema, { action: "delete", id: "notes" })).toBe(true);
  });

  it("accepts a fully populated install", () => {
    expect(
      Value.Check(ManageUiSchema, {
        action: "install",
        id: "notes",
        title: "Notes",
        spec: { root: "r", elements: { r: { type: "Text", props: {} } } },
      }),
    ).toBe(true);
  });

  it("rejects an unknown action", () => {
    expect(Value.Check(ManageUiSchema, { action: "explode" })).toBe(false);
  });

  it("rejects unknown top-level properties", () => {
    expect(Value.Check(ManageUiSchema, { action: "list", surprise: "boom" })).toBe(false);
  });
});
