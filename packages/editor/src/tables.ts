// GFM tables, at the maturity rung the #550 research called shape (b): a
// rendered REPLACE WIDGET that unfolds to its source when the selection
// touches it. Shape (c) — a nested EditorView per cell, with a transaction
// filter clamping the selection inside it — is explicitly not built. It is a
// month of focus races, and it buys editing a cell in place where this buys
// READING the table; the source is one click away either way.
//
// The per-cell markdown needs no second parser. @lezer/markdown's GFM table
// extension already parses each `TableCell`'s inline content into the MAIN
// tree — a cell carrying `**bold**` has a StrongEmphasis child right there —
// so the widget reads the tree the rest of the editor is already using, and
// there is no standalone parser instance to keep in step with the language
// config.
//
// WHAT A CELL RENDERS is a fixed list (`spansOf` below), and anything outside
// it renders as its own literal markdown. That is the rule the note pipeline
// already applies to constructs it has no node for: never lose the bytes,
// never guess. A link renders as its LABEL, styled but inert — a click
// anywhere in the widget places the caret, which unfolds the table to source
// where the link is a real one.
//
// The widget holds SPANS, not the state it was built from: a widget kept alive
// across rebuilds by `eq()` would otherwise pin an EditorState nobody else
// still needs. Spans materialize as elements and text nodes, so no markup is
// ever written and a hostile cell is inert by construction rather than by
// sanitizing.

