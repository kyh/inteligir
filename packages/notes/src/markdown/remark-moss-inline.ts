// Moss's two inline constructs, split out of text nodes after parse:
//
//   {{source|display}} / {{source|display|key=value;…}}   → mossFormula
//   %%m:id[,id]:start%% … %%m:id[,id]:end%%               → mossCommentMarker
//
// The dialect is Moss's (vendored moss-skills is the contract): `source` ends
// at the first `|`, metadata follows the second; marker ids are [A-Za-z0-9_-]
// comma runs and edge is start|end. Both nodes keep their INNER TEXT verbatim
// (`raw` / `ids`) and re-emit it wrapped — byte-exact both directions, the
// same discipline remark-wiki-link states.
//
// An mdast TRANSFORM rather than a micromark tokenizer, deliberately: neither
// construct nests, spans line breaks, or interacts with delimiter runs, so
// splitting finished text leaves is equivalent — and it cannot disturb how
// micromark reads everything else. It must run BEFORE remark-opaque (which
// walks the finished tree) and after the parse-order plugins.

import type { Node, Parent, PhrasingContent, Root, Text } from "mdast";
import type { Options as ToMarkdownExtension } from "mdast-util-to-markdown";
import type { Plugin, Processor, Transformer } from "unified";

export interface MossFormula extends Node {
  type: "mossFormula";
  /** Everything between the braces, verbatim. */
  raw: string;
  /** `source` half (before the first `|`). */
  source: string;
  /** `display` half (between the first and second `|`); "" when absent. */
  display: string;
  /** Raw metadata tail (after the second `|`), if present. */
  meta?: string;
}

export interface MossCommentMarker extends Node {
  type: "mossCommentMarker";
  /** The comma-separated id run, verbatim. */
  ids: string;
  edge: "start" | "end";
}

declare module "mdast" {
  interface PhrasingContentMap {
    mossCommentMarker: MossCommentMarker;
    mossFormula: MossFormula;
  }
  interface RootContentMap {
    mossCommentMarker: MossCommentMarker;
    mossFormula: MossFormula;
  }
}

// No pipes or braces inside source/display (the dialect has no escape form);
// the optional metadata tail may hold anything but braces.
const FORMULA_RE = /\{\{([^|{}\n]+)(?:\|([^|{}\n]*))?(?:\|([^{}\n]*))?\}\}/g;
/** The comment-anchor grammar, exported as the ONE spelling comments tooling
 * shares (marker extraction must never drift from what parses here). */
export const MARKER_RE = /%%m:([A-Za-z0-9_-]+(?:,[A-Za-z0-9_-]+)*):(start|end)%%/g;

/** Parse one formula body (the text between braces) into its halves. */
export function parseFormulaRaw(raw: string): Pick<MossFormula, "source" | "display" | "meta"> {
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
      node: { type: "mossFormula", raw, ...parseFormulaRaw(raw) },
    });
  }
  for (const match of node.value.matchAll(MARKER_RE)) {
    const ids = match[1];
    const edge = match[2];
    if ((edge === "start" || edge === "end") && ids !== undefined) {
      splices.push({
        index: match.index,
        length: match[0].length,
        node: { type: "mossCommentMarker", ids, edge },
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
    // Code and math leaves keep their text literal; recurse only into parents.
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

const mossToMarkdown: ToMarkdownExtension = {
  handlers: {
    mossFormula: Object.assign((node: MossFormula) => `{{${node.raw}}}`, {
      peek: () => "{",
    }),
    mossCommentMarker: Object.assign(
      (node: MossCommentMarker) => `%%m:${node.ids}:${node.edge}%%`,
      { peek: () => "%" },
    ),
  },
};

// Function expression (not an exported declaration) for the same reason
// remark-wiki-link states: remark plugins receive the processor as `this`.
export const remarkMossInline: Plugin = function (this: Processor): Transformer {
  const data = this.data();
  (data.toMarkdownExtensions ??= []).push(mossToMarkdown);
  return (tree) => {
    if (isRoot(tree)) walk(tree);
  };
};
