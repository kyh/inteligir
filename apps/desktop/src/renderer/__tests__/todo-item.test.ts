import { describe, expect, it } from "vitest";

import { parseMarkdown } from "@renderer/editor/markdown/markdown-doc";
import { isTodoItem } from "@renderer/editor/todo-item";

// Parse markdown through the real pipeline (the same path that seeds the
// editor), so we assert against the actual node shapes it produces — not a
// hand-built fixture that could drift.
function parse(md: string) {
  const parsed = parseMarkdown(md);
  if (!parsed.ok) throw new Error(`fixture must parse: ${md}`);
  return parsed.value;
}

describe("isTodoItem", () => {
  it("counts real checkboxes and excludes Plate's phantom todos", () => {
    // Plate quirk: a plain bullet AFTER a todo inherits listStyleType:"todo"
    // but carries no `checked` — it must not count as a delegatable checkbox.
    const nodes = parse(
      ["- plain one", "- [ ] todo one", "- plain two", "- [x] todo two"].join("\n"),
    );
    expect(nodes.map(isTodoItem)).toEqual([false, true, false, true]);
  });

  it("flags both checked and unchecked todos", () => {
    expect(parse("- [ ] open").map(isTodoItem)).toEqual([true]);
    expect(parse("- [x] done").map(isTodoItem)).toEqual([true]);
  });

  it("rejects non-list and malformed nodes", () => {
    expect(isTodoItem({ listStyleType: "disc" })).toBe(false);
    expect(isTodoItem({ listStyleType: "todo" })).toBe(false); // phantom: no `checked`
    expect(isTodoItem(null)).toBe(false);
    expect(isTodoItem("nope")).toBe(false);
  });
});
