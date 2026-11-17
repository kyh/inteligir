import { describe, expect, it } from "vitest";
import { createSlateEditor } from "platejs";

import {
  TURN_INTO,
  effectiveBlockEntry,
  moveBlocks,
  turnIntoAt,
  turnIntoBlocks,
  turnIntoOption as opt,
  turnIntoOptionFor,
  turnIntoSelection,
} from "@repo/editor/block-transforms";
import type { TurnIntoId } from "@repo/editor/block-transforms";
import { EDITOR_KIT } from "@repo/editor/kits/editor-kit";
import { parseMarkdown, serializeNote } from "@repo/editor/headless/markdown/markdown-doc";
import { meaningOf, readValue, rewrite } from "@repo/editor/test-support/markdown-meaning";

const makeEditor = (md: string) => {
  const parsed = parseMarkdown(md);
  const value = parsed.ok ? parsed.value : [{ children: [{ text: "" }], type: "p" }];
  return createSlateEditor({ plugins: EDITOR_KIT, value });
};

type Editor = ReturnType<typeof makeEditor>;

const out = (editor: Editor): string => serializeNote(editor);

describe("TURN_INTO menu (decision #8)", () => {
  it("offers exactly the locked target set, in menu order — no columns", () => {
    expect(TURN_INTO.map((o) => o.id)).toStrictEqual([
      "text",
      "heading-1",
      "heading-2",
      "heading-3",
      "bulleted-list",
      "numbered-list",
      "todo-list",
      "quote",
      "callout",
      "code-block",
      "toggle",
    ]);
  });
});

describe("turnIntoAt round-trips", () => {
  it("paragraph → toggle → paragraph", () => {
    const editor = makeEditor("hello\n");
    turnIntoAt(editor, [0], opt("toggle"));
    expect(out(editor)).toBe(":::toggle\nhello\n:::\n");
    turnIntoAt(editor, [0], opt("text"));
    expect(out(editor)).toBe("hello\n");
  });

  it("toggle with a body promotes its children on unwrap", () => {
    const editor = makeEditor(":::toggle\nsummary\n\nbody\n:::\n");
    turnIntoAt(editor, [0], opt("text"));
    expect(out(editor)).toBe("summary\n\nbody\n");
  });

  it("paragraph → callout is a Note alert; → paragraph is no alert", () => {
    const editor = makeEditor("hello\n");
    turnIntoAt(editor, [0], opt("callout"));
    expect(out(editor)).toBe("> [!NOTE]\n> hello\n");
    turnIntoAt(editor, [0], opt("text"));
    expect(out(editor)).toBe("hello\n");
    expect(editor.children[0]).not.toHaveProperty("alert");
  });

  it("callout → quote drops the alert; quote → callout is a Note; an alert keeps the one it is", () => {
    const editor = makeEditor("> [!NOTE] hello\n");
    turnIntoAt(editor, [0], opt("quote"));
    expect(out(editor)).toBe("> hello\n");
    turnIntoAt(editor, [0], opt("callout"));
    expect(out(editor)).toBe("> [!NOTE]\n> hello\n");

    const tip = makeEditor("> [!TIP]\n> hello\n");
    turnIntoAt(tip, [0], opt("callout"));
    expect(out(tip)).toBe("> [!TIP]\n> hello\n");
  });

  it.each<[TurnIntoId, string]>([
    ["quote", "## Heading\n\n> item typed\n"],
    ["callout", "## Heading\n\n> [!NOTE]\n> item typed\n"],
  ])("a block turned into a %s is the quote the reader makes, the caret still in it", (id, md) => {
    const editor = makeEditor("## Heading\n\n- item\n");
    editor.tf.select(editor.api.end([1]));
    turnIntoSelection(editor, opt(id));
    editor.tf.insertText(" typed");
    expect(meaningOf(editor.children)).toBe(meaningOf(readValue(md)));
    expect(out(editor)).toBe(md);
  });

  it("paragraph → code block → paragraph (multi-line)", () => {
    const editor = makeEditor("hello\n");
    turnIntoAt(editor, [0], opt("code-block"));
    expect(out(editor)).toBe("```\nhello\n```\n");
    turnIntoAt(editor, [0], opt("text"));
    expect(out(editor)).toBe("hello\n");

    const multi = makeEditor("```\nline one\nline two\n```\n");
    turnIntoAt(multi, [0], opt("text"));
    expect(out(multi)).toBe("line one\n\nline two\n");
  });

  it("paragraph → todo list carries checked:false (serializes as - [ ])", () => {
    const editor = makeEditor("task\n");
    turnIntoAt(editor, [0], opt("todo-list"));
    expect(out(editor)).toBe("- [ ] task\n");
    turnIntoAt(editor, [0], opt("text"));
    expect(out(editor)).toBe("task\n");
  });

  it("list → heading clears list props", () => {
    const editor = makeEditor("- item\n");
    turnIntoAt(editor, [0], opt("heading-2"));
    expect(out(editor)).toBe("## item\n");
  });

  it("every conversion output stays canonical (round-trip stable)", () => {
    for (const target of TURN_INTO) {
      const editor = makeEditor("hello world\n");
      turnIntoAt(editor, [0], target);
      const md = out(editor);
      expect(rewrite(md), `${target.label} output must be canonical`).toBe(md);
    }
  });
});

