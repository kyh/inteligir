import type { Image, Nodes, PhrasingContent, Root, Text } from "mdast";
import type { Plugin, Transformer } from "unified";
import { CONTINUE, SKIP, visit } from "unist-util-visit";

import { mentionLink } from "@repo/editor/headless/markdown/md-rules";

import { isMdastRoot } from "./mdast-nodes";

export interface WikiTarget {
  readonly target: string;
  readonly anchor: string | null;
  readonly alias: string | null;
}

export type WikiReach =
  | { readonly kind: "item"; readonly itemId: string; readonly title: string }
  | { readonly kind: "file"; readonly url: string }
  | null;

export type WikiResolve = (link: WikiTarget, embed: boolean) => WikiReach;

const WIKI_RE = /(?<bang>!?)\[\[(?<body>[^[\]\n]+)\]\]/gu;

const WIDTH_RE = /^\d{1,5}(?:x\d{1,5})?$/u;

const wikiTarget = (body: string) => {
  const pipe = body.indexOf("|");
  const head = pipe === -1 ? body : body.slice(0, pipe);
  const alias = pipe === -1 ? null : body.slice(pipe + 1).trim();
  const hash = head.indexOf("#");

  return {
    alias: alias === "" ? null : alias,
    anchor: hash === -1 ? null : head.slice(hash + 1).trim() || null,
    target: (hash === -1 ? head : head.slice(0, hash)).trim(),
  } satisfies WikiTarget;
};

const escapeRe = (text: string) => text.replaceAll(/[$()*+.?[\\\]^{|}]/gu, String.raw`\$&`);

const escapedAt = (source: string, at: number) => {
  let count = 0;

  for (let index = at - 1; index >= 0 && source[index] === "\\"; index -= 1) {
    count += 1;
  }

  return count % 2 === 1;
};

interface Found {
  readonly embed: boolean;
}

const findInSource = (source: string, body: string, bang: boolean, from: number) => {
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

  return { end: match.index + match[0].length, escaped, found: { embed } } satisfies {
    end: number;
    escaped: boolean;
    found: Found;
  } | null;
};

const fileImage = (url: string, alias: string | null) =>
  ({
    alt: alias !== null && WIDTH_RE.test(alias) ? `|${alias}` : "",
    title: null,
    type: "image",
    url,
  }) satisfies Image;

const linkOf = (reach: WikiReach, alias: string | null) => {
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

interface Placement {
  readonly source: string;
  cursor: number;
  readonly end: number;
}

const placementOf = (node: Text, source: string | null) => {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;

  return (
    source === null || start === undefined || end === undefined
      ? null
      : { cursor: start, end, source }
  ) satisfies Placement | null;
};

const readAt = (placement: Placement | null, body: string, bang: boolean) => {
  if (placement === null) {
    return { embed: bang } satisfies Found | null;
  }

  const placed = findInSource(placement.source, body, bang, placement.cursor);

  if (placed === null || placed.end > placement.end) {
    return null;
  }

  placement.cursor = placed.end;

  return placed.escaped ? null : placed.found;
};

const readText = (node: Text, source: string | null, resolve: WikiResolve) => {
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

const holdsNoLinks = (node: Nodes) =>
  node.type === "link" ||
  node.type === "linkReference" ||
  node.type === "textDirective" ||
  (node.type === "paragraph" && node.data?.directiveLabel === true);

const readTree = (tree: Root, source: string | null, resolve: WikiResolve) => {
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

export const remarkWikiImport = (resolve: WikiResolve) =>
  function wikiImport() {
    return ((tree, file) => {
      if (isMdastRoot(tree)) {
        readTree(tree, String(file.value), resolve);
      }
    }) satisfies Transformer;
  } satisfies Plugin;
