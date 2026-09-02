// an mdast transform rather than a micromark tokenizer: neither construct nests, spans line
// breaks or interacts with delimiter runs, so splitting finished text leaves is equivalent and
// cannot disturb how micromark reads everything else. must run before remark-opaque.

import type { Node, Parent, Parents, PhrasingContent, Root, Text } from "mdast";
import type { Options as ToMarkdownExtension, State } from "mdast-util-to-markdown";
import type { Plugin, Processor, Transformer } from "unified";

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

const FORMULA_RE = /\{\{([^|{}\n]+)(?:\|([^|{}\n]*))?(?:\|([^{}\n]*))?\}\}/g;
export const MARKER_RE = /%%i:([A-Za-z0-9_-]+(?:,[A-Za-z0-9_-]+)*):(start|end)%%/g;

export function parseFormulaRaw(raw: string): Pick<FormulaPill, "source" | "display" | "meta"> {
  const first = raw.indexOf("|");
  if (first === -1) return { source: raw, display: "" };
  const second = raw.indexOf("|", first + 1);
  if (second === -1) return { source: raw.slice(0, first), display: raw.slice(first + 1) };
  return {
    source: raw.slice(0, first),
    display: raw.slice(first + 1, second),
    meta: raw.slice(second + 1),
  };
}

function isRoot(node: Node): node is Root {
  return node.type === "root";
}

type Splice = { index: number; length: number; node: PhrasingContent };

function splitTextNode(node: Text): PhrasingContent[] | null {
  const splices: Splice[] = [];
  for (const match of node.value.matchAll(FORMULA_RE)) {
    const raw = match[0].slice(2, -2);
    splices.push({
      index: match.index,
      length: match[0].length,
      node: { type: "formulaPill", raw, ...parseFormulaRaw(raw) },
    });
  }
  for (const match of node.value.matchAll(MARKER_RE)) {
    const ids = match[1];
    const edge = match[2];
    if ((edge === "start" || edge === "end") && ids !== undefined) {
      splices.push({
        index: match.index,
        length: match[0].length,
        node: { type: "commentMarker", ids, edge },
      });
    }
  }
  if (splices.length === 0) return null;
  splices.sort((a, b) => a.index - b.index);
  const out: PhrasingContent[] = [];
  let cursor = 0;
  for (const splice of splices) {
    if (splice.index < cursor) continue; // overlapping match (formula inside marker text) — first wins
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
}

function walk(parent: Parent): void {
  for (let index = parent.children.length - 1; index >= 0; index--) {
    const child = parent.children[index];
    if (child === undefined) continue;
    if ("children" in child) {
      walk(child);
      continue;
    }
    if (child.type !== "text") continue;
    const replaced = splitTextNode(child);
    if (replaced !== null) {
      parent.children.splice(index, 1, ...replaced);
    }
  }
}

const inlineConstructsToMarkdown: ToMarkdownExtension = {
  handlers: {
    // inside a gfm table cell the pill's pipes must leave as `\|` or the next parse reads them
    // as cell delimiters; gfm-table's fromMarkdown unescapes them before this transform sees text.
    formulaPill: Object.assign(
      (node: FormulaPill, _parent: Parents | undefined, state: State) => {
        const raw = `{{${node.raw}}}`;
        return state.stack.includes("tableCell") ? raw.replaceAll("|", "\\|") : raw;
      },
      { peek: () => "{" },
    ),
    commentMarker: Object.assign((node: CommentMarker) => `%%i:${node.ids}:${node.edge}%%`, {
      peek: () => "%",
    }),
  },
};

// a function expression: remark plugins receive the processor as `this`.
export const remarkInlineConstructs: Plugin = function (this: Processor): Transformer {
  const data = this.data();
  (data.toMarkdownExtensions ??= []).push(inlineConstructsToMarkdown);
  return (tree) => {
    if (isRoot(tree)) walk(tree);
  };
};
