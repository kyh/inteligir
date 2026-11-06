import { describe, expect, it } from "vitest";
import { revertEdit, turnEditOf } from "./revert-edit";

const doc = (...lines: string[]): string => `${lines.join("\n")}\n`;

const BEFORE = doc("# Plans", "", "first draft", "", "## Later", "", "someday");
const AFTER = doc("# Plans", "", "second draft", "", "## Later", "", "someday");

describe(revertEdit, () => {
  describe("an edited file", () => {
    it("writes the bytes from before when nothing changed since", () => {
      expect(revertEdit({ after: AFTER, before: BEFORE, current: AFTER })).toStrictEqual({
        content: BEFORE,
        expected: AFTER,
        kind: "write",
      });
    });

    it("keeps a line added since when an unchanged line separates it from the change", () => {
      const current = doc("# Plans", "", "second draft", "", "## Later", "", "someday", "and more");
      expect(revertEdit({ after: AFTER, before: BEFORE, current })).toStrictEqual({
        content: doc("# Plans", "", "first draft", "", "## Later", "", "someday", "and more"),
        expected: current,
        kind: "write",
      });
    });

    it("keeps the file whole when a later edit overlaps the change", () => {
      const current = doc("# Plans", "", "second draft, revised", "", "## Later", "", "someday");
      expect(revertEdit({ after: AFTER, before: BEFORE, current })).toStrictEqual({
        kind: "keep",
        reason: "edited-since",
      });
    });

    it("keeps the file whole when a later edit touches the change's edge", () => {
      const current = doc(
        "# Plans",
        "",
        "second draft",
        "a line right after",
        "",
        "## Later",
        "",
        "someday",
      );
      expect(revertEdit({ after: AFTER, before: BEFORE, current })).toStrictEqual({
        kind: "keep",
        reason: "edited-since",
      });
    });

    it("leaves a file that already holds the bytes from before", () => {
      expect(revertEdit({ after: AFTER, before: BEFORE, current: BEFORE })).toStrictEqual({
        kind: "unchanged",
      });
    });

    it("keeps a file deleted since, deleted", () => {
      expect(revertEdit({ after: AFTER, before: BEFORE, current: null })).toStrictEqual({
        kind: "keep",
        reason: "deleted-since",
      });
    });
  });

  describe("a created file", () => {
    it("removes it while it holds exactly what the change wrote", () => {
      expect(revertEdit({ after: AFTER, before: null, current: AFTER })).toStrictEqual({
        expected: AFTER,
        kind: "remove",
      });
    });

    it("keeps it once it was edited since", () => {
      expect(revertEdit({ after: AFTER, before: null, current: `${AFTER}more\n` })).toStrictEqual({
        kind: "keep",
        reason: "edited-since",
      });
    });

    it("leaves it gone when it is gone", () => {
      expect(revertEdit({ after: AFTER, before: null, current: null })).toStrictEqual({
        kind: "unchanged",
      });
    });
  });

  describe("a deleted file", () => {
    it("recreates it while the path is still empty", () => {
      expect(revertEdit({ after: null, before: BEFORE, current: null })).toStrictEqual({
        content: BEFORE,
        kind: "recreate",
      });
    });

    it("keeps whatever was put back at the path since", () => {
      expect(revertEdit({ after: null, before: BEFORE, current: AFTER })).toStrictEqual({
        kind: "keep",
        reason: "recreated-since",
      });
    });

    it("leaves a file put back exactly as it was", () => {
      expect(revertEdit({ after: null, before: BEFORE, current: BEFORE })).toStrictEqual({
        kind: "unchanged",
      });
    });
  });
});

describe(turnEditOf, () => {
  it("reads an edit, a create and a delete, and nothing from two absent sides", () => {
    expect(turnEditOf("a\n", "b\n")).toStrictEqual({ after: "b\n", before: "a\n" });
    expect(turnEditOf(null, "b\n")).toStrictEqual({ after: "b\n", before: null });
    expect(turnEditOf("a\n", null)).toStrictEqual({ after: null, before: "a\n" });
    expect(turnEditOf(null, null)).toBeNull();
  });
});
