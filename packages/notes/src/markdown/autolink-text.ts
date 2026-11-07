// A link whose bytes are its own address needs no label, but only where those bytes read back as
// that link in that place: gfm cuts a literal's trailing punctuation, runs it on to the next space,
// and wants no word before it. So the answer is gfm's own, over the bytes the link would stand
// among, and the writer, the footnote hold and the passage projection all hear the same one.

import type { Delete, Emphasis, Link, Nodes, Parents, PhrasingContent, Strong } from "mdast";
import type { Handle, Info, State } from "mdast-util-to-markdown";
import { defaultHandlers } from "mdast-util-to-markdown";
import { asciiPunctuation } from "micromark-util-character";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

import { escapeBarePipes } from "./line-scan";

const GFM = unified().use(remarkParse).use(remarkGfm).freeze();

const BARE_AUTOLINK_PROTOCOL_RE = /^https?:\/\//iu;
const WWW_AUTOLINK_RE = /^www\./iu;

// a literal runs on to the next space at most, so nothing past that moves where it ends
const NEXT_WORD_RE = /^\S*/u;

// text that spells this address: a url, a www literal (gfm prefixes its url with `http://`) or a
// mail address
const spellsAddress = (text: string, url: string): boolean =>
  (text === url && BARE_AUTOLINK_PROTOCOL_RE.test(url)) ||
  (url === `http://${text}` && WWW_AUTOLINK_RE.test(text)) ||
  `mailto:${text}` === url;

const firstLink = (node: Nodes): Link | null => {
  if (node.type === "link") {
    return node;
  }
  const children: readonly Nodes[] = "children" in node ? node.children : [];
  for (const child of children) {
    const found = firstLink(child);
    if (found !== null) {
      return found;
    }
  }
  return null;
};

// the bytes either side of a link
interface Beside {
  before: string;
  after: string;
}

// What stands before the link is one character of text, which the writer has escaped where it needs
// to: left bare here a `<` would open an angle link and a `[` a label, and words ahead keep a `#` or
// `>` from opening a block.
const readsBack = (literal: string, url: string, { after, before }: Beside): boolean => {
  const text = asciiPunctuation(before.codePointAt(0) ?? null) ? `\\${before}` : before;
  const word = NEXT_WORD_RE.exec(after)?.[0] ?? "";
  return firstLink(GFM.parse(`words ${text}${literal}${word}`))?.url === url;
};

interface LinkNode {
  url?: string | undefined;
  title?: string | null | undefined;
  children?: readonly { type: string; value?: string | undefined }[] | undefined;
}

// a title has no bare spelling, so a link with one keeps its label whatever the label says
export const isBareLink = (
  { children = [], title, url = "" }: LinkNode,
  beside: Beside,
): boolean => {
  const [only, ...rest] = children;
  const text = only?.value ?? "";
  return (
    only?.type === "text" &&
    rest.length === 0 &&
    (title ?? "") === "" &&
    spellsAddress(text, url) &&
    readsBack(text, url, beside)
  );
};

// what a sibling shows a reader of the tree alone: a text its words, a break its line's end, and
// any other node the stand-in for its own syntax
const sideOf = (node: Nodes | undefined, standIn: string): string => {
  if (node === undefined) {
    return "";
  }
  if (node.type === "break") {
    return "\n";
  }
  return node.type === "text" ? node.value : standIn;
};

// syntax after a literal runs into it, so it stands as a word; syntax before one leaves it a literal
export const besideChild = (siblings: readonly Nodes[], index: number): Beside => ({
  after: sideOf(siblings[index + 1], "x"),
  before: sideOf(siblings[index - 1], ",").slice(-1),
});

const isMark = (node: PhrasingContent): node is Delete | Emphasis | Strong =>
  node.type === "emphasis" || node.type === "strong" || node.type === "delete";

