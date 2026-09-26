import { createRef } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { ElementApi, KEYS, NodeApi, TextApi } from "platejs";
import type { Operation, Path, Value } from "platejs";
import { createPlateEditor } from "platejs/react";
import type { PlateEditor } from "platejs/react";

import { TOUCH_EDITOR_KIT } from "@repo/editor/kits/touch-editor-kit";
import { parseMarkdown, serializeNote } from "@repo/editor/markdown/markdown-doc";
import { createOpenNoteStore } from "@repo/editor/note/open-note-store";
import { GROUPS } from "@repo/editor/slash-menu";
import { installFakeEditorHost } from "@repo/editor/test-support/fake-editor-host";

import { EditorHarness } from "./editor-harness";

const NOTE = [
  "before",
  "",
  "```inteligir-chart",
  '{"type":"bar","data":[{"label":"A","value":3}]}',
  "```",
  "",
  "```inteligir-canvas",
  "[inteligir:grid:v2]",
  "..##..",
  "```",
  "",
  "```inteligir-html",
  "<p>hello</p>",
  "```",
  "",
  ":::tabs",
  "=== One",
  "inside the first tab",
  "",
  "=== Two",
  "inside the second tab",
  ":::",
  "",
  "<column_group>",
  "  <column>",
  "    left column",
  "  </column>",
  "",
  "  <column>",
  "    right column",
  "  </column>",
  "</column_group>",
  "",
  "after",
  "",
].join("\n");

const valueOf = (md: string) => {
  const parsed = parseMarkdown(md);
  if (!parsed.ok) {
    throw new Error(`the note must parse: ${parsed.reason.kind}`);
  }
  return parsed.value;
};

const touchEditor = (md = NOTE): PlateEditor =>
  createPlateEditor({ plugins: TOUCH_EDITOR_KIT, value: valueOf(md) });

const topLevelPath = (editor: PlateEditor, type: string): Path => {
  const index = editor.children.findIndex(
    (node) => ElementApi.isElement(node) && node.type === type,
  );
  if (index === -1) {
    throw new Error(`the note holds no ${type}`);
  }
  return [index];
};

const textPath = (editor: PlateEditor, text: string): Path => {
  for (const [node, path] of NodeApi.texts(editor)) {
    if (TextApi.isText(node) && node.text === text) {
      return path;
    }
  }
  throw new Error(`no text node reads "${text}"`);
};

// the whole model, not only the bytes: a void's text child never serializes, so an edit there
// would leave the bytes alone and still be an edit
const snapshot = (editor: PlateEditor) => ({
  bytes: serializeNote(editor),
  children: structuredClone(editor.children),
  undos: editor.history.undos.length,
});

const RICH_VOIDS = ["chart_block", "canvas_block", "html_block"] as const;

describe("the rich-block lock refuses every edit inside a locked block", () => {
  beforeEach(() => {
    installFakeEditorHost();
  });

  it.each(RICH_VOIDS)("a %s keeps its payload and its text", (type) => {
    const editor = touchEditor();
    const before = snapshot(editor);
    const at = topLevelPath(editor, type);

    editor.tf.setNodes({ value: "{}" }, { at });
    editor.tf.insertText("typed", { at: { offset: 0, path: [...at, 0] }, voids: true });

    expect(snapshot(editor)).toEqual(before);
  });

  it.each([
    ["the first tab", "inside the first tab"],
    ["a column", "left column"],
  ])("typing, deleting and splitting inside %s change nothing", (_where, text) => {
    const editor = touchEditor();
    const before = snapshot(editor);
    const at = textPath(editor, text);

    editor.tf.insertText("typed", { at: { offset: 0, path: at } });
    editor.tf.select({ offset: text.length, path: at });
    editor.tf.deleteBackward("character");
    editor.tf.insertBreak();
    editor.tf.setNodes({ type: "h1" }, { at: at.slice(0, -1) });

    expect(snapshot(editor)).toEqual(before);
  });

  it("a tab keeps its label and a column its width", () => {
    const editor = touchEditor();
    const before = snapshot(editor);

    editor.tf.setNodes({ label: "Renamed" }, { at: [...topLevelPath(editor, "tab_group"), 0] });
    editor.tf.setNodes({ width: "70%" }, { at: [...topLevelPath(editor, "column_group"), 0] });
    editor.tf.insertNodes(
      { children: [{ children: [{ text: "" }], type: "p" }], label: "Three", type: "tab_panel" },
      { at: [...topLevelPath(editor, "tab_group"), 2] },
    );

    expect(snapshot(editor)).toEqual(before);
  });

  // Slate merges the paragraph into the group's last block, a move and a merge inside the lock
  it.each([
    ["tab group", "before\n\n:::tabs\n=== One\ninside\n:::\n\nafter\n"],
    [
      "column group",
      "before\n\n<column_group>\n  <column>\n    left\n  </column>\n\n  <column>\n    right\n  </column>\n</column_group>\n\nafter\n",
    ],
  ])("a backspace from the paragraph after a %s leaves the group whole", (_group, md) => {
    const editor = touchEditor(md);
    const before = snapshot(editor);
    editor.tf.select({ offset: 0, path: textPath(editor, "after") });

    editor.tf.deleteBackward("character");

    expect(snapshot(editor)).toEqual(before);
  });

  it("typing beside a locked block changes only that paragraph", () => {
    const editor = touchEditor();
    const before = serializeNote(editor);

    editor.tf.insertText("!", {
      at: { offset: "before".length, path: textPath(editor, "before") },
    });
    editor.tf.insertText("?", { at: { offset: "after".length, path: textPath(editor, "after") } });

    expect(serializeNote(editor)).toBe(
      before.replace("before\n", "before!\n").replace("\nafter\n", "\nafter?\n"),
    );
  });

  it.each([...RICH_VOIDS, "tab_group", "column_group"])(
    "a whole %s can still be deleted, and one undo brings it back",
    (type) => {
      const editor = touchEditor();
      const before = serializeNote(editor);

      editor.tf.removeNodes({ at: topLevelPath(editor, type) });
      expect(serializeNote(editor)).not.toBe(before);

      editor.tf.undo();
      expect(serializeNote(editor)).toBe(before);
    },
  );

  it("a re-seed replaces the whole note, locked blocks and all", () => {
    const editor = touchEditor();
    const next = NOTE.replace('"value":3', '"value":9').replace("left column", "moved left");

    editor.tf.setValue(valueOf(next));

    expect(serializeNote(editor)).toBe(serializeNote(touchEditor(next)));
    expect(serializeNote(editor)).toContain("moved left");
  });
});

