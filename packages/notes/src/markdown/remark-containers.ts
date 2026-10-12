// The `:::` markers are line grammar, not block grammar: micromark reads them as paragraph text, so
// this transform splits marker lines out of the paragraphs of every flow container (the root, a
// quote, a list item, a footnote) and folds the blocks between an opener and its `:::` into one
// node. Containers nest, and a `:::` closes the innermost one open. A marker swallowed by an inline
// construct, or whose first character an escape wrote, is not a marker, and the serializer writes
// that escape before a line of text that would read as one. An opener whose container cannot be
// read whole (never closed, content before the first `=== Label` of tabs, anything but a
// `:::column` between columns) is prose, and the scan resumes after it rather than guessing.

import type {
  BlockContent,
  DefinitionContent,
  List,
  Node,
  Paragraph,
  Parent,
  Parents,
  PhrasingContent,
  Root,
  RootContent,
} from "mdast";
import type { Info, Options as ToMarkdownExtension, State } from "mdast-util-to-markdown";
import type { Plugin, Processor, Transformer } from "unified";

import { splitLinesKeepingTerminators } from "../text/source-lines";
import { isMdastRoot } from "./mdast-nodes";
import { escapedAt, textCutter } from "./text-escapes";

export type ContainerContent = BlockContent | DefinitionContent;

export interface Toggle extends Parent {
  type: "toggle";
  children: ContainerContent[];
}

export interface TabPanel extends Parent {
  type: "tabPanel";
  label: string;
  children: ContainerContent[];
}

export interface TabGroup extends Parent {
  type: "tabGroup";
  children: TabPanel[];
}

// `width` is what a resize commits; a column never resized has none
export interface Column extends Parent {
  type: "column";
  width: string | null;
  children: ContainerContent[];
}

export interface ColumnGroup extends Parent {
  type: "columnGroup";
  children: Column[];
}

declare module "mdast" {
  interface BlockContentMap {
    columnGroup: ColumnGroup;
    tabGroup: TabGroup;
    toggle: Toggle;
  }
  interface RootContentMap {
    column: Column;
    columnGroup: ColumnGroup;
    tabGroup: TabGroup;
    tabPanel: TabPanel;
    toggle: Toggle;
  }
}

const TOGGLE_LINE = ":::toggle";
const TABS_LINE = ":::tabs";
const COLUMNS_LINE = ":::columns";
const COLUMN_LINE = ":::column";
const CLOSE_LINE = ":::";
const WIDTH = String.raw`\d+(?:\.\d+)?%`;
const PANEL_RE = /^=== (?<label>.+)$/u;
const COLUMN_RE = new RegExp(`^${COLUMN_LINE}(?: (?<width>${WIDTH}))?$`, "u");

type Marker =
  | { kind: "open"; container: "columns" | "tabs" | "toggle" }
  | { kind: "column"; width: string | null }
  | { kind: "panel"; label: string }
  | { kind: "close" };

const markerFor = (line: string): Marker | null => {
  switch (line) {
    case TOGGLE_LINE: {
      return { container: "toggle", kind: "open" };
    }
    case TABS_LINE: {
      return { container: "tabs", kind: "open" };
    }
    case COLUMNS_LINE: {
      return { container: "columns", kind: "open" };
    }
    case CLOSE_LINE: {
      return { kind: "close" };
    }
    default: {
      const column = COLUMN_RE.exec(line);
      if (column !== null) {
        return { kind: "column", width: column.groups?.width ?? null };
      }
      const label = PANEL_RE.exec(line)?.groups?.label;
      return label === undefined ? null : { kind: "panel", label };
    }
  }
};

// a line this grammar may read as a marker, which a rewrite of its words would unmake
export const isMarkerLine = (line: string): boolean => markerFor(line) !== null;

interface Line {
  nodes: PhrasingContent[];
  // what ended it: the terminator split off its text, or nothing after a hard break or at the end
  terminator: string;
}

