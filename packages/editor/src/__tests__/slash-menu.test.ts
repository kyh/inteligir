import { redo, undo } from "@codemirror/commands";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { fireEvent } from "@testing-library/dom";
import { afterEach, describe, expect, test } from "vitest";
import { createMarkdownEditor, type MarkdownEditor } from "../create-markdown-editor";
import { slashMenuExtension, type SlashBlock, type SlashItem } from "../slash-menu";
import { posOf } from "./helpers";

const handoffs: SlashBlock[] = [];

const items = (): SlashItem[] => [
  {
    id: "heading-1",
    label: "Heading 1",
    hint: "#",
    keywords: ["h1"],
    action: { kind: "insert", text: "# ", caret: 2 },
  },
  { id: "quote", label: "Quote", hint: ">", action: { kind: "insert", text: "> ", caret: 2 } },
  {
    id: "ask",
    label: "Ask the agent…",
    keywords: ["agent"],
    action: {
      kind: "handoff",
      run: (block) => {
        handoffs.push(block);
      },
    },
  },
];

let editor: MarkdownEditor | undefined;
let writes = 0;

afterEach(() => {
  editor?.destroy();
  editor = undefined;
  handoffs.length = 0;
  writes = 0;
});

const mount = (doc: string, vocabulary = items): MarkdownEditor => {
  const mounted = createMarkdownEditor({
    parent: document.body,
    doc,
    extensions: [
      slashMenuExtension({ items: vocabulary }),
      EditorView.updateListener.of((update) => {
        writes += update.transactions.filter((tr) => tr.docChanged).length;
      }),
    ],
  });
  editor = mounted;
  return mounted;
};

/** One insertion per character, carrying the user event CodeMirror's own
 *  input handling carries. */
const type = (mounted: MarkdownEditor, text: string): void => {
  for (const char of text) {
    const at = mounted.view.state.selection.main.head;
    mounted.view.dispatch({
      changes: { from: at, insert: char },
      selection: EditorSelection.single(at + char.length),
      userEvent: "input.type",
    });
  }
};

const backspace = (mounted: MarkdownEditor): void => {
  const at = mounted.view.state.selection.main.head;
  mounted.view.dispatch({
    changes: { from: at - 1, to: at },
    selection: EditorSelection.single(at - 1),
    userEvent: "delete.backward",
  });
};

const caretAt = (mounted: MarkdownEditor, pos: number): void => {
  mounted.view.dispatch({ selection: EditorSelection.single(pos) });
};

const rows = (mounted: MarkdownEditor): string[] =>
  [...mounted.view.dom.querySelectorAll<HTMLElement>(".cm-slash-row")].map(
    (row) => row.dataset.slashItem ?? "",
  );

const rowFor = (mounted: MarkdownEditor, id: string): HTMLButtonElement => {
  const row = mounted.view.dom.querySelector<HTMLButtonElement>(`[data-slash-item="${id}"]`);
  if (row === null) throw new Error(`no slash row "${id}"`);
  return row;
};

const press = (mounted: MarkdownEditor, key: string): void => {
  fireEvent.keyDown(mounted.view.contentDOM, { key, bubbles: true });
};

const ALL_ROWS = ["heading-1", "quote", "ask"];

describe("where a slash opens the menu", () => {
  test("a block-empty line: the tree says a Paragraph begins at the slash", () => {
    const doc = "# Doc\n\n\n";
    const mounted = mount(doc);
    caretAt(mounted, posOf(doc, "\n\n") + 2);
    type(mounted, "/");
    expect(rows(mounted)).toEqual(ALL_ROWS);
  });

  test("inside a fence it is a literal slash", () => {
    const doc = "```js\nconst x = 1;\n```\n";
    const mounted = mount(doc);
    caretAt(mounted, posOf(doc, "const"));
    type(mounted, "/");
    expect(rows(mounted)).toEqual([]);
    expect(mounted.getDoc()).toBe(doc.replace("const", "/const"));
  });

  test("inside frontmatter it is a literal slash", () => {
    const doc = "---\ntitle: Doc\n\ntags: []\n---\n\nProse.\n";
    const mounted = mount(doc);
    caretAt(mounted, posOf(doc, "\n\ntags") + 1);
    type(mounted, "/");
    expect(rows(mounted)).toEqual([]);
  });

  test("mid-word it is a literal slash — the Paragraph started earlier", () => {
    const doc = "Some prose here.\n";
    const mounted = mount(doc);
    caretAt(mounted, posOf(doc, " here"));
    type(mounted, "/");
    expect(rows(mounted)).toEqual([]);
  });

  test("in a URL it is a literal slash — a URL's slashes never begin a block", () => {
    const doc = "See https://example.dev\n";
    const mounted = mount(doc);
    caretAt(mounted, posOf(doc, "\n"));
    type(mounted, "/");
    expect(rows(mounted)).toEqual([]);
    expect(mounted.getDoc()).toBe("See https://example.dev/\n");
  });

  test("a line lazily continuing the paragraph above begins no block", () => {
    const doc = "A paragraph.\n\n";
    const mounted = mount(doc);
    caretAt(mounted, posOf(doc, "\n"));
    type(mounted, "\n/");
    expect(rows(mounted)).toEqual([]);
  });

  test("a fast burst CodeMirror coalesced into one change still opens it", () => {
    const mounted = mount("\n");
    mounted.view.dispatch({
      changes: { from: 0, insert: "/qu" },
      selection: EditorSelection.single(3),
      userEvent: "input.type",
    });
    expect(rows(mounted)).toEqual(["quote"]);
  });

  test("a burst carrying a space is prose, not a query", () => {
    const mounted = mount("\n");
    mounted.view.dispatch({
      changes: { from: 0, insert: "/ and" },
      selection: EditorSelection.single(5),
      userEvent: "input.type",
    });
    expect(rows(mounted)).toEqual([]);
  });

  test("a pasted slash is not a trigger", () => {
    const mounted = mount("\n");
    mounted.view.dispatch({
      changes: { from: 0, insert: "/" },
      selection: EditorSelection.single(1),
      userEvent: "input.paste",
    });
    expect(rows(mounted)).toEqual([]);
  });
});

