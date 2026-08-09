// The task-ordinal LOCKSTEP test — pins the editor's `todoIndex` (the
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

import { scanTaskItems } from "@repo/notes/knowledge/link-extract";

import { BASE_KIT } from "@repo/editor/kits/base-kit";
import { parseMarkdown } from "@repo/editor/markdown/markdown-doc";
import { isTodoItem, todoIndex } from "@repo/editor/todo-item";

/** Parse `md` through the live editor's seed path and assert that every todo
 * the Plate tree SHOWS resolves, by ordinal, to the source task scanTaskItems
 * assigns the same position. `hidden` is the number of source tasks the editor
 * cannot show because they sit inside an opaque block — their ordinals still
 * have to be consumed, or every later checkbox is off by one. */
function assertLockstep(md: string, hidden = 0): void {
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
  expect(todos.length).toBe(tasks.length - hidden);
  // …and each shown todo's click-time ordinal indexes the SOURCE task it was
  // rendered from, with matching checked state.
  let previous = -1;
  for (const element of todos) {
    const ordinal = todoIndex(editor, element);
    expect(ordinal).toBeGreaterThan(previous); // document order
    previous = ordinal;
    const task = tasks[ordinal];
    if (task === undefined) throw new Error(`no source task at ordinal ${ordinal}`);
    expect(element.checked).toBe(task.checked);
  }
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
  // disk authority) — Delegate targets the right checkbox. A top-level-only
  // traversal mis-numbers this whole class and delegates the wrong box.

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

  // Indented code — the app's canonical flavor has no indented code blocks
  // (md-plugins disables `codeIndented`), so a 4-space-indented `- [ ]` line
  // parses as a live task in the editor. scanTaskItems reads the same grammar
  // (link-extract's remarkPlainBlocks), so the disk-side count agrees
  // ordinal-for-ordinal. (The two grammars must not diverge: plain remark-gfm
  // reads that line as code and skips it, throwing every later renderer
  // ordinal off by one.)
  it("an indented (4-space) checkbox is a live task on both sides", () => {
    assertLockstep(["Notes", "", "    - [ ] indented-code lookalike", "", "- [ ] real"].join("\n"));
  });

  // Opaque blocks — a checkbox inside unknown JSX or raw HTML is ONE inert
  // string to the editor, but core reads the list underneath and counts it.
  // The editor cannot show that checkbox, so it must still SPEND its ordinal;
  // otherwise the next real checkbox inherits it and Delegate edits the wrong
  // line. Everything below would pass with the hidden count ignored — except
  // the ordinal of the todo that follows, which is the whole point.

  // The hidden items are `[x]` and the visible one `[ ]` on purpose: an ordinal
  // that skipped them would land on a checked task and the state compare — the
  // only identity these ordinals have — would catch it.

  it("hidden: a task inside unknown JSX spends its ordinal", () => {
    assertLockstep(
      ["<Steps>", "", "- [x] hidden", "", "</Steps>", "", "- [ ] after"].join("\n"),
      1,
    );
  });

  it("hidden: several tasks inside one opaque block spend all of them", () => {
    assertLockstep(
      ["<div>", "", "- [x] h1", "- [x] h2", "", "</div>", "", "- [ ] after"].join("\n"),
      2,
    );
  });

  it("hidden: an inline opaque hides nothing on either side", () => {
    assertLockstep(["- [ ] before <!-- a comment --> after", "- [x] second"].join("\n"));
  });
});