// a CRLF note's `\r` belongs to the terminator: it must neither hide a marker nor stay behind on
// the line a marker follows.
const linesOf = (children: PhrasingContent[]): Line[] => {
  const lines: Line[] = [];
  let nodes: PhrasingContent[] = [];
  const end = (terminator: string): void => {
    lines.push({ nodes, terminator });
    nodes = [];
  };
  for (const child of children) {
    if (child.type !== "text") {
      nodes.push(child);
      if (child.type === "break") {
        end("");
      }
      continue;
    }
    const parts = splitLinesKeepingTerminators(child.value);
    const cut = textCutter(child);
    let offset = 0;
    for (let at = 0; at < parts.length; at += 2) {
      if (at > 0) {
        const terminator = parts[at - 1] ?? "\n";
        end(terminator);
        offset += terminator.length;
      }
      const part = parts[at] ?? "";
      if (part !== "") {
        nodes.push(cut(offset, offset + part.length));
      }
      offset += part.length;
    }
  }
  end("");
  return lines;
};

const markerOf = (line: Line): Marker | null => {
  const [only, ...rest] = line.nodes;
  return only?.type === "text" && rest.length === 0 && !escapedAt(only, 0)
    ? markerFor(only.value)
    : null;
};

// a merged line keeps no escapes: no marker is read from the paragraphs this builds
const paragraphOf = (lines: readonly Line[]): Paragraph => {
  const children: PhrasingContent[] = [];
  const push = (node: PhrasingContent): void => {
    const last = children.at(-1);
    if (node.type === "text" && last?.type === "text") {
      children[children.length - 1] = { type: "text", value: last.value + node.value };
      return;
    }
    children.push(node);
  };
  for (const [index, line] of lines.entries()) {
    const before = lines[index - 1]?.terminator ?? "";
    if (before !== "") {
      push({ type: "text", value: before });
    }
    for (const node of line.nodes) {
      push(node);
    }
  }
  return { children, type: "paragraph" };
};

interface LineToken {
  kind: "line";
  line: Line;
  marker: Marker | null;
  paragraph: Paragraph;
  // which of the paragraph's `of` lines this is
  at: number;
  of: number;
}

type Token<T> = { kind: "block"; node: T; content: ContainerContent | null } | LineToken;

// only a paragraph holding a line that could be a marker is cut into lines; any other keeps its node
const tokensOf = <T>(
  children: readonly T[],
  asContent: (node: T) => ContainerContent | null,
): Token<T>[] =>
  children.flatMap((node): Token<T>[] => {
    const content = asContent(node);
    if (content?.type !== "paragraph") {
      return [{ content, kind: "block", node }];
    }
    const lines = linesOf(content.children);
    const markers = lines.map((line) => markerOf(line));
    if (markers.every((marker) => marker === null)) {
      return [{ content, kind: "block", node }];
    }
    return lines.map((line, at) => ({
      at,
      kind: "line",
      line,
      marker: markers[at] ?? null,
      of: lines.length,
      paragraph: content,
    }));
  });

// lines of one paragraph read in a row, between markers
interface Run {
  paragraph: Paragraph;
  from: number;
  of: number;
  lines: Line[];
}

const runOf = (token: LineToken): Run => ({
  from: token.at,
  lines: [token.line],
  of: token.of,
  paragraph: token.paragraph,
});

// a run that is its whole paragraph keeps the parsed node
const paragraphFrom = (run: Run): Paragraph =>
  run.from === 0 && run.lines.length === run.of ? run.paragraph : paragraphOf(run.lines);

// `opener` is the token of the marker that opened it
type Frame = { opener: number } & (
  | { kind: "toggle"; children: ContainerContent[] }
  | { kind: "column"; width: string | null; children: ContainerContent[] }
  | { kind: "tabs"; panels: TabPanel[] }
  | { kind: "columns"; columns: Column[] }
);

const frameFor = (container: "columns" | "tabs" | "toggle", opener: number): Frame => {
  switch (container) {
    case "columns": {
      return { columns: [], kind: "columns", opener };
    }
    case "tabs": {
      return { kind: "tabs", opener, panels: [] };
    }
    case "toggle": {
      return { children: [], kind: "toggle", opener };
    }
    // no default
  }
};