describe("the menu while it is open", () => {
  test("the query narrows by label prefix", () => {
    const mounted = mount("\n");
    type(mounted, "/");
    expect(rows(mounted)).toEqual(ALL_ROWS);
    type(mounted, "h");
    expect(rows(mounted)).toEqual(["heading-1"]);
  });

  test("a keyword the label does not spell matches too", () => {
    const mounted = mount("\n");
    type(mounted, "/agent");
    expect(rows(mounted)).toEqual(["ask"]);
  });

  test("a query nothing matches closes it rather than hanging there", () => {
    const mounted = mount("\n");
    type(mounted, "/zzz");
    expect(rows(mounted)).toEqual([]);
    expect(mounted.getDoc()).toBe("/zzz\n");
  });

  test("backspacing past the slash closes it", () => {
    const mounted = mount("\n");
    type(mounted, "/q");
    expect(rows(mounted)).toEqual(["quote"]);
    backspace(mounted);
    expect(rows(mounted)).toEqual(ALL_ROWS);
    backspace(mounted);
    expect(rows(mounted)).toEqual([]);
  });

  test("Escape closes it and leaves the literal text", () => {
    const mounted = mount("\n");
    type(mounted, "/quo");
    press(mounted, "Escape");
    expect(rows(mounted)).toEqual([]);
    expect(mounted.getDoc()).toBe("/quo\n");
  });

  test("arrows move the highlighted row, wrapping", () => {
    const mounted = mount("\n");
    type(mounted, "/");
    const selected = (): string | undefined =>
      mounted.view.dom.querySelector<HTMLElement>(".cm-slash-row-active")?.dataset.slashItem;
    expect(selected()).toBe("heading-1");
    press(mounted, "ArrowDown");
    expect(selected()).toBe("quote");
    press(mounted, "ArrowUp");
    press(mounted, "ArrowUp");
    expect(selected()).toBe("ask");
  });
});

describe("applying an item", () => {
  test("Enter writes the construct in ONE transaction, and undo takes it whole", () => {
    const doc = "Intro.\n\n\n";
    const mounted = mount(doc);
    const at = posOf(doc, "\n\n") + 2;
    caretAt(mounted, at);
    type(mounted, "/head");
    const before = writes;
    press(mounted, "Enter");
    expect(writes - before).toBe(1);
    expect(mounted.getDoc()).toBe("Intro.\n\n# \n");
    expect(mounted.view.state.selection.main.head).toBe(at + 2);

    undo(mounted.view);
    expect(mounted.getDoc()).toBe(doc);
    redo(mounted.view);
    expect(mounted.getDoc()).toBe("Intro.\n\n# \n");
  });

  test("clicking a row applies it too", () => {
    const mounted = mount("\n");
    type(mounted, "/q");
    fireEvent.click(rowFor(mounted, "quote"));
    expect(mounted.getDoc()).toBe("> \n");
    expect(rows(mounted)).toEqual([]);
  });

  test("a handoff row takes the query away and hands over the line it left", () => {
    const doc = "Intro.\n\n\n";
    const mounted = mount(doc);
    const at = posOf(doc, "\n\n") + 2;
    caretAt(mounted, at);
    type(mounted, "/agent");
    press(mounted, "Enter");
    expect(mounted.getDoc()).toBe(doc);
    expect(handoffs).toEqual([{ from: at, to: at, text: "" }]);
  });

  test("an empty vocabulary never opens a menu", () => {
    const mounted = mount("\n", () => []);
    type(mounted, "/");
    expect(rows(mounted)).toEqual([]);
  });

  test("Enter falls through to the editor when no menu is open", () => {
    const mounted = mount("\n");
    caretAt(mounted, 0);
    press(mounted, "Enter");
    expect(mounted.getDoc()).toBe("\n\n");
  });
});