import type { EditorState, Extension, Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { foldableSyntaxFacet } from "./vendor/prosemark/lib/fold/core";

/**
 * The column ceiling. One prose column among short ones takes every pixel the
 * layout will give it and squeezes the rest to a character each; capping the
 * cell is what keeps the OTHER columns readable. In `ch` because the thing
 * being bounded is a line length, not a box.
 */
const MAX_COLUMN_CH = 48;

type ColumnAlign = "left" | "center" | "right";

/** Rendered inline content: literal text, or an element wrapping more of it.
 *  Tagged rather than `string | object` so materialize() branches on the kind
 *  the builder decided, not on the runtime shape it happens to have. */
type Span =
  | { kind: "text"; text: string }
  | { kind: "element"; tag: string; className: string | null; children: Span[] };

function textSpan(text: string): Span {
  return { kind: "text", text };
}

const EMPHASIS_MARKS: ReadonlySet<string> = new Set(["EmphasisMark"]);
const CODE_MARKS: ReadonlySet<string> = new Set(["CodeMark"]);
const STRIKE_MARKS: ReadonlySet<string> = new Set(["StrikethroughMark"]);
const ESCAPE_MARKS: ReadonlySet<string> = new Set(["EscapeMark"]);
const LINK_PARTS: ReadonlySet<string> = new Set(["LinkMark", "URL", "LinkTitle", "LinkLabel"]);
const NOTHING: ReadonlySet<string> = new Set();

/** `node`'s content as spans, dropping the child node types in `skip` and
 *  taking everything between children as literal text. */
function childSpans(state: EditorState, node: SyntaxNode, skip: ReadonlySet<string>): Span[] {
  const spans: Span[] = [];
  let pos = node.from;
  for (let child = node.firstChild; child !== null; child = child.nextSibling) {
    if (child.from > pos) spans.push(textSpan(state.doc.sliceString(pos, child.from)));
    if (!skip.has(child.name)) spans.push(...spansOf(state, child));
    pos = child.to;
  }
  if (pos < node.to) spans.push(textSpan(state.doc.sliceString(pos, node.to)));
  return spans;
}

function element(
  state: EditorState,
  node: SyntaxNode,
  tag: string,
  skip: ReadonlySet<string>,
  className: string | null = null,
): Span[] {
  return [{ kind: "element", tag, className, children: childSpans(state, node, skip) }];
}

function spansOf(state: EditorState, node: SyntaxNode): Span[] {
  switch (node.name) {
    case "StrongEmphasis":
      return element(state, node, "strong", EMPHASIS_MARKS);
    case "Emphasis":
      return element(state, node, "em", EMPHASIS_MARKS);
    case "Strikethrough":
      return element(state, node, "del", STRIKE_MARKS);
    case "InlineCode":
      return element(state, node, "code", CODE_MARKS, "cm-inline-code");
    case "Link":
      // The label, styled like a link and inert — see the header.
      return element(state, node, "span", LINK_PARTS, "cm-rendered-link");
    case "Escape":
      return childSpans(state, node, ESCAPE_MARKS);
    default:
      // Everything else keeps its own bytes rather than being approximated.
      return [textSpan(state.doc.sliceString(node.from, node.to))];
  }
}

function materialize(host: HTMLElement, spans: readonly Span[]): void {
  for (const span of spans) {
    if (span.kind === "text") {
      host.append(span.text);
      continue;
    }
    const node = document.createElement(span.tag);
    if (span.className !== null) node.className = span.className;
    materialize(node, span.children);
    host.append(node);
  }
}

/** `| --- | :---: | ---: |` → the per-column alignment it declares. */
function alignmentsOf(delimiterRow: string): ColumnAlign[] {
  return delimiterRow
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((cell) => {
      const spec = cell.trim();
      if (spec.startsWith(":") && spec.endsWith(":")) return "center";
      if (spec.endsWith(":")) return "right";
      return "left";
    });
}

function rowSpans(state: EditorState, row: SyntaxNode): Span[][] {
  const cells: Span[][] = [];
  for (let cell = row.firstChild; cell !== null; cell = cell.nextSibling) {
    if (cell.name === "TableCell") cells.push(childSpans(state, cell, NOTHING));
  }
  return cells;
}

interface TableModel {
  align: ColumnAlign[];
  header: Span[][] | null;
  rows: Span[][][];
}

function readTable(state: EditorState, table: SyntaxNode): TableModel {
  const model: TableModel = { align: [], header: null, rows: [] };
  for (let child = table.firstChild; child !== null; child = child.nextSibling) {
    if (child.name === "TableHeader") {
      model.header = rowSpans(state, child);
    } else if (child.name === "TableRow") {
      model.rows.push(rowSpans(state, child));
    } else if (child.name === "TableDelimiter") {
      // The ALIGNMENT row is a Table-level TableDelimiter spanning the whole
      // line; the single `|` separators are TableDelimiters one level down.
      model.align = alignmentsOf(state.doc.sliceString(child.from, child.to));
    }
  }
  return model;
}

function appendRow(
  parent: HTMLElement,
  cells: readonly Span[][],
  tag: "td" | "th",
  align: readonly ColumnAlign[],
): void {
  const row = document.createElement("tr");
  cells.forEach((spans, column) => {
    const cell = document.createElement(tag);
    cell.className = "cm-table-cell";
    cell.style.textAlign = align[column] ?? "left";
    materialize(cell, spans);
    row.append(cell);
  });
  parent.append(row);
}

class TableWidget extends WidgetType {
  constructor(
    /** The table's own bytes — its whole identity, since the model derives
     * from them. */
    readonly source: string,
    readonly model: TableModel,
  ) {
    super();
  }

  override eq(other: TableWidget): boolean {
    return other.source === this.source;
  }

  override toDOM(): HTMLElement {
    const scroller = document.createElement("div");
    scroller.className = "cm-table";
    const table = document.createElement("table");
    if (this.model.header !== null) {
      const head = document.createElement("thead");
      appendRow(head, this.model.header, "th", this.model.align);
      table.append(head);
    }
    const body = document.createElement("tbody");
    for (const cells of this.model.rows) {
      appendRow(body, cells, "td", this.model.align);
    }
    table.append(body);
    scroller.append(table);
    return scroller;
  }

  // A click places the caret, which unfolds the table to its source.
  override ignoreEvent(): boolean {
    return false;
  }
}

const tableTheme = EditorView.theme({
  ".cm-table": {
    // A table wider than the column scrolls itself rather than widening the
    // document — the editor's measure of a line has to stay the editor's.
    overflowX: "auto",
    margin: "0.4em 0",
  },
  ".cm-table table": {
    borderCollapse: "collapse",
    fontSize: "0.95em",
  },
  ".cm-table-cell": {
    maxWidth: `${MAX_COLUMN_CH}ch`,
    padding: "0.25em 0.7em",
    border: "1px solid var(--pm-blockquote-vertical-line-background-color)",
    overflowWrap: "anywhere",
    verticalAlign: "top",
  },
  ".cm-table th.cm-table-cell": {
    fontWeight: "600",
    background: "var(--pm-code-background-color)",
  },
  // The unfolded state: still the real bytes, marked as a table being edited.
  ".cm-table-source-line": {
    fontFamily: "var(--pm-code-font)",
    fontSize: "0.9em",
    background: "var(--pm-code-background-color)",
  },
});

const sourceLineDecoration = Decoration.line({ class: "cm-table-source-line" });

export const tablesExtension: Extension = [
  foldableSyntaxFacet.of({
    nodePath: "Table",
    // Both states are drawn from here: the widget when the selection is
    // elsewhere, the marked-up source lines when it is inside. One spec,
    // rather than a second "edit mode" flag beside the fold state.
    keepDecorationOnUnfold: true,
    buildDecorations: (state, node, selectionTouchesRange) => {
      const from = state.doc.lineAt(node.from).from;
      const to = state.doc.lineAt(node.to).to;
      if (selectionTouchesRange) {
        const lines: Range<Decoration>[] = [];
        const first = state.doc.lineAt(from).number;
        const last = state.doc.lineAt(to).number;
        for (let number = first; number <= last; number += 1) {
          lines.push(sourceLineDecoration.range(state.doc.line(number).from));
        }
        return lines;
      }
      return Decoration.replace({
        widget: new TableWidget(state.doc.sliceString(from, to), readTable(state, node.node)),
        block: true,
      }).range(from, to);
    },
  }),
  tableTheme,
];
