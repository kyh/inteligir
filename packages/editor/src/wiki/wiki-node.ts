// A wiki link or embed as the editor holds it, in the library's own vocabulary
// (`@repo/notes/library/library-nodes`): the target by id when the writer named one, the title the
// writer saw, and the anchor and alias beside them. The dialect writes one as `[[…]]`, and this is
// the one place a body becomes a node and a node a body again: the uuid after the last pipe
// (`[[Title|uuid]]`) is the id, never an alias, and a node with an id writes it back there. Headless:
// the rule table and the codec reach it as the kits do.

import type { TElement, TText } from "platejs";

import { blockIdSchema } from "@repo/notes/library/library-nodes";
import {
  isUuidWikiAlias,
  parseWikiBody,
  serializeWikiBody,
} from "@repo/notes/markdown/remark-wiki-link";
import type { WikiBody } from "@repo/notes/markdown/remark-wiki-link";

import type { WIKI_EMBED_KEY, WIKI_LINK_KEY } from "@repo/editor/dialect-node-keys";
import { stringProp } from "@repo/editor/node-props";

export interface WikiNodeFields {
  // the item the link names, null for a title no item holds yet
  readonly itemId: string | null;
  // what the writer saw: the item's title, or the target as written
  readonly title: string;
  readonly heading: string | undefined;
  readonly blockRef: string | undefined;
  readonly alias: string | undefined;
}

export type WikiNodeType = typeof WIKI_LINK_KEY | typeof WIKI_EMBED_KEY;

const voidLeaf = (marks: Omit<TText, "text">): TText[] => [{ ...marks, text: "" }];

// a node's fields, read off its open props
export const wikiFieldsOf = (node: TElement): WikiNodeFields => ({
  alias: stringProp(node, "alias"),
  blockRef: stringProp(node, "blockRef"),
  heading: stringProp(node, "heading"),
  itemId: stringProp(node, "itemId") ?? null,
  title: stringProp(node, "title") ?? "",
});

// the node a set of fields is, with only the props it holds
export const wikiNode = (
  type: WikiNodeType,
  fields: WikiNodeFields,
  marks: Omit<TText, "text"> = {},
): TElement => {
  const node: TElement = {
    children: voidLeaf(marks),
    itemId: fields.itemId,
    title: fields.title,
    type,
  };
  if (fields.heading !== undefined) {
    node.heading = fields.heading;
  }
  if (fields.blockRef !== undefined) {
    node.blockRef = fields.blockRef;
  }
  if (fields.alias !== undefined) {
    node.alias = fields.alias;
  }
  return node;
};

// `^abc` names a block a link reaches by `[[Note#^abc]]`; any other anchor is a heading
const BLOCK_REF_RE = /^\^(?<ref>[A-Za-z0-9-]+)$/u;

// a body as the written node it spells: the target as written, its id from a uuid after the pipe
export const wikiFieldsOfBody = (body: string): WikiNodeFields => {
  const { alias, anchor, target } = parseWikiBody(body);
  const ref = anchor === undefined ? undefined : BLOCK_REF_RE.exec(anchor)?.groups?.ref;
  const blockRef = ref !== undefined && blockIdSchema.validate(ref) ? ref : undefined;
  const byId = alias !== undefined && isUuidWikiAlias(alias);
  return {
    alias: byId ? undefined : alias,
    blockRef,
    heading: blockRef === undefined ? anchor : undefined,
    itemId: byId ? alias : null,
    title: target,
  };
};

const anchorOf = (fields: WikiNodeFields): string | undefined =>
  fields.heading ?? (fields.blockRef === undefined ? undefined : `^${fields.blockRef}`);

// the parts of the body a node is written with: the id after the pipe unless an alias holds it
export const wikiPartsOf = (fields: WikiNodeFields): WikiBody => {
  const parts: WikiBody = { target: fields.title };
  const anchor = anchorOf(fields);
  if (anchor !== undefined) {
    parts.anchor = anchor;
  }
  const alias = fields.alias ?? fields.itemId;
  if (alias !== null) {
    parts.alias = alias;
  }
  return parts;
};

// a target a wiki link cannot carry loses the characters that end the construct
const UNCARRIABLE_RE = /[[\]|\r\n]+/gu;

// the body a node writes: as it reads, else with the title stripped of what no link can carry;
// null when neither parses back, which writes the link's words as text
export const wikiBodyOf = (fields: WikiNodeFields): string | null => {
  const parts = wikiPartsOf(fields);
  return (
    serializeWikiBody(parts) ??
    serializeWikiBody({ ...parts, target: parts.target.replaceAll(UNCARRIABLE_RE, " ").trim() })
  );
};

// what a link shows when no host names its target better: the alias, else the title and anchor
export const wikiLabelOf = (fields: WikiNodeFields): string => {
  if (fields.alias !== undefined) {
    return fields.alias;
  }
  const anchor = anchorOf(fields);
  return anchor === undefined ? fields.title : `${fields.title}#${anchor}`;
};
