// The task-ordinal LOCKSTEP test — pins the renderer's `todoIndex` (the
// Plate-tree counter behind the editor's Delegate button, todo-item.ts)
// against core's `scanTaskItems` (the source-side authority behind
// find-task-line and the guarded toggle). The delegation/toggle anchor is
// (sourceFile, ordinal): if the two counters disagree, a Delegate click
// resolves to the WRONG checkbox on disk — the agent does the wrong task and
// checks the wrong box. Every corpus doc is built through the real pipeline
// (parseMarkdown → BASE_KIT editor), then every todo element's `todoIndex`
// must equal the ordinal scanTaskItems assigns the same task in the source.

import { describe, expect, it } from "vitest";
import { ElementApi, createSlateEditor, type TElement } from "platejs";

import { scanTaskItems } from "@repo/core/knowledge/link-extract";

import { BASE_KIT } from "@renderer/editor/kits/base-kit";
import { parseMarkdown } from "@renderer/editor/markdown/markdown-doc";
import { isTodoItem, todoIndex } from "@renderer/editor/todo-item";

/** Parse `md` through the live editor's seed path and assert that the Plate
 * tree's todo elements match scanTaskItems' tasks 1:1 — same count, same
 * ordinal, same checked state, in document order. */
function assertLockstep(md: string): void {
  const tasks = scanTaskItems(md);
  const parsed = parseMarkdown(md);
  if (!parsed.ok) throw new Error("corpus doc must parse rich");
  const editor = createSlateEditor({ plugins: BASE_KIT, value: parsed.value });
  const todos: TElement[] = [];
  for (const [node] of editor.api.nodes({ at: [], match: (n) => isTodoItem(n) })) {
    if (ElementApi.isElement(node)) todos.push(node);
  }
  // Same items recognized on both sides (Plate phantoms and lookalikes the
  // source-side skips must not appear on either count)…
  expect(todos.length).toBe(tasks.length);
  // …and the i-th todo element's click-time ordinal is the i-th source task's
  // ordinal, with matching checked state.
  todos.forEach((element, i) => {
    const task = tasks[i];
    if (task === undefined) throw new Error(`no source task at position ${i}`);
    expect(todoIndex(editor, element)).toBe(task.ordinal);
    expect(element.checked).toBe(task.checked);
  });
}

describe("todoIndex ↔ scanTaskItems ordinal lockstep", () => {
  it("frontmatter with a checkbox lookalike never shifts the count", () => {
    assertLockstep(
      [
        "---",
        "checklist:",
        "  - [ ] yaml lookalike",
        "---",
        "",
        "- [ ] first real",
        "- [x] second real",
      ].join("\n"),
    );
  });

  it("nested lists count in document order (flat indent model)", () => {
    assertLockstep(
      ["- [ ] parent", "  - [x] child", "    - [ ] grandchild", "- [ ] sibling"].join("\n"),
    );
  });

  it("mixed -/*/+ bullets and duplicate labels stay position-keyed", () => {
    assertLockstep(
      ["- [ ] alpha", "", "* [x] beta", "", "+ [ ] alpha", "", "- [ ] alpha"].join("\n"),
    );
  });

  it("plain bullets between todos (Plate's phantom-todo quirk) don't count", () => {
    assertLockstep(
      ["- plain one", "- [ ] real one", "- plain two", "- [x] real two", "- plain three"].join(
        "\n",
      ),
    );
  });

  it("an empty checkbox is a non-task on both sides", () => {
    assertLockstep(["- [ ] ", "- [ ] real task"].join("\n"));
  });

  it("checkbox lookalikes in fenced code never count", () => {
    assertLockstep(["```", "- [ ] fenced lookalike", "```", "", "- [ ] real"].join("\n"));
  });

  it("tasks spread across headings, paragraphs and separate lists", () => {
    assertLockstep(
      [
        "# Plan",
        "",
        "- [ ] one",
        "",
        "Some prose between lists.",
        "",
        "## Later",
        "",
        "- [x] two",
        "- [ ] three",
      ].join("\n"),
    );
  });

  it("inline markdown and wiki links in the item text don't affect position", () => {
    assertLockstep(
      ["- [ ] **buy** milk", "- [ ] see [[target note|the plan]]", "- [x] `code`"].join("\n"),
    );
  });

  it("CRLF line endings count identically", () => {
    assertLockstep("# H\r\n\r\n- [ ] one\r\n- [x] two\r\n");
  });

  // ------------------------------------------------------------------------
  // Container blocks — tasks nested inside a blockquote, callout, or <toggle>
  // sit at depth ≥ 2 in the Plate tree. `todoIndex` traverses the whole tree
  // in document pre-order (not top-level only), so a nested todo and the
  // top-level todo after it get distinct ordinals matching scanTaskItems (the
  // disk authority) — Delegate targets the right checkbox. (This class was a
  // real wrong-checkbox bug until todoIndex moved to pre-order traversal.)

  it("nested: a task inside a blockquote counts in document order", () => {
    assertLockstep(["> - [ ] quoted task", "", "- [ ] after"].join("\n"));
  });

  it("nested: sibling tasks inside one blockquote count distinctly", () => {
    assertLockstep(["> - [ ] q1", "> - [ ] q2", "", "- [ ] after"].join("\n"));
  });

  it("nested: a task inside a callout counts in document order", () => {
    assertLockstep(["> [!NOTE]", "> - [ ] callout task", "", "- [ ] after"].join("\n"));
  });

  it("nested: a task inside a <toggle> counts in document order", () => {
    assertLockstep(
      ["<toggle>", "", "- [ ] inside toggle", "", "</toggle>", "", "- [ ] after"].join("\n"),
    );
  });

  // Indented code — the app's canonical flavor is the MDX vocabulary, where
  // indented code blocks DO NOT EXIST (micromark-extension-mdx-md disables
  // `codeIndented`), so a 4-space-indented `- [ ]` line parses as a live
  // task in the editor. scanTaskItems reads the same grammar (link-extract's
  // remarkNoIndentedCode), so the disk-side count agrees ordinal-for-ordinal.
  // (This was a tracked parser-mismatch bug: plain remark-gfm read the line
  // as code, skipped it, and every later renderer ordinal was off by one.)
  it("an indented (4-space) checkbox is a live task on both sides", () => {
    assertLockstep(["Notes", "", "    - [ ] indented-code lookalike", "", "- [ ] real"].join("\n"));
  });
});
