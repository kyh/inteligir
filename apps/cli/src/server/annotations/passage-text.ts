// The text a person reads in an item, and where each of its characters sits in the file's bytes:
// the space a highlight's quote is matched in (place-quotes.ts) and the live passage between an
// annotation's markers. It reads the dialect's bare parse, where every node keeps its offsets, and
// splits the inline constructs out of text itself, as the editor's transform does
// (`@repo/notes/markdown/remark-inline-constructs`): a marker is zero-width, a pill or a date chip
// is one atomic unit. A text node whose value its source spells (plain, escaped, or across a
// quote's or a list's line prefixes) maps character by character; any other inline (a link, a
// strong or emphasis run, inline code, an html tag, a wiki link) is atomic: an edge inside it
// widens to its edge. Code, math and frontmatter are not text.

import { ANNOTATION_ID_PATTERN } from "@repo/notes/annotations/store-schema";
import { MD_PROCESSOR } from "@repo/notes/markdown/md-plugins";
import {
  DATE_CHIP_RE,
  parseFormulaRaw,
  splitMarkerIds,
} from "@repo/notes/markdown/remark-inline-constructs";

// the dialect's tree as this walk reads it: the parse's mdast, structurally
interface MdPoint {
  offset?: number | undefined;
}
interface MdNode {
  type: string;
  position?: { start: MdPoint; end: MdPoint } | undefined;
  children?: readonly MdNode[];
  value?: string;
  body?: string;
  depth?: number;
  data?: { escapes?: readonly number[] } | undefined;
}

