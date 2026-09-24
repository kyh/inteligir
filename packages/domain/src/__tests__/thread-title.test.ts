import { describe, expect, it } from "vitest";
import { deriveThreadTitle } from "../thread-title";

const CAP = 60;

describe("deriveThreadTitle", () => {
  it("names a thread after the first visible line, trimmed", () => {
    expect(deriveThreadTitle("\n   \n  Tidy the intro  \nand the outro")).toBe("Tidy the intro");
  });

  it("leaves a message with no visible line untitled", () => {
    expect(deriveThreadTitle(" \n\t\n")).toBeNull();
  });

  it("cuts a long line to the cap with an ellipsis", () => {
    const title = deriveThreadTitle("x".repeat(CAP + 10));
    expect(title).toBe(`${"x".repeat(CAP - 1)}…`);
    expect([...(title ?? "")]).toHaveLength(CAP);
  });

  it("keeps a line exactly at the cap whole", () => {
    const line = "y".repeat(CAP);
    expect(deriveThreadTitle(line)).toBe(line);
  });

  it("never splits a surrogate pair at the cut", () => {
    const title = deriveThreadTitle("😀".repeat(CAP + 1));
    expect(title).toBe(`${"😀".repeat(CAP - 1)}…`);
  });
});