// a mark over the whole label stands around the literal, which reads back as the same marked link:
// `_https://x.cd_`. The literal is `html` for its verbatim bytes.
const markedLiteral = (
  node: PhrasingContent,
  url: string,
  state: State,
): PhrasingContent | null => {
  if (node.type === "text") {
    const { value } = node;
    return spellsAddress(value, url)
      ? { type: "html", value: state.stack.includes("tableCell") ? escapeBarePipes(value) : value }
      : null;
  }
  if (!isMark(node)) {
    return null;
  }
  const [only, ...rest] = node.children;
  const inner = only === undefined || rest.length > 0 ? null : markedLiteral(only, url, state);
  return inner === null ? null : { ...node, children: [inner] };
};

const literalOf = (link: Link, state: State): PhrasingContent | null => {
  const [only, ...rest] = link.children;
  return only === undefined || rest.length > 0 || (link.title ?? "") !== ""
    ? null
    : markedLiteral(only, link.url, state);
};

const phrasingOf = (parent: Parents | undefined): readonly PhrasingContent[] => {
  switch (parent?.type) {
    case "delete":
    case "emphasis":
    case "heading":
    case "paragraph":
    case "strong":
    case "tableCell": {
      return parent.children;
    }
    default: {
      return [];
    }
  }
};

// a cell's text stops at its pipes, which gfm passes as what stands around it
const edgeOf = (byte: string, state: State): string =>
  byte === "|" && state.stack.includes("tableCell") ? "" : byte;

// the bytes after a link as they will be written. The next link stops them, as a word would: its
// spelling hangs on its own check, which would have a row of links each write the row's tail, and
// a literal with no space before that link runs into it either way. A hard break after a literal
// is two spaces (`hardBreakAfterBareUrl`).
const writtenAfter = (following: readonly PhrasingContent[], state: State, info: Info): string => {
  if (following[0]?.type === "break") {
    return "\n";
  }
  const nextLink = following.findIndex((node) => node.type === "link");
  const children = following.slice(0, nextLink === -1 ? following.length : nextLink);
  const after = nextLink === -1 ? edgeOf(info.after, state) : "x";
  const written = state.containerPhrasing({ children, type: "paragraph" }, { ...info, after });
  return `${written}${after}`;
};

// the writer may spell the character beside a mark as a reference, which a literal cannot hold
const touchesMark = (siblings: readonly PhrasingContent[], index: number): boolean =>
  [siblings[index - 1], siblings[index + 1]].some((node) => node !== undefined && isMark(node));

// a mark opens only after no word
const WORD_END_RE = /[\p{L}\p{N}]$/u;

// the link's bare bytes, where they read back as it
const bareSpelling = (
  link: Link,
  parent: Parents | undefined,
  state: State,
  info: Info,
): string | null => {
  const literal = literalOf(link, state);
  if (literal === null) {
    return null;
  }
  const siblings = phrasingOf(parent);
  const index = siblings.indexOf(link);
  const before = edgeOf(info.before.slice(-1), state);
  if (touchesMark(siblings, index) || (literal.type !== "html" && WORD_END_RE.test(before))) {
    return null;
  }
  const spelled = state.handle(literal, parent, state, info);
  const after = writtenAfter(siblings.slice(index + 1), state, {
    ...info,
    before: spelled.slice(-1),
  });
  return readsBack(spelled, link.url, { after, before }) ? spelled : null;
};

// the same for a writer that is not at the link, a peek or the break after it: what stands before
// the link is what the tree shows
export const bareAhead = (
  link: Link,
  parent: Parents | undefined,
  state: State,
  info: Info,
): string | null => {
  const siblings = phrasingOf(parent);
  const { before } = besideChild(siblings, siblings.indexOf(link));
  return bareSpelling(link, parent, state, { ...info, before });
};

// every other link keeps `[text](url)` under the writer's `resourceLink`, which always reads back.
// A peek names the first byte the text before the link stands against: a `!` left bare before a
// label would make it an image.
export const writeLink: Handle = Object.assign(
  (node: Link, parent: Parents | undefined, state: State, info: Info) =>
    bareSpelling(node, parent, state, info) ?? defaultHandlers.link(node, parent, state, info),
  {
    peek: (node: Link, parent: Parents | undefined, state: State, info: Info) =>
      bareAhead(node, parent, state, info)?.charAt(0) ?? "[",
  },
);
