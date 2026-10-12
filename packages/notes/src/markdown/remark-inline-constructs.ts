// an mdast transform rather than a micromark tokenizer: no construct here nests, spans line breaks
// or interacts with delimiter runs, so splitting finished text leaves is equivalent and cannot
// disturb how micromark reads everything else. A construct whose first character an escape wrote
// is text, and the serializer writes that escape before a text the next parse would read as one.
// must run before remark-opaque.

import type { Node, Parent, Parents, PhrasingContent, Text } from "mdast";
import type {
  ConstructName,
  Options as ToMarkdownExtension,
  State,
  Unsafe,
} from "mdast-util-to-markdown";
import type { Plugin, Processor, Transformer } from "unified";

import { COMMENT_ID_PATTERN } from "../comments/sidecar-schema";
import { ISO_DATE_PATTERN } from "../iso-date";
import { isMdastRoot } from "./mdast-nodes";
import { escapedAt, textCutter } from "./text-escapes";

export interface FormulaPill extends Node {
  type: "formulaPill";
  raw: string;
  source: string;
  display: string;
  meta?: string;
}

export interface CommentMarker extends Node {
  type: "commentMarker";
  ids: string;
  edge: "start" | "end";
}

// `@2026-08-22`: the chip's own spelling, `value` a calendar date
export interface DateChip extends Node {
  type: "date";
  value: string;
}

declare module "mdast" {
  interface PhrasingContentMap {
    commentMarker: CommentMarker;
    date: DateChip;
    formulaPill: FormulaPill;
  }
  interface RootContentMap {
    commentMarker: CommentMarker;
    date: DateChip;
    formulaPill: FormulaPill;
  }
}

// each construct after its first character, the one an escape keeps it text by
const FORMULA_TAIL = String.raw`\{[^|{}\n]+(?:\|[^|{}\n]*)?(?:\|[^{}\n]*)?\}\}`;
const MARKER_TAIL = `%i:(?<ids>${COMMENT_ID_PATTERN}(?:,${COMMENT_ID_PATTERN})*):(?<edge>start|end)%%`;
// a chip reads back wherever the editor can put one, a word's edge included, so nothing bounds it
// but a digit that would make its day a longer number
const DATE_TAIL = String.raw`(?<value>${ISO_DATE_PATTERN})(?!\d)`;

const FORMULA_RE = new RegExp(String.raw`\{${FORMULA_TAIL}`, "gu");
const MARKER_RE = new RegExp(`%${MARKER_TAIL}`, "gu");

// a date chip as written, `value` its day. Shared and global, like COMMENT_MARKER_STRIP_RE below:
// hand it to replace, replaceAll, match or matchAll only.
export const DATE_CHIP_RE = new RegExp(`@${DATE_TAIL}`, "gu");

// Looser than MARKER_RE on purpose, so a half-typed or malformed marker still leaves a preview or
// a snippet. Shared and global: hand it to replace, replaceAll, match or matchAll only, never to
// test or exec, whose lastIndex would carry from one caller into the next.
export const COMMENT_MARKER_STRIP_RE = /%%i:[^%]*%%/gu;

// A marker's `ids` stays the joined spelling so the serializer re-emits its bytes; this is the
// one place the list is read.
export const splitMarkerIds = (ids: string): string[] => ids.split(",").filter((id) => id !== "");

export const parseFormulaRaw = (raw: string): Pick<FormulaPill, "source" | "display" | "meta"> => {
  const first = raw.indexOf("|");
  if (first === -1) {
    return { display: "", source: raw };
  }
  const second = raw.indexOf("|", first + 1);
  if (second === -1) {
    return { display: raw.slice(first + 1), source: raw.slice(0, first) };
  }
  return {
    display: raw.slice(first + 1, second),
    meta: raw.slice(second + 1),
    source: raw.slice(0, first),
  };
};

interface Splice {
  index: number;
  length: number;
  node: PhrasingContent;
}

