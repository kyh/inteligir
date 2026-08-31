import { describe, expect, it } from "vitest";
import { diffRows } from "../history-diff";

const texts = (rows: ReturnType<typeof diffRows>, kind: string): string[] =>
  rows.flatMap((row) => (row.kind === kind && "text" in row ? [row.text] : []));

describe("what restoring a revision would change", () => {
  it("reads current → revision: removed is what the note holds, added is what it would", () => {
    const rows = diffRows("one\ntwo\n", "one\nTWO\n");
    expect(texts(rows, "removed")).toEqual(["two"]);
    expect(texts(rows, "added")).toEqual(["TWO"]);
    expect(texts(rows, "context")).toEqual(["one", ""]);
  });

  it("says nothing when the bytes are identical", () => {
    expect(diffRows("same\n", "same\n")).toEqual([]);
  });

  it("counts a trailing-newline-only change rather than calling the two the same", () => {
    // The lines come from `splitLinesLf`, so the empty final segment IS the
    // newline. A view that trimmed it would report no difference for a
    // restore that rewrites the file's last byte.
    expect(diffRows("a\n", "a")).not.toEqual([]);
  });

  it("elides the unchanged middle between two hunks", () => {
    const current = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].join("\n");
    const revision = ["A", "b", "c", "d", "e", "f", "g", "h", "i", "J"].join("\n");
    const rows = diffRows(current, revision);
    const gaps = rows.flatMap((row) => (row.kind === "gap" ? [row.lines] : []));
    expect(gaps).toEqual([4]);
    expect(texts(rows, "removed")).toEqual(["a", "j"]);
    expect(texts(rows, "added")).toEqual(["A", "J"]);
  });

  it("keeps every line accounted for: context plus removed covers the note", () => {
    const current = "one\ntwo\nthree\n";
    const rows = diffRows(current, "one\ntwo\nTHREE\n");
    expect([...texts(rows, "context"), ...texts(rows, "removed")].toSorted()).toEqual(
      ["", "one", "three", "two"].toSorted(),
    );
  });
});
