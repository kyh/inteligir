import { afterEach, describe, expect, test } from "vitest";
import { createMarkdownEditor, type MarkdownEditor } from "../create-markdown-editor";
import { foldExtension } from "../vendor/prosemark/lib/fold/core";
import { posOf, rangesWithClass, stateWithStack, widgetRanges } from "./helpers";

const doc = `start here

| Name | **Bold** head | Right |
| --- | :---: | ---: |
| a \`code\` b | [link](https://x.dev) | 1 |
| *em* | ~~gone~~ | $x^2$ |
| ragged |

after
`;

let editor: MarkdownEditor | undefined;
afterEach(() => {
  editor?.destroy();
  editor = undefined;
});

const tableFrom = posOf(doc, "| Name |");
const tableTo = posOf(doc, "| ragged |") + "| ragged |".length;

describe("table decorations", () => {
  test("a table folds to one block widget over all its lines", () => {
    const widgets = widgetRanges(stateWithStack(doc, 0).field(foldExtension));
    expect(widgets).toContainEqual([tableFrom, tableTo]);
  });

  test("a selection inside unfolds to marked-up SOURCE lines, not a widget", () => {
    const state = stateWithStack(doc, tableFrom + 4);
    const decorations = state.field(foldExtension);
    expect(widgetRanges(decorations).some(([from]) => from === tableFrom)).toBe(false);
    const lines = rangesWithClass(decorations, "cm-table-source-line");
    const first = state.doc.lineAt(tableFrom).number;
    const last = state.doc.lineAt(tableTo).number;
    expect(lines.length).toBe(last - first + 1);
    expect(lines).toContainEqual([state.doc.line(first).from, state.doc.line(first).from]);
  });
});

const mount = (source = doc): MarkdownEditor =>
  createMarkdownEditor({ parent: document.body, doc: source });

describe("table rendering", () => {
  test("cells carry their own inline markdown, rendered", () => {
    editor = mount();
    const table = editor.view.contentDOM.querySelector(".cm-table table");
    expect(table).not.toBeNull();
    expect([...(table?.querySelectorAll("th") ?? [])].map((cell) => cell.textContent)).toEqual([
      "Name",
      "Bold head",
      "Right",
    ]);
    expect(table?.querySelector("th strong")?.textContent).toBe("Bold");
    expect(table?.querySelector("td code")?.textContent).toBe("code");
    expect(table?.querySelector("td em")?.textContent).toBe("em");
    expect(table?.querySelector("td del")?.textContent).toBe("gone");
  });

  test("a link renders as its label, styled and inert", () => {
    editor = mount();
    const link = editor.view.contentDOM.querySelector(".cm-table .cm-rendered-link");
    expect(link?.textContent).toBe("link");
    expect(link?.tagName.toLowerCase()).toBe("span");
    expect(editor.view.contentDOM.querySelector(".cm-table a")).toBeNull();
  });

  test("a construct the cell renderer has no case for keeps its own bytes", () => {
    editor = mount();
    const cells = [...editor.view.contentDOM.querySelectorAll(".cm-table td")].map(
      (cell) => cell.textContent,
    );
    expect(cells).toContain("$x^2$");
  });

  test("the delimiter row's alignment reaches the cells", () => {
    editor = mount();
    const headers = [...editor.view.contentDOM.querySelectorAll(".cm-table th")];
    expect(headers.map((cell) => cell.getAttribute("style"))).toEqual([
      "text-align: left;",
      "text-align: center;",
      "text-align: right;",
    ]);
  });

  test("a ragged row renders the cells it has", () => {
    editor = mount();
    const rows = [...editor.view.contentDOM.querySelectorAll(".cm-table tbody tr")];
    expect(rows.map((row) => row.querySelectorAll("td").length)).toEqual([3, 3, 1]);
  });

  test("a hostile cell reaches the DOM as text, never as markup", () => {
    editor = mount("start\n\n| a |\n| --- |\n| <img src=x onerror=alert(1)> |\n");
    const cell = editor.view.contentDOM.querySelector(".cm-table td");
    expect(cell?.textContent).toBe("<img src=x onerror=alert(1)>");
    expect(cell?.querySelector("img")).toBeNull();
  });

  test("rendering and editing a table never rewrites a byte", () => {
    editor = mount();
    expect(editor.getDoc()).toBe(doc);
    editor.view.dispatch({
      changes: { from: tableTo, insert: " extra |" },
      userEvent: "input.type",
    });
    editor.view.dispatch({ selection: { anchor: 0 } });
    expect(editor.getDoc()).toBe(`${doc.slice(0, tableTo)} extra |${doc.slice(tableTo)}`);
  });
});
