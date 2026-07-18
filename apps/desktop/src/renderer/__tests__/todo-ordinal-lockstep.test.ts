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
  // KNOWN DIVERGENCES — real wrong-checkbox bugs, documented, NOT accepted.
  //
  // Class 1 — container blocks. Tasks nested inside a blockquote, callout,
  // or <toggle> sit at depth ≥ 2 in the Plate tree, but `todoIndex` counts
  // only TOP-LEVEL children: every container-nested todo computes its
  // ordinal as if the container were the boundary, and every todo AFTER the
  // container skips the nested ones entirely. scanTaskItems (the disk
  // authority) counts them all in document pre-order. These docs open Rich
  // (the blockquote doc below is byte-canonical), the Delegate button
  // renders on every one of these elements, and a click on the task after
  // the container delegates the CONTAINER's task — the agent does the wrong
  // task and checks the wrong box.
  //
  // Class 2 — indented code. The editor pipeline is MDX
  // (remark-mdx-agnostic): indented code blocks DO NOT EXIST in MDX, so a
  // 4-space-indented `- [ ]` line parses as a real nested task and renders a
  // live checkbox — while scanTaskItems' plain remark-gfm processor reads it
  // as an indented code block and skips it. Every ordinal after the line is
  // off by one on the renderer side.
  //
  // `it.fails` keeps the suite green while the bugs exist and flips RED the
  // moment the divergence is fixed — promote each to plain `it` in the same
  // change that fixes it. Do NOT "fix" a failure here by adjusting
  // scanTaskItems' counting: disk-side counting is the authority
  // (find-task-line + the guarded toggle + the tasks view already share it).
  // ------------------------------------------------------------------------

  it.fails("KNOWN BUG: a task inside a blockquote desyncs every later ordinal", () => {
    assertLockstep(["> - [ ] quoted task", "", "- [ ] after"].join("\n"));
  });

  it.fails("KNOWN BUG: sibling tasks inside one blockquote collide at ordinal 0", () => {
    assertLockstep(["> - [ ] q1", "> - [ ] q2", "", "- [ ] after"].join("\n"));
  });

  it.fails("KNOWN BUG: a task inside a callout desyncs every later ordinal", () => {
    assertLockstep(["> [!NOTE]", "> - [ ] callout task", "", "- [ ] after"].join("\n"));
  });

  it.fails("KNOWN BUG: a task inside a <toggle> desyncs every later ordinal", () => {
    assertLockstep(
      ["<toggle>", "", "- [ ] inside toggle", "", "</toggle>", "", "- [ ] after"].join("\n"),
    );
  });

  it.fails("KNOWN BUG: an indented-code checkbox is a live task to the editor only", () => {
    assertLockstep(["Notes", "", "    - [ ] indented-code lookalike", "", "- [ ] real"].join("\n"));
  });
});
