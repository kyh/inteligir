import { describe, expect, it } from "vitest";
import { diff3 } from "../text/diff3";

const doc = (...lines: string[]): string => `${lines.join("\n")}\n`;

describe("diff3", () => {
  describe("trivial cases", () => {
    it("returns the text when nothing changed", () => {
      const base = doc("a", "b", "c");
      expect(diff3(base, base, base)).toEqual({ merged: base, conflicted: false });
    });

    it("returns mine when theirs equals base", () => {
      const base = doc("a", "b", "c");
      const mine = doc("a", "B", "c");
      expect(diff3(base, mine, base)).toEqual({ merged: mine, conflicted: false });
    });

    it("returns theirs when mine equals base", () => {
      const base = doc("a", "b", "c");
      const theirs = doc("a", "B", "c");
      expect(diff3(base, base, theirs)).toEqual({ merged: theirs, conflicted: false });
    });

    it("returns the shared text when both made the identical change", () => {
      const base = doc("a", "b", "c");
      const both = doc("a", "B", "c");
      expect(diff3(base, both, both)).toEqual({ merged: both, conflicted: false });
    });

    it("handles empty base with both sides adding the same text", () => {
      expect(diff3("", "hello\n", "hello\n")).toEqual({ merged: "hello\n", conflicted: false });
    });
  });

  describe("clean merges", () => {
    it("merges disjoint edits from both sides", () => {
      const base = doc("one", "two", "three", "four", "five");
      const mine = doc("ONE", "two", "three", "four", "five");
      const theirs = doc("one", "two", "three", "four", "FIVE");
      expect(diff3(base, mine, theirs)).toEqual({
        merged: doc("ONE", "two", "three", "four", "FIVE"),
        conflicted: false,
      });
    });

    it("merges an insertion from mine with an edit from theirs elsewhere", () => {
      const base = doc("alpha", "beta", "gamma");
      const mine = doc("alpha", "inserted", "beta", "gamma");
      const theirs = doc("alpha", "beta", "GAMMA");
      expect(diff3(base, mine, theirs)).toEqual({
        merged: doc("alpha", "inserted", "beta", "GAMMA"),
        conflicted: false,
      });
    });

    it("merges a deletion from theirs with an edit from mine elsewhere", () => {
      const base = doc("keep", "drop me", "middle", "edit me");
      const mine = doc("keep", "drop me", "middle", "edited");
      const theirs = doc("keep", "middle", "edit me");
      expect(diff3(base, mine, theirs)).toEqual({
        merged: doc("keep", "middle", "edited"),
        conflicted: false,
      });
    });

    it("merges appends from theirs below edits from mine", () => {
      const base = doc("# Title", "body");
      const mine = doc("# Title", "body edited");
      const theirs = doc("# Title", "body", "", "appended by agent");
      expect(diff3(base, mine, theirs)).toEqual({
        merged: doc("# Title", "body edited", "", "appended by agent"),
        conflicted: false,
      });
    });

    it("keeps a text without a trailing newline intact", () => {
      const base = "a\nb";
      const mine = "a\nb";
      const theirs = "a\nB";
      expect(diff3(base, mine, theirs)).toEqual({ merged: "a\nB", conflicted: false });
    });

    it("merges when theirs rewrites the trailing-newline tail", () => {
      const base = "a\nb\n";
      const mine = "A\nb\n";
      const theirs = "a\nb\nc\n";
      expect(diff3(base, mine, theirs)).toEqual({ merged: "A\nb\nc\n", conflicted: false });
    });
  });

  describe("conflicts prefer mine", () => {
    it("keeps mine when both edited the same line differently", () => {
      const base = doc("a", "shared", "z");
      const mine = doc("a", "mine version", "z");
      const theirs = doc("a", "theirs version", "z");
      expect(diff3(base, mine, theirs)).toEqual({
        merged: doc("a", "mine version", "z"),
        conflicted: true,
      });
    });

    it("still applies theirs' clean region elsewhere in the same document", () => {
      const base = doc("head", "conflict line", "mid", "tail");
      const mine = doc("head", "conflict mine", "mid", "tail");
      const theirs = doc("head", "conflict theirs", "mid", "TAIL");
      expect(diff3(base, mine, theirs)).toEqual({
        merged: doc("head", "conflict mine", "mid", "TAIL"),
        conflicted: true,
      });
    });

    it("conflicts on same-point insertions with different text", () => {
      const base = doc("a", "b");
      const mine = doc("a", "mine insert", "b");
      const theirs = doc("a", "theirs insert", "b");
      expect(diff3(base, mine, theirs)).toEqual({
        merged: doc("a", "mine insert", "b"),
        conflicted: true,
      });
    });

    it("conflicts when mine edits a line theirs deleted", () => {
      const base = doc("a", "victim", "z");
      const mine = doc("a", "victim edited", "z");
      const theirs = doc("a", "z");
      expect(diff3(base, mine, theirs)).toEqual({
        merged: doc("a", "victim edited", "z"),
        conflicted: true,
      });
    });

    it("conflicts on adjacent unstable regions with no separating line", () => {
      // mine rewrote [1,2), theirs rewrote [2,3): no stable line between
      // them, so interleaving would be ambiguous — grouped, conflicted, mine.
      const base = doc("stable", "mine target", "theirs target", "stable2");
      const mine = doc("stable", "mine rewrite", "theirs target", "stable2");
      const theirs = doc("stable", "mine target", "theirs rewrite", "stable2");
      const result = diff3(base, mine, theirs);
      expect(result.conflicted).toBe(true);
      expect(result.merged).toBe(doc("stable", "mine rewrite", "theirs target", "stable2"));
    });

    it("keeps the whole buffer when both rewrote everything differently", () => {
      const base = doc("original");
      const mine = doc("completely mine");
      const theirs = doc("completely theirs");
      expect(diff3(base, mine, theirs)).toEqual({
        merged: doc("completely mine"),
        conflicted: true,
      });
    });
  });

  describe("segmentation edges", () => {
    it("merges both sides filling the same blank line identically", () => {
      const base = doc("a", "", "z");
      const both = doc("a", "filled", "z");
      expect(diff3(base, both, both)).toEqual({ merged: both, conflicted: false });
    });

    it("conflicts when the sides fill a blank line differently", () => {
      const base = doc("a", "", "z");
      const mine = doc("a", "mine fill", "z");
      const theirs = doc("a", "theirs fill", "z");
      expect(diff3(base, mine, theirs)).toEqual({
        merged: doc("a", "mine fill", "z"),
        conflicted: true,
      });
    });

    it("compares segment arrays, not joined text, at the region boundary", () => {
      // mine turns one line into two; theirs rewrites the same region with
      // the identical CHARACTERS but a different line split would join-equal.
      const base = doc("a", "x y", "z");
      const mine = doc("a", "x", "y", "z");
      const theirs = doc("a", "x", "y", "z");
      expect(diff3(base, mine, theirs)).toEqual({
        merged: doc("a", "x", "y", "z"),
        conflicted: false,
      });
    });

    it("handles both sides appending at a trailing-newline boundary identically", () => {
      const base = "a\n";
      const both = "a\nb\n";
      expect(diff3(base, both, both)).toEqual({ merged: both, conflicted: false });
    });

    it("conflicts on different appends at the trailing-newline boundary", () => {
      const base = "a\n";
      const result = diff3(base, "a\nmine\n", "a\ntheirs\n");
      expect(result.conflicted).toBe(true);
      expect(result.merged).toBe("a\nmine\n");
    });

    it("merges one side dropping the final newline while the other edits above", () => {
      const base = "head\nmid\ntail\n";
      const mine = "HEAD\nmid\ntail\n";
      const theirs = "head\nmid\ntail";
      expect(diff3(base, mine, theirs)).toEqual({ merged: "HEAD\nmid\ntail", conflicted: false });
    });
  });

  describe("larger documents", () => {
    it("merges edits scattered across a long document", () => {
      const base = doc(...Array.from({ length: 50 }, (_, i) => `line ${i}`));
      const mineLines = Array.from({ length: 50 }, (_, i) => `line ${i}`);
      mineLines[5] = "line 5 (mine)";
      mineLines[40] = "line 40 (mine)";
      const theirsLines = Array.from({ length: 50 }, (_, i) => `line ${i}`);
      theirsLines[20] = "line 20 (theirs)";
      const expected = Array.from({ length: 50 }, (_, i) => `line ${i}`);
      expected[5] = "line 5 (mine)";
      expected[20] = "line 20 (theirs)";
      expected[40] = "line 40 (mine)";
      expect(diff3(base, doc(...mineLines), doc(...theirsLines))).toEqual({
        merged: doc(...expected),
        conflicted: false,
      });
    });

    it("merges a multi-line block replacement against a distant edit", () => {
      const base = doc("intro", "a", "b", "c", "outro", "footer");
      const mine = doc("intro", "x", "y", "outro", "footer");
      const theirs = doc("intro", "a", "b", "c", "outro", "FOOTER");
      expect(diff3(base, mine, theirs)).toEqual({
        merged: doc("intro", "x", "y", "outro", "FOOTER"),
        conflicted: false,
      });
    });

    it("handles repeated identical lines without misalignment", () => {
      const base = doc("-", "item", "-", "item", "-");
      const mine = doc("-", "item edited", "-", "item", "-");
      const theirs = doc("-", "item", "-", "item", "-", "appended");
      expect(diff3(base, mine, theirs)).toEqual({
        merged: doc("-", "item edited", "-", "item", "-", "appended"),
        conflicted: false,
      });
    });
  });
});