// where a frame's content goes: null where none may (tabs before their first panel, and between
// columns, where only a `:::column` may stand)
const sinkOf = (frame: Frame): ContainerContent[] | null => {
  switch (frame.kind) {
    case "toggle":
    case "column": {
      return frame.children;
    }
    case "tabs": {
      return frame.panels.at(-1)?.children ?? null;
    }
    case "columns": {
      return null;
    }
    // no default
  }
};

const built = (frame: Frame): ContainerContent | Column | null => {
  switch (frame.kind) {
    case "toggle": {
      return { children: frame.children, type: "toggle" };
    }
    case "column": {
      return { children: frame.children, type: "column", width: frame.width };
    }
    case "tabs": {
      return frame.panels.length === 0 ? null : { children: frame.panels, type: "tabGroup" };
    }
    case "columns": {
      return frame.columns.length === 0 ? null : { children: frame.columns, type: "columnGroup" };
    }
    // no default
  }
};

// `unreadable` names every opener a read from it would refuse at the same token, so none is read
// twice and a run of unclosed openers costs one pass, not one per opener
type Read =
  | { ok: true; node: ContainerContent; next: number }
  | { ok: false; unreadable: number[] };

// the containers open, innermost last, and the content lines read since the last marker
interface Reader {
  stack: Frame[];
  run: Run | null;
}

const refused = (reader: Reader, ...popped: Frame[]): Read => ({
  ok: false,
  unreadable: [...reader.stack, ...popped].map((frame) => frame.opener),
});

const sinkOfTop = (reader: Reader): ContainerContent[] | null => {
  const top = reader.stack.at(-1);
  return top === undefined ? null : sinkOf(top);
};

// false where the innermost container may hold no content
const flushed = (reader: Reader): boolean => {
  if (reader.run === null) {
    return true;
  }
  const sink = sinkOfTop(reader);
  if (sink === null) {
    return false;
  }
  sink.push(paragraphFrom(reader.run));
  reader.run = null;
  return true;
};

const readBlock = (reader: Reader, content: ContainerContent | null): boolean => {
  const sink = flushed(reader) ? sinkOfTop(reader) : null;
  if (sink === null || content === null) {
    return false;
  }
  sink.push(content);
  return true;
};

const readLine = (reader: Reader, token: LineToken): boolean => {
  if (reader.run?.paragraph === token.paragraph) {
    reader.run.lines.push(token.line);
    return true;
  }
  if (!flushed(reader)) {
    return false;
  }
  reader.run = runOf(token);
  return true;
};

// a marker means what the innermost container open lets it: a panel marker belongs to tabs alone,
// and elsewhere it is a line of text
const markerHere = (reader: Reader, token: LineToken): Marker | null => {
  const { marker } = token;
  return marker?.kind === "panel" && reader.stack.at(-1)?.kind !== "tabs" ? null : marker;
};

const opened = (
  reader: Reader,
  marker: Exclude<Marker, { kind: "close" }>,
  at: number,
): boolean => {
  const top = reader.stack.at(-1);
  switch (marker.kind) {
    case "open": {
      if (top?.kind === "columns") {
        return false;
      }
      reader.stack.push(frameFor(marker.container, at));
      return true;
    }
    case "column": {
      if (top?.kind !== "columns") {
        return false;
      }
      reader.stack.push({ children: [], kind: "column", opener: at, width: marker.width });
      return true;
    }
    case "panel": {
      if (top?.kind !== "tabs") {
        return false;
      }
      top.panels.push({ children: [], label: marker.label, type: "tabPanel" });
      return true;
    }
    // no default
  }
};

type Closed =
  | { kind: "inside" }
  | { kind: "outermost"; node: ContainerContent }
  | { kind: "refused"; popped: Frame[] };

