// Obsidian's `[[Target]]`, `[[Target#Heading]]`, `[[Target|alias]]` and `![[…]]`, read only where
// markdown comes into the library from outside it: an import and the agent's text. A live paste
// never reads one. The resolver the caller hands in decides each: a page it names is a page link
// (the stock `[Title](mention:<id>)` link, which the `a` rule reads as a mention; the anchor and the
// alias go, since a mention names a page), a file an embed names is an image of that file, and
// anything it answers nothing for stays the text it was. Read from the parsed text, so code and
// math hold their brackets; a `\[\[` the writer escaped stays text, which is how the agent's view
// spells a person's own brackets.

import type { Image, Link, Nodes, PhrasingContent, Root, Text } from "mdast";
import type { Plugin, Transformer } from "unified";
import { CONTINUE, SKIP, visit } from "unist-util-visit";

import { isMdastRoot } from "./mdast-nodes";

export interface WikiTarget {
  // the page or file named, "" for `[[#Heading]]`
  readonly target: string;
  readonly anchor: string | null;
  readonly alias: string | null;
}

export type WikiReach =
  | { readonly kind: "item"; readonly itemId: string; readonly title: string }
  // the address the embed's image is written with, which the caller's image port reads back
  | { readonly kind: "file"; readonly url: string }
  | null;

export type WikiResolve = (link: WikiTarget, embed: boolean) => WikiReach;

// a body holds no bracket and no line break, as Obsidian reads one
const WIKI_RE = /(?<bang>!?)\[\[(?<body>[^[\]\n]+)\]\]/gu;

// Obsidian's image width, `300` or `300x200`
const WIDTH_RE = /^\d{1,5}(?:x\d{1,5})?$/u;

const MENTION_SCHEME = "mention:";

/** @internal */
export const wikiTarget = (body: string): WikiTarget => {
  const pipe = body.indexOf("|");
  const head = pipe === -1 ? body : body.slice(0, pipe);
  const alias = pipe === -1 ? null : body.slice(pipe + 1).trim();
  const hash = head.indexOf("#");
  return {
    alias: alias === "" ? null : alias,
    anchor: hash === -1 ? null : head.slice(hash + 1).trim() || null,
    target: (hash === -1 ? head : head.slice(0, hash)).trim(),
  };
};

const escapeRe = (text: string): string => text.replaceAll(/[$()*+.?[\\\]^{|}]/gu, String.raw`\$&`);

// a backslash run before `at` that escapes it: an odd count
const escapedAt = (source: string, at: number): boolean => {
  let count = 0;
  for (let index = at - 1; index >= 0 && source[index] === "\\"; index -= 1) {
    count += 1;
  }
  return count % 2 === 1;
};

interface Found {
  readonly embed: boolean;
}

// where the parsed text's `[[body]]` stands in the source, from `from` on, its brackets escaped or
// not, so each occurrence the parse read lines up with its own; `escaped` when any bracket was. A
// table cell gives its `\|` back as `|`, so a body's pipe may be written either way
const findInSource = (
  source: string,
  body: string,
  bang: boolean,
  from: number,
): { end: number; escaped: boolean; found: Found } | null => {
  const inner = escapeRe(body).replaceAll(String.raw`\|`, String.raw`\\?\|`);
  const pattern = new RegExp(String.raw`\[(?<open>\\?)\[${inner}(?<close>\\?\]\\?)\]`, "gu");
  pattern.lastIndex = from;
  const match = pattern.exec(source);
  if (match === null) {
    return null;
  }
  const escaped =
    escapedAt(source, match.index) || match.groups?.open !== "" || match.groups?.close !== "]";
  const embed = bang && source[match.index - 1] === "!" && !escapedAt(source, match.index - 1);
  return { end: match.index + match[0].length, escaped, found: { embed } };
};

const mentionLink = (itemId: string, title: string): Link => ({
  children: [{ type: "text", value: title }],
  type: "link",
  url: `${MENTION_SCHEME}${encodeURIComponent(itemId)}`,
});

const fileImage = (url: string, alias: string | null): Image => ({
  alt: alias !== null && WIDTH_RE.test(alias) ? `|${alias}` : "",
  title: null,
  type: "image",
  url,
});

const linkOf = (reach: WikiReach, alias: string | null): PhrasingContent | null => {
  switch (reach?.kind) {
    case "item": {
      return mentionLink(reach.itemId, reach.title);
    }
    case "file": {
      return fileImage(reach.url, alias);
    }
    default: {
      return null;
    }
  }
};

// where a node's text came from: its source, read past escapes as the parse read them; a node no
// parse placed (a directive restored as its text) has only its parsed text
interface Placement {
  readonly source: string;
  cursor: number;
  readonly end: number;
}

const placementOf = (node: Text, source: string | null): Placement | null => {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  return source === null || start === undefined || end === undefined
    ? null
    : { cursor: start, end, source };
};

// whether the source holds this `[[body]]` unescaped, and as an embed: null for a link the writer
// escaped, which is text
const readAt = (placement: Placement | null, body: string, bang: boolean): Found | null => {
  if (placement === null) {
    return { embed: bang };
  }
  const placed = findInSource(placement.source, body, bang, placement.cursor);
  if (placed === null || placed.end > placement.end) {
    return null;
  }
  placement.cursor = placed.end;
  return placed.escaped ? null : placed.found;
};

// one text node with its links read, the text between them kept; null when it holds none
const readText = (
  node: Text,
  source: string | null,
  resolve: WikiResolve,
): PhrasingContent[] | null => {
  const placement = placementOf(node, source);
  const parts: PhrasingContent[] = [];
  let last = 0;
  for (const match of node.value.matchAll(WIKI_RE)) {
    const body = match.groups?.body ?? "";
    const bang = match.groups?.bang === "!";
    const found = readAt(placement, body, bang);
    const link = wikiTarget(body);
    const read = found === null ? null : linkOf(resolve(link, found.embed), link.alias);
    if (found !== null && read !== null) {
      // an escaped `!` before a link is the text it is
      const from = match.index + (bang && !found.embed ? 1 : 0);
      parts.push({ type: "text", value: node.value.slice(last, from) }, read);
      last = match.index + match[0].length;
    }
  }
  if (last === 0) {
    return null;
  }
  parts.push({ type: "text", value: node.value.slice(last) });
  return parts.filter((part) => part.type !== "text" || part.value !== "");
};

// a link's words and a directive's label hold no link of their own
const holdsNoLinks = (node: Nodes): boolean =>
  node.type === "link" ||
  node.type === "linkReference" ||
  node.type === "textDirective" ||
  (node.type === "paragraph" && node.data?.directiveLabel === true);

const readTree = (tree: Root, source: string | null, resolve: WikiResolve): void => {
  visit(tree, (node, index, parent) => {
    if (holdsNoLinks(node)) {
      return SKIP;
    }
    if (node.type !== "text" || parent === undefined || index === undefined) {
      return CONTINUE;
    }
    const read = node.value.includes("[[") ? readText(node, source, resolve) : null;
    if (read === null) {
      return CONTINUE;
    }
    parent.children.splice(index, 1, ...read);
    return [SKIP, index + read.length];
  });
};

export const remarkWikiImport = (resolve: WikiResolve): Plugin =>
  function wikiImport(): Transformer {
    return (tree, file) => {
      if (isMdastRoot(tree)) {
        readTree(tree, String(file.value), resolve);
      }
    };
  };
