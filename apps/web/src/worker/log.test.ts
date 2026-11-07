import { describe, expect, it } from "vitest";

import { errorFields } from "./log";

describe("an error's logged fields", () => {
  it("name what each wrapper wrapped, outermost first", () => {
    const d1 = new Error("D1_ERROR: database is locked");
    const query = new Error("Failed query: update invite_code", { cause: d1 });
    expect(errorFields(new Error("sign-up", { cause: query })).causes).toStrictEqual([
      "Error: Failed query: update invite_code",
      "Error: D1_ERROR: database is locked",
    ]);
  });

  it("names no cause for a plain error or a thrown value", () => {
    expect(errorFields(new Error("plain")).causes).toStrictEqual([]);
    expect(errorFields("a string").causes).toStrictEqual([]);
  });

  it("stops a chain that cycles", () => {
    const first = new Error("first");
    const second = new Error("second", { cause: first });
    first.cause = second;
    expect(errorFields(first).causes).toHaveLength(8);
  });

  it("keeps only the opening of a long message, which may quote its input", () => {
    const row = `Unexpected token in JSON: ${"private text ".repeat(100)}`;
    const fields = errorFields(new Error(row, { cause: new SyntaxError(row) }));
    expect(fields.message).toHaveLength(301);
    expect(fields.message.endsWith("…")).toBe(true);
    expect(fields.causes[0]?.length).toBe(301);
  });

  it("keeps a stack's frames alone, since a stack opens with the whole message", () => {
    const { stack } = errorFields(new Error("private text ".repeat(100)));
    expect(stack).not.toContain("private text");
    expect(stack).toMatch(/^\s+at /u);
  });
});
