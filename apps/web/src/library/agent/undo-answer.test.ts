import { describe, expect, it } from "vitest";

import { undoSentence } from "./undo-answer";

describe("what an undo says", () => {
  it("says when a later change was kept where it overlapped", () => {
    expect(undoSentence({ kept: [], refused: [], reverted: ["a"] })).toBe("Undone.");
    expect(undoSentence({ kept: ["a"], refused: [], reverted: ["b"] })).toMatch(/were kept/u);
    expect(undoSentence({ kept: ["a"], refused: ["b"], reverted: ["c"] })).toMatch(
      /undo this again/u,
    );
  });

  it("says nothing was undone when a later change kept all of it", () => {
    const sentence = undoSentence({ kept: ["a"], refused: [], reverted: [] });
    expect(sentence).toMatch(/^Nothing was undone/u);
    expect(sentence).toMatch(/were kept where they overlapped/u);
    expect(sentence).toMatch(/undo this again/u);
  });
});