describe("a locked block's controls", () => {
  beforeEach(() => {
    installFakeEditorHost();
  });

  it("switching tabs is not an edit: it applies no operation", () => {
    const ref = createRef<PlateEditor>();
    render(
      <EditorHarness
        ref={ref}
        profile="touch"
        store={createOpenNoteStore()}
        value={valueOf(NOTE)}
      />,
    );
    const editor = ref.current;
    if (editor === null) {
      throw new Error("the harness did not hand over its editor");
    }
    // every transform applies through editor.apply, an op the lock refuses included
    const applied: Operation[] = [];
    const { apply } = editor.tf;
    editor.apply = (op: Operation) => {
      applied.push(op);
      apply(op);
    };
    const second = screen.getByText("inside the second tab");
    expect(second.closest("[data-tab-panel]")?.className).toContain("hidden");

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Two" }));
    });

    expect(second.closest("[data-tab-panel]")?.className).not.toContain("hidden");
    expect(applied).toEqual([]);

    act(() => {
      editor.tf.insertText("!", { at: { offset: 0, path: textPath(editor, "before") } });
    });
    expect(applied.length, "the log sees an edit").toBeGreaterThan(0);
  });

  // a block the touch kit would insert and then refuse every keystroke into
  it.each([
    ["touch", false],
    ["desktop", true],
  ] as const)("the %s slash menu offers the rich blocks: %s", async (profile, offered) => {
    const value: Value = [
      {
        children: [{ text: "" }, { children: [{ text: "" }], type: KEYS.slashInput }, { text: "" }],
        type: "p",
      },
    ];
    render(<EditorHarness profile={profile} store={createOpenNoteStore()} value={value} />);
    const options = await screen.findAllByRole("option");
    const shown = options.map((option) => option.textContent);
    const rich = GROUPS.flatMap((group) => group.items).filter((item) => item.richBlock === true);

    expect(rich.length).toBeGreaterThan(0);
    for (const item of rich) {
      expect(
        shown.some((text) => text.includes(item.description)),
        item.label,
      ).toBe(offered);
    }
    expect(shown.some((text) => text.includes("Plain paragraph."))).toBe(true);
  });

  it.each([
    ["touch", []],
    ["desktop", ["Edit data", "Sketch", "Edit payload", "Edit", "Add tab"]],
  ] as const)("the %s kit draws only the editing controls it would apply", (profile, editing) => {
    render(<EditorHarness profile={profile} store={createOpenNoteStore()} value={valueOf(NOTE)} />);
    for (const name of ["Edit data", "Sketch", "Edit payload", "Edit", "Add tab"]) {
      expect(screen.queryAllByRole("button", { name }).length > 0, name).toBe(
        editing.some((drawn) => drawn === name),
      );
    }
    for (const name of ["Source", "Preview", "Run", "One", "Two"]) {
      expect(screen.getAllByRole("button", { name }).length, name).toBeGreaterThan(0);
    }
  });
});