const closed = (reader: Reader): Closed => {
  const frame = reader.stack.pop();
  if (frame === undefined) {
    return { kind: "refused", popped: [] };
  }
  const node = built(frame);
  if (node === null) {
    return { kind: "refused", popped: [frame] };
  }
  const parent = reader.stack.at(-1);
  if (node.type === "column") {
    if (parent?.kind !== "columns") {
      return { kind: "refused", popped: [] };
    }
    parent.columns.push(node);
    return { kind: "inside" };
  }
  if (parent === undefined) {
    return { kind: "outermost", node };
  }
  const sink = sinkOf(parent);
  if (sink === null) {
    return { kind: "refused", popped: [] };
  }
  sink.push(node);
  return { kind: "inside" };
};

// reads the container `start` opens through its closing `:::`
const readContainer = <T>(tokens: readonly Token<T>[], start: number): Read => {
  const reader: Reader = { run: null, stack: [] };
  for (let at = start; at < tokens.length; at += 1) {
    const token = tokens[at];
    if (token === undefined) {
      break;
    }
    if (token.kind === "block") {
      if (!readBlock(reader, token.content)) {
        return refused(reader);
      }
      continue;
    }
    const marker = markerHere(reader, token);
    if (marker === null) {
      if (!readLine(reader, token)) {
        return refused(reader);
      }
      continue;
    }
    if (!flushed(reader)) {
      return refused(reader);
    }
    if (marker.kind !== "close") {
      if (!opened(reader, marker, at)) {
        return refused(reader);
      }
      continue;
    }
    const close = closed(reader);
    if (close.kind === "refused") {
      return refused(reader, ...close.popped);
    }
    if (close.kind === "outermost") {
      return { next: at + 1, node: close.node, ok: true };
    }
  }
  return refused(reader);
};

const rewriteFlow = <T>(
  children: T[],
  asContent: (node: T) => ContainerContent | null,
  fromContent: (node: ContainerContent) => T,
): T[] => {
  const tokens = tokensOf(children, asContent);
  if (tokens.every((token) => token.kind === "block")) {
    return children;
  }
  const out: T[] = [];
  const unreadable = new Set<number>();
  let prose: Run | null = null;
  const flushProse = (): void => {
    if (prose !== null) {
      out.push(fromContent(paragraphFrom(prose)));
      prose = null;
    }
  };
  for (let at = 0; at < tokens.length;) {
    const token = tokens[at];
    if (token === undefined) {
      break;
    }
    if (token.kind === "block") {
      flushProse();
      out.push(token.node);
      at += 1;
      continue;
    }
    if (token.marker?.kind === "open" && !unreadable.has(at)) {
      const read = readContainer(tokens, at);
      if (read.ok) {
        flushProse();
        out.push(fromContent(read.node));
        at = read.next;
        continue;
      }
      for (const opener of read.unreadable) {
        unreadable.add(opener);
      }
    }
    if (prose?.paragraph === token.paragraph) {
      prose.lines.push(token.line);
    } else {
      flushProse();
      prose = runOf(token);
    }
    at += 1;
  }
  flushProse();
  return out;
};

// RootContent names every node, phrasing and the children only a container holds included; flow
// content is what a root holds after its frontmatter
const FLOW_TYPES: ReadonlySet<string> = new Set<ContainerContent["type"]>([
  "blockquote",
  "code",
  "columnGroup",
  "definition",
  "footnoteDefinition",
  "heading",
  "html",
  "list",
  "math",
  "paragraph",
  "table",
  "tabGroup",
  "thematicBreak",
  "toggle",
]);

export const isContainerContent = (node: Node): node is ContainerContent =>
  FLOW_TYPES.has(node.type);

const identity = (node: ContainerContent): ContainerContent => node;

const rewriteTree = (node: Root | RootContent): void => {
  if (!("children" in node)) {
    return;
  }
  for (const child of node.children) {
    rewriteTree(child);
  }
  if (node.type === "root") {
    node.children = rewriteFlow<RootContent>(
      node.children,
      (child) => (isContainerContent(child) ? child : null),
      identity,
    );
  } else if (
    node.type === "blockquote" ||
    node.type === "footnoteDefinition" ||
    node.type === "listItem"
  ) {
    node.children = rewriteFlow(node.children, identity, identity);
  }
};