describe("turnIntoOptionFor (toolbar type indicator)", () => {
  it("identifies paragraphs, lists, quotes, callouts, toggles", () => {
    expect(turnIntoOptionFor({ children: [{ text: "" }], type: "p" }).id).toBe("text");
    expect(
      turnIntoOptionFor({ children: [{ text: "" }], listStyleType: "todo", type: "p" }).id,
    ).toBe("todo-list");
    expect(turnIntoOptionFor({ children: [{ text: "plain" }], type: "blockquote" }).id).toBe(
      "quote",
    );
    expect(
      turnIntoOptionFor({ alert: "TIP", children: [{ text: "hi" }], type: "blockquote" }).id,
    ).toBe("callout");
    expect(turnIntoOptionFor({ children: [{ text: "" }], type: "toggle" }).id).toBe("toggle");
  });
});

describe("multi-block turn into", () => {
  it("converts every named block when a code block before them splits into lines", () => {
    const editor = makeEditor("```\nl1\nl2\n```\n\np\n");
    turnIntoBlocks(editor, [[0], [1]], opt("heading-1"));
    expect(out(editor)).toBe("# l1\n\n# l2\n\n# p\n");
  });

  it("leaves a toggle's promoted child alone and converts the block after it", () => {
    const editor = makeEditor(":::toggle\nsummary\n\nchild\n:::\n\np\n");
    turnIntoBlocks(editor, [[0], [1]], opt("heading-2"));
    expect(out(editor)).toBe("## summary\n\nchild\n\n## p\n");
  });

  it("a selection across a toggle converts the toggle, its body and the block after it", () => {
    const editor = makeEditor(":::toggle\nsummary\n\nchild\n:::\n\np\n");
    turnIntoSelection(editor, opt("heading-2"), {
      anchor: { offset: 0, path: [0, 0, 0] },
      focus: { offset: 1, path: [1, 0] },
    });
    expect(out(editor)).toBe("## summary\n\n## child\n\n## p\n");
  });
});

describe("turn into over a code block", () => {
  const CODE_THEN_P = "```\nl1\nl2\n```\n\np\n";
  const acrossLinesAndP = {
    anchor: { offset: 0, path: [0, 0, 0] },
    focus: { offset: 1, path: [1, 0] },
  };

  it("the block menu converts the whole block", () => {
    const editor = makeEditor(CODE_THEN_P);
    turnIntoBlocks(editor, [[0], [1]], opt("quote"));
    expect(out(editor)).toBe("> l1\n\n> l2\n\n> p\n");
  });

  it("a selection over its lines converts it as the block menu does, for every target", () => {
    for (const target of TURN_INTO) {
      const viaMenu = makeEditor(CODE_THEN_P);
      turnIntoBlocks(viaMenu, [[0], [1]], target);
      const viaSelection = makeEditor(CODE_THEN_P);
      turnIntoSelection(viaSelection, target, acrossLinesAndP);
      expect(out(viaSelection), target.label).toBe(out(viaMenu));
    }
  });

  it("a caret on one line reads as the code block and converts all of it", () => {
    const editor = makeEditor(CODE_THEN_P);
    editor.tf.select({ offset: 1, path: [0, 1, 0] });
    const entry = effectiveBlockEntry(editor);
    expect(entry && turnIntoOptionFor(entry[0]).id).toBe("code-block");
    turnIntoSelection(editor, opt("heading-2"));
    expect(out(editor)).toBe("## l1\n\n## l2\n\np\n");
  });
});

describe(moveBlocks, () => {
  it("moves a block up and down; no-ops at the edges", () => {
    const editor = makeEditor("one\n\ntwo\n\nthree\n");
    moveBlocks(editor, [[1]], "up");
    expect(out(editor)).toBe("two\n\none\n\nthree\n");
    moveBlocks(editor, [[1]], "down");
    expect(out(editor)).toBe("two\n\nthree\n\none\n");
    moveBlocks(editor, [[0]], "up");
    expect(out(editor)).toBe("two\n\nthree\n\none\n");
    moveBlocks(editor, [[2]], "down");
    expect(out(editor)).toBe("two\n\nthree\n\none\n");
  });

  it("moves a multi-block span as a unit", () => {
    const editor = makeEditor("one\n\ntwo\n\nthree\n\nfour\n");
    moveBlocks(editor, [[1], [2]], "up");
    expect(out(editor)).toBe("two\n\nthree\n\none\n\nfour\n");
    moveBlocks(editor, [[0], [1]], "down");
    expect(out(editor)).toBe("one\n\ntwo\n\nthree\n\nfour\n");
  });

  it("no-ops on a gapped selection rather than carrying a neighbour across the gap", () => {
    const editor = makeEditor("one\n\ntwo\n\nthree\n\nfour\n");
    moveBlocks(editor, [[0], [2]], "down");
    expect(out(editor)).toBe("one\n\ntwo\n\nthree\n\nfour\n");
    moveBlocks(editor, [[1], [3]], "up");
    expect(out(editor)).toBe("one\n\ntwo\n\nthree\n\nfour\n");
  });

  it("no-ops on a selection that spans two parents", () => {
    const md = ":::toggle\nsummary\n\nchild\n:::\n\nafter\n";
    const editor = makeEditor(md);
    moveBlocks(editor, [[0, 1], [1]], "up");
    expect(out(editor)).toBe(md);
  });
});