const splitTextNode = (node: Text, inLink: boolean): PhrasingContent[] | null => {
  const splices: Splice[] = [];
  for (const match of node.value.matchAll(FORMULA_RE)) {
    if (escapedAt(node, match.index)) {
      continue;
    }
    const raw = match[0].slice(2, -2);
    splices.push({
      index: match.index,
      length: match[0].length,
      node: { raw, type: "formulaPill", ...parseFormulaRaw(raw) },
    });
  }
  for (const match of node.value.matchAll(MARKER_RE)) {
    const { groups } = match;
    if (groups === undefined || escapedAt(node, match.index)) {
      continue;
    }
    const { edge, ids } = groups;
    if ((edge === "start" || edge === "end") && ids !== undefined) {
      splices.push({
        index: match.index,
        length: match[0].length,
        node: { edge, ids, type: "commentMarker" },
      });
    }
  }
  // inside a link a chip would part a url its text spells from the url it links to
  if (!inLink) {
    for (const match of node.value.matchAll(DATE_CHIP_RE)) {
      const value = match.groups?.value;
      if (value !== undefined && !escapedAt(node, match.index)) {
        splices.push({
          index: match.index,
          length: match[0].length,
          node: { type: "date", value },
        });
      }
    }
  }
  if (splices.length === 0) {
    return null;
  }
  splices.sort((a, b) => a.index - b.index);
  const cut = textCutter(node);
  const out: PhrasingContent[] = [];
  let cursor = 0;
  for (const splice of splices) {
    // overlapping match (formula inside marker text) — first wins
    if (splice.index < cursor) {
      continue;
    }
    if (splice.index > cursor) {
      out.push(cut(cursor, splice.index));
    }
    out.push(splice.node);
    cursor = splice.index + splice.length;
  }
  if (cursor < node.value.length) {
    out.push(cut(cursor, node.value.length));
  }
  return out;
};

const LINK_LIKE: ReadonlySet<string> = new Set(["link", "linkReference"]);

const walk = (parent: Parent, inLink: boolean): void => {
  for (let index = parent.children.length - 1; index >= 0; index -= 1) {
    const child = parent.children[index];
    if (child === undefined) {
      continue;
    }
    if ("children" in child) {
      walk(child, inLink || LINK_LIKE.has(child.type));
      continue;
    }
    if (child.type !== "text") {
      continue;
    }
    const replaced = splitTextNode(child, inLink);
    if (replaced !== null) {
      parent.children.splice(index, 1, ...replaced);
    }
  }
};

// where text is not prose the next parse splits: a url, a title, an image's alt
const NOT_PROSE: ConstructName[] = [
  "autolink",
  "destinationLiteral",
  "destinationRaw",
  "image",
  "imageReference",
  "reference",
  "titleApostrophe",
  "titleQuote",
];

const UNSAFE: Unsafe[] = [
  { after: FORMULA_TAIL, character: "{", inConstruct: "phrasing", notInConstruct: NOT_PROSE },
  { after: MARKER_TAIL, character: "%", inConstruct: "phrasing", notInConstruct: NOT_PROSE },
  {
    after: DATE_TAIL,
    character: "@",
    inConstruct: "phrasing",
    notInConstruct: [...NOT_PROSE, "link", "linkReference"],
  },
];

const inlineConstructsToMarkdown: ToMarkdownExtension = {
  handlers: {
    commentMarker: Object.assign((node: CommentMarker) => `%%i:${node.ids}:${node.edge}%%`, {
      peek: () => "%",
    }),
    date: Object.assign((node: DateChip) => `@${node.value}`, { peek: () => "@" }),
    // inside a gfm table cell the pill's pipes must leave as `\|` or the next parse reads them
    // as cell delimiters; gfm-table's fromMarkdown unescapes them before this transform sees text.
    formulaPill: Object.assign(
      (node: FormulaPill, _parent: Parents | undefined, state: State) => {
        const raw = `{{${node.raw}}}`;
        return state.stack.includes("tableCell") ? raw.replaceAll("|", "\\|") : raw;
      },
      { peek: () => "{" },
    ),
  },
  unsafe: UNSAFE,
};

// a function expression: remark plugins receive the processor as `this`.
export const remarkInlineConstructs: Plugin = function remarkInlineConstructs(
  this: Processor,
): Transformer {
  const data = this.data();
  (data.toMarkdownExtensions ??= []).push(inlineConstructsToMarkdown);
  return (tree) => {
    if (isMdastRoot(tree)) {
      walk(tree, false);
    }
  };
};