// a marker line runs on into the paragraph one of these leaves open, so a blank line ends it first
const ABSORBS_NEXT_LINE: ReadonlySet<string> = new Set([
  "blockquote",
  "footnoteDefinition",
  "list",
  "table",
]);

const blankBeforeMarker = (last: ContainerContent | undefined): string =>
  last !== undefined && ABSORBS_NEXT_LINE.has(last.type) ? "\n" : "";

const emptyFirstItem = (list: List): boolean => {
  const [item] = list.children;
  const [head] = item?.children ?? [];
  return head === undefined || (head.type === "paragraph" && head.children.length === 0);
};

// a block that cannot interrupt a paragraph would be read as more of the marker line's text, and
// a `---` rule under it as the setext underline that makes the marker a heading
const blankAfterMarker = (first: ContainerContent | undefined): string => {
  if (first?.type === "definition" || first?.type === "thematicBreak") {
    return "\n";
  }
  if (first?.type === "list") {
    const renumbered = first.ordered === true && (first.start ?? 1) !== 1;
    return renumbered || emptyFirstItem(first) ? "\n" : "";
  }
  return "";
};

// the marker, the body and the closing `:::`, which a body ending in a block that absorbs a line
// keeps a blank line away from
const fenced = (marker: string, body: Toggle | Column, state: State, info: Info): string => {
  const inner = state.containerFlow(body, info);
  if (inner === "") {
    return `${marker}\n${CLOSE_LINE}`;
  }
  return `${marker}\n${blankAfterMarker(body.children[0])}${inner}\n${blankBeforeMarker(body.children.at(-1))}${CLOSE_LINE}`;
};

const panelToMarkdown = (panel: TabPanel, state: State, info: Info): string => {
  const inner = state.containerFlow(panel, info);
  const marker = `=== ${panel.label}`;
  return inner === "" ? marker : `${marker}\n${blankAfterMarker(panel.children[0])}${inner}`;
};

// a line of text the next parse would read as a marker, after the `:` its escape goes before
const MARKER_LINE_TAIL = String.raw`::(?:toggle|tabs|columns|column(?: ${WIDTH})?)?(?=\r?\n|$)`;

const containersToMarkdown: ToMarkdownExtension = {
  handlers: {
    columnGroup: (node: ColumnGroup, _parent: Parents | undefined, state: State, info: Info) => {
      const columns = node.children.map((column) =>
        fenced(
          column.width === null ? COLUMN_LINE : `${COLUMN_LINE} ${column.width}`,
          column,
          state,
          info,
        ),
      );
      return [COLUMNS_LINE, columns.join("\n\n"), CLOSE_LINE].join("\n");
    },
    tabGroup: (node: TabGroup, _parent: Parents | undefined, state: State, info: Info) => {
      const panels = node.children.map((panel) => panelToMarkdown(panel, state, info));
      const last = node.children.at(-1)?.children.at(-1);
      return `${TABS_LINE}\n${panels.join("\n\n")}\n${blankBeforeMarker(last)}${CLOSE_LINE}`;
    },
    toggle: (node: Toggle, _parent: Parents | undefined, state: State, info: Info) =>
      fenced(TOGGLE_LINE, node, state, info),
  },
  // a `=== Label` line needs none of its own: stock markdown already escapes a `=` opening a line
  unsafe: [{ after: MARKER_LINE_TAIL, atBreak: true, character: ":", inConstruct: "phrasing" }],
};

// a function expression: remark plugins receive the processor as `this`.
export const remarkContainers: Plugin = function remarkContainers(this: Processor): Transformer {
  const data = this.data();
  (data.toMarkdownExtensions ??= []).push(containersToMarkdown);
  return (tree) => {
    if (isMdastRoot(tree)) {
      rewriteTree(tree);
    }
  };
};