// the dialect's own spellings, matched in a text's value as its transform matches them
const MARKER_RE = new RegExp(
  `%%i:(?<ids>${ANNOTATION_ID_PATTERN}(?:,${ANNOTATION_ID_PATTERN})*):(?<edge>start|end)%%`,
  "gu",
);
// a pill, `{{source|display|meta}}`: FORMULA_TAIL in remark-inline-constructs
const FORMULA_RE = /\{\{[^|{}\n]+(?:\|[^|{}\n]*)?(?:\|[^{}\n]*)?\}\}/gu;
// a `:::` container line or a tab's `=== Label`: line grammar the transform lifts out of text
const STRUCTURE_LINE_RE = /^(?::::(?:toggle|tabs|columns|column(?: \d+(?:\.\d+)?%)?)?|=== .*)\r?$/u;
// a character reference, which spells one character in several
const CHARACTER_REFERENCE_RE = /^&(?:#\d{1,7}|#[xX][\da-fA-F]{1,6}|[A-Za-z][A-Za-z\d]{0,31});/u;
// a GitHub alert's marker leading a quote: the editor draws it as the alert's badge, never as text
// (`packages/editor/src/markdown/alert-marker.ts`, ALERT_LEAD_RE)
const ALERT_LEAD_RE = /^\s*\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s?/iu;
const ASCII_PUNCTUATION = /^[!-/:-@[-`{-~]$/u;
// the bytes that may open a line inside a quote or a list, before its text
const LINE_PREFIX_CHARACTERS = new Set([" ", "\t", ">"]);
// emphasis and strikethrough delimiters: a marker beside a literal one could pair it
const DELIMITERS = new Set(["*", "_", "~"]);

// blocks whose children are the text a person reads
const PHRASING_BLOCKS = new Set(["paragraph", "heading", "tableCell"]);
// flow that holds no reading text
const SKIPPED_FLOW = new Set(["code", "math", "yaml", "html", "definition", "thematicBreak"]);
// inlines that contribute nothing to the text: an embed, a footnote's number, a tag
const SILENT_INLINES = new Set([
  "image",
  "imageReference",
  "wikiEmbed",
  "footnoteReference",
  "html",
  "definition",
]);

export interface MarkerSpan {
  // indexes into the projection's text: the first start marker, the last end marker
  start: number | null;
  end: number | null;
}

export interface PassageProjection {
  source: string;
  // the folded text: a whitespace run is one space and blocks are a space apart
  text: string;
  // per character of `text`: where a start marker before it goes, and an end marker after it; -1
  // for the space between two blocks
  from: readonly number[];
  to: readonly number[];
  // per character: its block's ordinal, -1 for the space between two blocks
  block: readonly number[];
  markers: ReadonlyMap<string, MarkerSpan>;
  // source offsets of literal `*`, `_` and `~`
  delimiters: ReadonlySet<number>;
  // a bare url's bytes, and the inclusive range right after one where a marker would read as part
  // of it
  bareUrls: readonly { start: number; end: number }[];
  urlTails: readonly { start: number; end: number }[];
  // the last section at depth 1 or 2 is a `## Highlights` heading
  endsInHighlights: boolean;
  // every marker's bytes, in document order
  markerSpans: readonly MarkerBytes[];
}

export interface MarkerBytes {
  start: number;
  end: number;
  ids: string;
  edge: "start" | "end";
}

type Segment =
  | { kind: "text"; start: number; end: number }
  | { kind: "marker"; start: number; end: number; ids: string; edge: "start" | "end" }
  | { kind: "unit"; start: number; end: number; text: string };

interface Found {
  start: number;
  end: number;
  segment: Segment;
}

// the constructs of one text's value in order; an escaped first character keeps one text, and an
// overlapping match loses to the earlier one, as the transform decides
const segmentsOf = (value: string, escapes: ReadonlySet<number>, inLink: boolean): Segment[] => {
  const found: Found[] = [];
  for (const match of value.matchAll(FORMULA_RE)) {
    if (!escapes.has(match.index)) {
      const end = match.index + match[0].length;
      const text = parseFormulaRaw(match[0].slice(2, -2)).display;
      found.push({
        end,
        segment: { end, kind: "unit", start: match.index, text },
        start: match.index,
      });
    }
  }
  for (const match of value.matchAll(MARKER_RE)) {
    const ids = match.groups?.ids;
    const edge = match.groups?.edge;
    if (ids !== undefined && (edge === "start" || edge === "end") && !escapes.has(match.index)) {
      const end = match.index + match[0].length;
      found.push({
        end,
        segment: { edge, end, ids, kind: "marker", start: match.index },
        start: match.index,
      });
    }
  }
  if (!inLink) {
    for (const match of value.matchAll(DATE_CHIP_RE)) {
      const day = match.groups?.value;
      if (day !== undefined && !escapes.has(match.index)) {
        const end = match.index + match[0].length;
        found.push({
          end,
          segment: { end, kind: "unit", start: match.index, text: day },
          start: match.index,
        });
      }
    }
  }
  found.sort((a, b) => a.start - b.start);
  const segments: Segment[] = [];
  let cursor = 0;
  for (const { start, end, segment } of found) {
    if (start < cursor) {
      continue;
    }
    if (start > cursor) {
      segments.push({ end: start, kind: "text", start: cursor });
    }
    segments.push(segment);
    cursor = end;
  }
  if (cursor < value.length) {
    segments.push({ end: value.length, kind: "text", start: cursor });
  }
  return segments;
};

interface Aligned {
  from: number[];
  to: number[];
}

// how one step of the alignment reads the source: `units` characters of the value spelled by
// `bytes` bytes, or `bytes` of a line prefix that spell nothing
interface Step {
  units: number;
  bytes: number;
}

const stepAt = (
  value: string,
  index: number,
  source: string,
  at: number,
  end: number,
): Step | null => {
  const character = value[index];
  const byte = source[at];
  const reference =
    byte === "&" ? CHARACTER_REFERENCE_RE.exec(source.slice(at, Math.min(end, at + 40))) : null;
  if (reference !== null && !value.startsWith(reference[0], index)) {
    return { bytes: reference[0].length, units: (value.codePointAt(index) ?? 0) > 0xff_ff ? 2 : 1 };
  }
  // a backslash before ascii punctuation is always its escape, a backslash included
  if (
    byte === "\\" &&
    at + 1 < end &&
    source[at + 1] === character &&
    ASCII_PUNCTUATION.test(character ?? "")
  ) {
    return { bytes: 2, units: 1 };
  }
  if (character === byte) {
    return { bytes: 1, units: 1 };
  }
  const afterBreak = index > 0 && value[index - 1] === "\n";
  return afterBreak && LINE_PREFIX_CHARACTERS.has(byte ?? "") ? { bytes: 1, units: 0 } : null;
};

// each character of a text's value against the source bytes that spell it: itself, a backslash
// escape, a character reference, with a quote's or a list's line prefix skipped after a line
// break; null when the bytes spell it some other way. `whole`: the value spells all of
// [start, end), but for trailing whitespace
const alignText = (
  value: string,
  source: string,
  span: { start: number; end: number; whole: boolean },
): Aligned | null => {
  const { start, end } = span;
  const from: number[] = [];
  const to: number[] = [];
  let at = start;
  let index = 0;
  while (index < value.length) {
    const step = at < end ? stepAt(value, index, source, at, end) : null;
    if (step === null) {
      return null;
    }
    for (let unit = 0; unit < step.units; unit += 1) {
      from.push(at);
      to.push(at + step.bytes);
    }
    index += step.units;
    at += step.bytes;
  }
  return !span.whole || source.slice(at, end).trim() === "" ? { from, to } : null;
};

const offsetsOf = (node: MdNode, shift: number): { start: number; end: number } | null => {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  return start === undefined || end === undefined
    ? null
    : { end: end + shift, start: start + shift };
};

// a bare url: a link whose bytes are the url itself, never `[text](url)` or `<url>`; the dialect
// reads one out of text however its characters were escaped
const isBareUrl = (source: string, start: number): boolean =>
  source[start] !== "[" && source[start] !== "<";

const isLineStart = (source: string, offset: number): boolean => {
  let at = offset - 1;
  while (at >= 0 && LINE_PREFIX_CHARACTERS.has(source[at] ?? "")) {
    at -= 1;
  }
  return at < 0 || source[at] === "\n";
};

// the wiki link's display: its alias, else its target
const wikiText = (body: string): string => {
  const bar = body.indexOf("|");
  return bar === -1 ? body : body.slice(bar + 1);
};

// micromark drops a leading byte-order mark before it counts
const BYTE_ORDER_MARK = String.fromCodePoint(0xfe_ff);

interface Builder {
  source: string;
  shift: number;
  markerSpans: MarkerBytes[];
  characters: string[];
  from: number[];
  to: number[];
  block: number[];
  markers: Map<string, MarkerSpan>;
  delimiters: Set<number>;
  bareUrls: { start: number; end: number }[];
  urlTails: { start: number; end: number }[];
  blockIndex: number;
  // a text whose first characters are a quote's alert marker, and how many
  leads: Map<MdNode, number>;
}

// the serializer's placeholder in an empty task, which nobody reads
const ZERO_WIDTH_SPACE = "\u200B";

const push = (builder: Builder, character: string, start: number, end: number): void => {
  if (character === ZERO_WIDTH_SPACE) {
    return;
  }
  const space = /\s/u.test(character);
  if (space && (builder.characters.length === 0 || builder.characters.at(-1) === " ")) {
    return;
  }
  builder.characters.push(space ? " " : character);
  builder.from.push(start);
  builder.to.push(end);
  builder.block.push(builder.blockIndex);
};

const separate = (builder: Builder): void => {
  if (builder.characters.length > 0 && builder.characters.at(-1) !== " ") {
    builder.characters.push(" ");
    builder.from.push(-1);
    builder.to.push(-1);
    builder.block.push(-1);
  }
};

const mark = (builder: Builder, ids: string, edge: "start" | "end"): void => {
  for (const id of splitMarkerIds(ids)) {
    const span = builder.markers.get(id) ?? { end: null, start: null };
    if (edge === "start" && span.start === null) {
      span.start = builder.characters.length;
    }
    if (edge === "end") {
      span.end = builder.characters.length;
    }
    builder.markers.set(id, span);
  }
};

// what a leaf inline shows; null for an inline whose children show it
const leafText = (node: MdNode): string | null => {
  switch (node.type) {
    case "break": {
      return " ";
    }
    case "inlineCode":
    case "inlineMath": {
      return node.value ?? "";
    }
    case "wikiLink": {
      return wikiText(node.body ?? "");
    }
    default: {
      return SILENT_INLINES.has(node.type) ? "" : null;
    }
  }
};

// a text node's markers as its bytes spell them; a marker after an odd run of backslashes is text
const noteMarkerBytes = (builder: Builder, bounds: { start: number; end: number }): void => {
  const { source } = builder;
  for (const match of source.slice(bounds.start, bounds.end).matchAll(MARKER_RE)) {
    const start = bounds.start + match.index;
    const ids = match.groups?.ids;
    const edge = match.groups?.edge;
    let slashes = 0;
    while (source[start - 1 - slashes] === "\\") {
      slashes += 1;
    }
    if (ids !== undefined && (edge === "start" || edge === "end") && slashes % 2 === 0) {
      builder.markerSpans.push({ edge, end: start + match[0].length, ids, start });
    }
  }
};

// a bare url's tail: up to the first space or `<`, every offset where a marker would join the url
const noteBareUrl = (builder: Builder, bounds: { start: number; end: number }): void => {
  const { source } = builder;
  if (!isBareUrl(source, bounds.start)) {
    return;
  }
  builder.bareUrls.push(bounds);
  let { end } = bounds;
  while (end < source.length && !/[\s<]/u.test(source[end] ?? "")) {
    end += 1;
  }
  builder.urlTails.push({ end, start: bounds.end });
};

// a node read as one unit: every character it shows spans the node's bytes
const pushAtomic = (
  builder: Builder,
  node: MdNode,
  bounds: { start: number; end: number },
  inLink: boolean,
): void => {
  if (node.type === "text") {
    const own = offsetsOf(node, builder.shift);
    if (own !== null) {
      noteMarkerBytes(builder, own);
    }
    const value = node.value ?? "";
    for (const segment of segmentsOf(value, new Set(node.data?.escapes), inLink)) {
      if (segment.kind === "marker") {
        mark(builder, segment.ids, segment.edge);
        continue;
      }
      const text = segment.kind === "unit" ? segment.text : value.slice(segment.start, segment.end);
      for (const character of text) {
        push(builder, character, bounds.start, bounds.end);
      }
    }
    return;
  }
  const leaf = leafText(node);
  if (leaf !== null) {
    for (const character of leaf) {
      push(builder, character, bounds.start, bounds.end);
    }
    return;
  }
  if (node.type === "link") {
    noteBareUrl(builder, offsetsOf(node, builder.shift) ?? bounds);
  }
  const linked = inLink || node.type === "link" || node.type === "linkReference";
  for (const child of node.children ?? []) {
    pushAtomic(builder, child, bounds, linked);
  }
};

// the value indexes of a `:::` or `=== Label` line at a line's start, newline included, and of a
// quote's alert marker: the container's grammar, never its text
const structuralIndexes = (
  value: string,
  source: string,
  start: number,
  lead: number,
): Set<number> => {
  const structural = new Set<number>();
  for (let index = 0; index < lead; index += 1) {
    structural.add(index);
  }
  let lineStart = 0;
  for (const line of value.split("\n")) {
    const atLineStart = lineStart > 0 || isLineStart(source, start);
    if (atLineStart && STRUCTURE_LINE_RE.test(line)) {
      for (let index = lineStart; index <= lineStart + line.length; index += 1) {
        structural.add(index);
      }
    }
    lineStart += line.length + 1;
  }
  return structural;
};

// a text's value with the bytes that spell each of its characters
interface TextContext {
  value: string;
  aligned: Aligned;
  escapes: ReadonlySet<number>;
  structural: ReadonlySet<number>;
}

const pushTextRun = (builder: Builder, text: TextContext, start: number, end: number): void => {
  let inStructure = false;
  for (let index = start; index < end; index += 1) {
    if (text.structural.has(index)) {
      if (!inStructure) {
        separate(builder);
        builder.blockIndex += 1;
        inStructure = true;
      }
      continue;
    }
    inStructure = false;
    const character = text.value[index] ?? "";
    const from = text.aligned.from[index] ?? -1;
    if (DELIMITERS.has(character) && !text.escapes.has(index)) {
      builder.delimiters.add(from);
    }
    push(builder, character, from, text.aligned.to[index] ?? -1);
  }
};

const pushAligned = (builder: Builder, text: TextContext): void => {
  const [first] = text.aligned.from;
  const last = text.aligned.to.at(-1);
  if (first !== undefined && last !== undefined) {
    noteMarkerBytes(builder, { end: last, start: first });
  }
  for (const segment of segmentsOf(text.value, text.escapes, false)) {
    if (segment.kind === "marker") {
      mark(builder, segment.ids, segment.edge);
    } else if (segment.kind === "unit") {
      const start = text.aligned.from[segment.start] ?? -1;
      const end = text.aligned.to[segment.end - 1] ?? -1;
      for (const character of segment.text) {
        push(builder, character, start, end);
      }
    } else {
      pushTextRun(builder, text, segment.start, segment.end);
    }
  }
};

const textContext = (
  builder: Builder,
  node: MdNode,
  aligned: Aligned,
  start: number,
): TextContext => {
  const value = node.value ?? "";
  return {
    aligned,
    escapes: new Set(node.data?.escapes),
    structural: structuralIndexes(value, builder.source, start, builder.leads.get(node) ?? 0),
    value,
  };
};

const pushText = (builder: Builder, node: MdNode, bounds: { start: number; end: number }): void => {
  const { source } = builder;
  const aligned = alignText(node.value ?? "", source, { ...bounds, whole: true });
  if (aligned === null) {
    for (const offset of [bounds.start, bounds.end - 1]) {
      if (DELIMITERS.has(source[offset] ?? "")) {
        builder.delimiters.add(offset);
      }
    }
    pushAtomic(builder, node, bounds, false);
    return;
  }
  pushAligned(builder, textContext(builder, node, aligned, bounds.start));
};

// what a node the parse made with no offsets reads as: a text's value, or a bare url's
const runText = (node: MdNode): string | null => {
  if (node.type === "text") {
    return node.value ?? "";
  }
  const children = node.children ?? [];
  return node.type === "link" && children.every((child) => child.type === "text")
    ? children.map((child) => child.value ?? "").join("")
    : null;
};

// the furthest a run's bytes are searched for past where the run may start
const RUN_SEARCH_LIMIT = 64;

// nodes the parse made after it counted (a bare url read out of an escaped or tightly packed text)
// carry no offsets; together they spell what one text once did, so that value is found in the
// bytes between their neighbours and shared out among them. A run found nowhere shows nothing
const pushUnplaced = (
  builder: Builder,
  run: readonly MdNode[],
  span: { start: number; end: number },
): void => {
  const texts = run.map(runText);
  if (texts.includes(null)) {
    return;
  }
  const value = texts.join("");
  const { start: earliest, end } = span;
  const limit = Math.min(end, earliest + RUN_SEARCH_LIMIT);
  for (let start = earliest; start < limit; start += 1) {
    const aligned = alignText(value, builder.source, { end, start, whole: false });
    if (aligned === null) {
      continue;
    }
    let offset = 0;
    for (const [index, node] of run.entries()) {
      const { length } = texts[index] ?? "";
      const part: Aligned = {
        from: aligned.from.slice(offset, offset + length),
        to: aligned.to.slice(offset, offset + length),
      };
      offset += length;
      const bounds = { end: part.to.at(-1) ?? start, start: part.from[0] ?? start };
      if (node.type === "text") {
        pushAligned(builder, textContext(builder, node, part, bounds.start));
      } else {
        pushAtomic(builder, node, bounds, false);
      }
    }
    return;
  }
};

const walkPhrasing = (
  builder: Builder,
  children: readonly MdNode[],
  parent: { start: number; end: number },
): void => {
  let run: MdNode[] = [];
  let runStart = parent.start;
  for (const child of children) {
    const bounds = offsetsOf(child, builder.shift);
    if (bounds === null) {
      run.push(child);
      continue;
    }
    if (run.length > 0) {
      pushUnplaced(builder, run, { end: bounds.start, start: runStart });
      run = [];
    }
    runStart = bounds.end;
    if (child.type === "text") {
      pushText(builder, child, bounds);
    } else {
      pushAtomic(builder, child, bounds, false);
    }
  }
  if (run.length > 0) {
    pushUnplaced(builder, run, { end: parent.end, start: runStart });
  }
};

const noteAlertLead = (builder: Builder, quote: MdNode): void => {
  const [paragraph] = quote.children ?? [];
  const [text] = paragraph?.type === "paragraph" ? (paragraph.children ?? []) : [];
  const lead = text?.type === "text" ? ALERT_LEAD_RE.exec(text.value ?? "") : null;
  if (text !== undefined && lead !== null) {
    builder.leads.set(text, lead[0].length);
  }
};

export const projectPassages = (source: string): PassageProjection => {
  const shift = source.startsWith(BYTE_ORDER_MARK) ? 1 : 0;
  const tree: MdNode = MD_PROCESSOR.parse(source);
  const builder: Builder = {
    bareUrls: [],
    block: [],
    blockIndex: -1,
    characters: [],
    delimiters: new Set(),
    from: [],
    leads: new Map(),
    markerSpans: [],
    markers: new Map(),
    shift,
    source,
    to: [],
    urlTails: [],
  };
  // the root's headings at depth 1 or 2, in order
  const sections: { depth: number; text: string }[] = [];
  const walkFlow = (node: MdNode, atRoot: boolean): void => {
    if (SKIPPED_FLOW.has(node.type)) {
      return;
    }
    if (PHRASING_BLOCKS.has(node.type)) {
      builder.blockIndex += 1;
      separate(builder);
      const first = builder.characters.length;
      const bounds = offsetsOf(node, shift);
      if (bounds !== null) {
        walkPhrasing(builder, node.children ?? [], bounds);
      }
      if (atRoot && node.type === "heading" && (node.depth ?? 0) <= 2) {
        const heading = builder.characters.slice(first).join("").trim();
        sections.push({ depth: node.depth ?? 0, text: heading });
      }
      separate(builder);
      return;
    }
    if (node.type === "blockquote") {
      noteAlertLead(builder, node);
    }
    for (const child of node.children ?? []) {
      walkFlow(child, node.type === "root");
    }
  };
  walkFlow(tree, false);

  const section = sections.at(-1);
  return {
    bareUrls: builder.bareUrls,
    block: builder.block,
    delimiters: builder.delimiters,
    endsInHighlights: section !== undefined && section.depth === 2 && section.text === "Highlights",
    from: builder.from,
    markerSpans: builder.markerSpans.toSorted((a, b) => a.start - b.start),
    markers: builder.markers,
    source,
    text: builder.characters.join(""),
    to: builder.to,
    urlTails: builder.urlTails,
  };
};

// the live text between each id's markers, as a person reads it
export const annotationPassages = (source: string): Map<string, string> => {
  const projection = projectPassages(source);
  const passages = new Map<string, string>();
  for (const [id, { start, end }] of projection.markers) {
    if (start !== null && end !== null && start <= end) {
      passages.set(id, projection.text.slice(start, end).trim());
    }
  }
  return passages;
};
