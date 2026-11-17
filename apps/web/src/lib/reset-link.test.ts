import { describe, expect, it } from "vitest";

import { resetViewOf } from "./reset-link";

describe("a reset link's landing", () => {
  it("draws the form for a live token, whatever way back rides beside it", () => {
    expect(resetViewOf({ next: "/library", token: "abc" })).toStrictEqual({
      kind: "form",
      token: "abc",
    });
  });

  it.each([
    [{ error: "INVALID_TOKEN" }],
    [{ error: "INVALID_TOKEN", token: "abc" }],
    [{ token: "" }],
    [{ token: ["a", "b"] }],
    [{}],
  ])("calls %j a dead link", (search) => {
    expect(resetViewOf(search)).toStrictEqual({ kind: "dead" });
  });
});
