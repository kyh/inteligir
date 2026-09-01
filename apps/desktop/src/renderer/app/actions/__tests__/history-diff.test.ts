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

describe("row identity", () => {
  it("never emits one base line twice, and never repeats a row id", () => {
    // Two hunks two lines apart: the first hunk's trailing context window and
    // the second hunk's own lines overlap, and an unclamped window emits the
    // same base line as context AND as removed — with the same id twice.
    for (const [current, revision] of [
      ["a\nkeep\nb", "A\nkeep\nB"],
      ["a\na", "b\na\nb\na"],
      ["one\ntwo\nthree\nfour", "ONE\ntwo\nthree\nFOUR"],
      ["x\ny", "y\nx"],
    ] as const) {
      const rows = diffRows(current, revision);
      const ids = rows.map((row) => row.id);
      expect(new Set(ids).size).toBe(ids.length);
      const baseLines = rows.flatMap((row) =>
        row.kind === "context" || row.kind === "removed" ? [row.id] : [],
      );
      expect(new Set(baseLines).size).toBe(baseLines.length);
    }
  });
});

describe("bounds", () => {
  it("reports a wholesale replacement instead of walking two long unrelated notes", () => {
    const rows = diffRows("a\n".repeat(3000), "b\n".repeat(3000));
    expect(rows.at(-1)).toEqual({ id: "truncated", kind: "truncated", lines: expect.any(Number) });
    expect(rows.length).toBeLessThanOrEqual(401);
  });

  it("caps the rows it emits and says how many it withheld", () => {
    const current = Array.from({ length: 600 }, (_, index) => `line ${String(index)}`).join("\n");
    const revision = Array.from({ length: 600 }, (_, index) => `LINE ${String(index)}`).join("\n");
    const rows = diffRows(current, revision);
    const last = rows.at(-1);
    expect(last?.kind).toBe("truncated");
    expect(last?.kind === "truncated" && last.lines).toBeGreaterThan(0);
  });
});
