import { describe, expect, it } from "vitest";

import { errorFields } from "./log";

describe("an error's logged fields", () => {
  it("name what each wrapper wrapped, outermost first", () => {
    const d1 = new Error("D1_ERROR: database is locked");
    const query = new Error("Failed query: update invite_code", { cause: d1 });
    expect(errorFields(new Error("sign-up", { cause: query })).causes).toEqual([
      "Error: Failed query: update invite_code",
      "Error: D1_ERROR: database is locked",
    ]);
  });

  it("names no cause for a plain error or a thrown value", () => {
    expect(errorFields(new Error("plain")).causes).toEqual([]);
    expect(errorFields("a string").causes).toEqual([]);
  });

  it("stops a chain that cycles", () => {
    const first = new Error("first");
    const second = new Error("second", { cause: first });
    first.cause = second;
    expect(errorFields(first).causes).toHaveLength(8);
  });
});
