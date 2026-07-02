import { describe, expect, it } from "vitest";
import { createSlateEditor } from "platejs";
import { BaseIndentPlugin } from "@platejs/indent";
import { BaseListPlugin } from "@platejs/list";
import { MarkdownPlugin, deserializeMd } from "@platejs/markdown";
import remarkGfm from "remark-gfm";

import { isTodoItem } from "../editor/todo-item";

// Parse markdown the way the editor does, so we assert against the real node
// shapes Plate produces (not a hand-built fixture that could drift).
function parse(md: string) {
  const editor = createSlateEditor({
    plugins: [
      BaseIndentPlugin,
      BaseListPlugin,
      MarkdownPlugin.configure({ options: { remarkPlugins: [remarkGfm] } }),
    ],
  });
  return deserializeMd(editor, md);
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
