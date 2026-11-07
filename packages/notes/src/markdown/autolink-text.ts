// A link whose bytes are its own address needs no label, but only where those bytes read back as
// that link in that place: gfm cuts a literal's trailing punctuation, runs it on to the next space,
// and wants no word before it. So the answer is gfm's own, over the bytes the link would stand
// among, and the writer, the footnote hold and the passage projection all hear the same one.

import type { Delete, Emphasis, Link, Nodes, Parents, PhrasingContent, Strong } from "mdast";
import type { Handle, Info, State } from "mdast-util-to-markdown";
import { defaultHandlers } from "mdast-util-to-markdown";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

import { escapeBarePipes } from "./line-scan";

declare module "mdast-util-to-markdown" {
  interface ConstructNameMap {
    linkTail: "linkTail";
  }
}

const GFM = unified().use(remarkParse).use(remarkGfm).freeze();

const BARE_AUTOLINK_PROTOCOL_RE = /^https?:\/\//iu;
const WWW_AUTOLINK_RE = /^www\./iu;

// a literal runs on to the next space at most, so nothing past that moves where it ends. No wider
// a space than these: gfm's pass over finished text runs on through a no-break space
const NEXT_WORD_RE = /^[^ \t\r\n]*/u;

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

// What stands before the link is one character of text. The writer escapes a `<` and a `[`, which
// left bare here would open an angle link and a label; any other stands as it is written, since a
// `.` or a `-` joins the mail address a word before it starts, and words ahead keep a `#` or `>` from
// opening a block. A `<` further back shows to no asker, and a `>` after a mail address closes it
// into an angle link to another: `<#a@b.cd>`. gfm reads that `>` into any other literal.
const readsBack = (literal: string, url: string, { after, before }: Beside): boolean => {
  const text = before === "<" || before === "[" ? `\\${before}` : before;
  const word = NEXT_WORD_RE.exec(after)?.[0] ?? "";
  return (
    !after.startsWith(">") && firstLink(GFM.parse(`words ${text}${literal}${word}`))?.url === url
  );
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

const isTag = (parent: Parents | undefined): boolean =>
  parent?.type === "htmlElement" || parent?.type === "underline";

// a tag's text and a footnote are read for the source they keep, not into the library's blocks
const isHeld = (parent: Parents | undefined, state: State): boolean =>
  isTag(parent) || state.stack.includes("footnoteDefinition");

// only the library reads a mark around a literal back onto the link's text; a held source would
// read a link in a mark's own node, which keeps its label (`phrasingOf`)
const literalOf = (
  link: Link,
  parent: Parents | undefined,
  state: State,
): PhrasingContent | null => {
  const [only, ...rest] = link.children;
  if (only === undefined || rest.length > 0 || (link.title ?? "") !== "") {
    return null;
  }
  const literal = markedLiteral(only, link.url, state);
  return literal?.type === "html" || !isHeld(parent, state) ? literal : null;
};

// the siblings of a link the writer sees every byte around. A literal runs on through a mark's
// closer into what stands past it, which no view here reaches, so a link in a mark's own node has
// none: only a held source holds one, since the library keeps its marks on a link's text.
const phrasingOf = (parent: Parents | undefined): readonly PhrasingContent[] => {
  switch (parent?.type) {
    case "heading":
    case "htmlElement":
    case "paragraph":
    case "tableCell":
    case "underline": {
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

// what stands past a block's last child. A link's own `info.after` is only its next sibling's first
// byte, which leaves that sibling's last byte unwritten: a space there is a reference at a line's end.
const blockEnd = (parent: Parents | undefined, state: State): string => {
  if (isTag(parent)) {
    return "<";
  }
  return state.stack.includes("tableCell") ? "" : "\n";
};

// the bytes after a link as they will be written. The next link stops them, as a word would: its
// spelling hangs on its own check, which would have a row of links each write the row's tail, and
// a literal with no space before that link runs into it either way. A link further in is past a
// word or a tag, so its spelling moves nothing here, and `linkTail` has it skip its own look ahead:
// each tag deep would otherwise write what it holds once more for each link beside it. A hard
// break after a literal is two spaces (`hardBreakAfterBareUrl`).
const writtenAfter = (
  following: readonly PhrasingContent[],
  end: string,
  state: State,
  info: Info,
): string => {
  if (following[0]?.type === "break") {
    return "\n";
  }
  const nextLink = following.findIndex((node) => node.type === "link");
  const children = following.slice(0, nextLink === -1 ? following.length : nextLink);
  const after = nextLink === -1 ? end : "x";
  const exit = state.enter("linkTail");
  const written = state.containerPhrasing({ children, type: "paragraph" }, { ...info, after });
  exit();
  return `${written}${after}`;
};

// the writer may spell the character beside a mark as a reference, which a literal cannot hold, and
// a literal's own mark after a link would join that link's closer, should it stand bare too
const touchesMark = (
  literal: PhrasingContent,
  siblings: readonly PhrasingContent[],
  index: number,
): boolean => {
  const before = siblings[index - 1];
  const after = siblings[index + 1];
  return (
    (before !== undefined && isMark(before)) ||
    (after !== undefined && isMark(after)) ||
    (literal.type !== "html" && before?.type === "link")
  );
};

// the link's bare bytes, where they read back as it
const bareSpelling = (
  link: Link,
  parent: Parents | undefined,
  state: State,
  info: Info,
): string | null => {
  const literal = literalOf(link, parent, state);
  const siblings = phrasingOf(parent);
  const index = siblings.indexOf(link);
  if (
    literal === null ||
    index === -1 ||
    state.stack.includes("linkTail") ||
    touchesMark(literal, siblings, index)
  ) {
    return null;
  }
  // a line's end stands for all that can follow: a space and punctuation close a mark alike, and a
  // word runs the literal on past it. So a peek and the break after the link spell what it writes.
  const spelled = state.handle(literal, parent, state, { ...info, after: "\n" });
  const after = writtenAfter(siblings.slice(index + 1), blockEnd(parent, state), state, {
    ...info,
    before: spelled.slice(-1),
  });
  const before = edgeOf(info.before.slice(-1), state);
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
  return bareSpelling(link, parent, state, { ...info, before: before === "" ? "\n" : before });
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
