import { describe, expect, it } from "vitest";
import { createSlateEditor } from "platejs";
import { serializeMd } from "@platejs/markdown";

import {
  TURN_INTO,
  moveBlocks,
  turnIntoAt,
  turnIntoOption as opt,
  turnIntoOptionFor,
} from "@repo/editor/block-transforms";
import { EDITOR_KIT } from "@repo/editor/kits/editor-kit";
import { MD_STRINGIFY, parseMarkdown, roundTrip } from "@repo/editor/markdown/markdown-doc";

function makeEditor(md: string) {
  const parsed = parseMarkdown(md);
  const value = parsed.ok ? parsed.value : [{ children: [{ text: "" }], type: "p" }];
  return createSlateEditor({ plugins: EDITOR_KIT, value });
}

type Editor = ReturnType<typeof makeEditor>;

function out(editor: Editor): string {
  return serializeMd(editor, { remarkStringifyOptions: MD_STRINGIFY });
}

describe("TURN_INTO menu (decision #8)", () => {
  it("offers exactly the locked target set, in menu order — no columns", () => {
    expect(TURN_INTO.map((o) => o.id)).toEqual([
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
    expect(out(editor)).toBe("<toggle>\n  hello\n</toggle>\n");
    turnIntoAt(editor, [0], opt("text"));
    expect(out(editor)).toBe("hello\n");
  });

  it("toggle with a body promotes its children on unwrap", () => {
    const editor = makeEditor("<toggle>\n  summary\n\n  body\n</toggle>\n");
    turnIntoAt(editor, [0], opt("text"));
    expect(out(editor)).toBe("summary\n\nbody\n");
  });

  it("paragraph → callout inserts the [!NOTE] marker; → paragraph strips it", () => {
    const editor = makeEditor("hello\n");
    turnIntoAt(editor, [0], opt("callout"));
    expect(out(editor)).toBe("> [!NOTE] hello\n");
    turnIntoAt(editor, [0], opt("text"));
    expect(out(editor)).toBe("hello\n");
  });

  it("callout → quote drops the marker; quote → callout adds it once", () => {
    const editor = makeEditor("> [!NOTE] hello\n");
    turnIntoAt(editor, [0], opt("quote"));
    expect(out(editor)).toBe("> hello\n");
    turnIntoAt(editor, [0], opt("callout"));
    expect(out(editor)).toBe("> [!NOTE] hello\n");
    turnIntoAt(editor, [0], opt("callout"));
    expect(out(editor)).toBe("> [!NOTE] hello\n");
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
      expect(roundTrip(md), `${target.label} output must be canonical`).toBe(md);
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
    expect(turnIntoOptionFor({ children: [{ text: "[!NOTE] hi" }], type: "blockquote" }).id).toBe(
      "callout",
    );
    expect(turnIntoOptionFor({ children: [{ text: "" }], type: "toggle" }).id).toBe("toggle");
  });
});

describe("moveBlocks", () => {
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
});
