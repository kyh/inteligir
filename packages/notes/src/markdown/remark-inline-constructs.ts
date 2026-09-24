// an mdast transform rather than a micromark tokenizer: neither construct nests, spans line
// breaks or interacts with delimiter runs, so splitting finished text leaves is equivalent and
// cannot disturb how micromark reads everything else. must run before remark-opaque.

import type { Node, Parent, Parents, PhrasingContent, Text } from "mdast";
import type { Options as ToMarkdownExtension, State } from "mdast-util-to-markdown";
import type { Plugin, Processor, Transformer } from "unified";

import { COMMENT_ID_PATTERN } from "../comments/sidecar-schema";
import { isMdastRoot } from "./mdast-nodes";

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

declare module "mdast" {
  interface PhrasingContentMap {
    commentMarker: CommentMarker;
    formulaPill: FormulaPill;
  }
  interface RootContentMap {
    commentMarker: CommentMarker;
    formulaPill: FormulaPill;
  }
}

const FORMULA_RE = /\{\{[^|{}\n]+(?:\|[^|{}\n]*)?(?:\|[^{}\n]*)?\}\}/gu;
const MARKER_RE = new RegExp(
  `%%i:(?<ids>${COMMENT_ID_PATTERN}(?:,${COMMENT_ID_PATTERN})*):(?<edge>start|end)%%`,
  "gu",
);

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

const splitTextNode = (node: Text): PhrasingContent[] | null => {
  const splices: Splice[] = [];
  for (const match of node.value.matchAll(FORMULA_RE)) {
    const raw = match[0].slice(2, -2);
    splices.push({
      index: match.index,
      length: match[0].length,
      node: { raw, type: "formulaPill", ...parseFormulaRaw(raw) },
    });
  }
  for (const match of node.value.matchAll(MARKER_RE)) {
    const { groups } = match;
    if (groups === undefined) {
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
  if (splices.length === 0) {
    return null;
  }
  splices.sort((a, b) => a.index - b.index);
  const out: PhrasingContent[] = [];
  let cursor = 0;
  for (const splice of splices) {
    // overlapping match (formula inside marker text) — first wins
    if (splice.index < cursor) {
      continue;
    }
    if (splice.index > cursor) {
      out.push({ type: "text", value: node.value.slice(cursor, splice.index) });
    }
    out.push(splice.node);
    cursor = splice.index + splice.length;
  }
  if (cursor < node.value.length) {
    out.push({ type: "text", value: node.value.slice(cursor) });
  }
  return out;
};

const walk = (parent: Parent): void => {
  for (let index = parent.children.length - 1; index >= 0; index -= 1) {
    const child = parent.children[index];
    if (child === undefined) {
      continue;
    }
    if ("children" in child) {
      walk(child);
      continue;
    }
    if (child.type !== "text") {
      continue;
    }
    const replaced = splitTextNode(child);
    if (replaced !== null) {
      parent.children.splice(index, 1, ...replaced);
    }
  }
};

const inlineConstructsToMarkdown: ToMarkdownExtension = {
  handlers: {
    commentMarker: Object.assign((node: CommentMarker) => `%%i:${node.ids}:${node.edge}%%`, {
      peek: () => "%",
    }),
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
};

// a function expression: remark plugins receive the processor as `this`.
export const remarkInlineConstructs: Plugin = function remarkInlineConstructs(
  this: Processor,
): Transformer {
  const data = this.data();
  (data.toMarkdownExtensions ??= []).push(inlineConstructsToMarkdown);
  return (tree) => {
    if (isMdastRoot(tree)) {
      walk(tree);
    }
  };
};
