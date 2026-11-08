// Obsidian's spellings in a person's own writing: `%%comment%%` and a block's `^ref`. They are no
// part of the grammar, which a page and a paste parse through too and keep as they came, so the
// codec reads them off a note's tree (`readObsidian`), where an escape still
// shows: as with the grammar's constructs, one whose first character an escape wrote is text, and
// the serializer writes that escape before typed text that would read as one. A ref leaves the
// text there for a node of its own, which the serializer writes bare, so a ref and text that looks
// like one are never the same bytes.

import type {
  Heading,
  Node,
  Paragraph,
  Parent,
  Parents,
  PhrasingContent,
  Root,
  RootContent,
  Text,
} from "mdast";
import type { Options as ToMarkdownExtension, Unsafe } from "mdast-util-to-markdown";
import type { Plugin, Processor } from "unified";

import { blockIdSchema } from "../library/library-nodes";
import { LINK_LIKE, NOT_PROSE } from "./remark-inline-constructs";
import { escapedAt, textCutter } from "./text-escapes";

// `own`: on a line of its own, where it names the block above
export interface BlockRef extends Node {
  type: "blockRef";
  ref: string;
  own: boolean;
}

declare module "mdast" {
  interface PhrasingContentMap {
    blockRef: BlockRef;
  }
  interface RootContentMap {
    blockRef: BlockRef;
  }
}

// each spelling after its first character, the one an escape keeps it text by
const COMMENT_TAIL = String.raw`%[^%\n][^%]*%%`;
const REF_NAME = "(?<ref>[A-Za-z0-9-]+)";

// global, so for matchAll alone: exec's lastIndex would carry from one caller into the next
const COMMENT_RE = new RegExp(`%${COMMENT_TAIL}`, "gu");
const OWN_REF_RE = new RegExp(String.raw`^\^${REF_NAME}$`, "u");
const TRAILING_REF_RE = new RegExp(String.raw`[ \t]\^${REF_NAME}$`, "u");

const textPiece = (between: Text): Text[] => (between.value === "" ? [] : [between]);

// a text cut at each match no escape keeps text, a match read by `piece` and the rest by `rest`
const cutAround = (
  node: Text,
  pattern: RegExp,
  piece: (match: RegExpExecArray) => PhrasingContent[],
  rest: (between: Text) => PhrasingContent[],
): PhrasingContent[] => {
  const cut = textCutter(node);
  const out: PhrasingContent[] = [];
  let cursor = 0;
  for (const match of node.value.matchAll(pattern)) {
    if (!escapedAt(node, match.index)) {
      out.push(...rest(cut(cursor, match.index)), ...piece(match));
      cursor = match.index + match[0].length;
    }
  }
  out.push(...rest(cut(cursor, node.value.length)));
  return out;
};

const commentsIn = (node: Text): PhrasingContent[] =>
  cutAround(node, COMMENT_RE, (match) => [{ type: "opaqueInline", value: match[0] }], textPiece);

const walk = (parent: Parent): void => {
  parent.children = parent.children.flatMap((child): RootContent[] => {
    if (child.type === "text") {
      return commentsIn(child);
    }
    if ("children" in child && !LINK_LIKE.has(child.type)) {
      walk(child);
    }
    return [child];
  });
};

interface SpelledRef {
  readonly ref: string;
  readonly index: number;
}

// `caret` is where in the match its `^` stands
const spelledRef = (node: Text, pattern: RegExp, caret: number): SpelledRef | null => {
  const match = pattern.exec(node.value);
  const ref = match?.groups?.ref;
  return match !== null &&
    ref !== undefined &&
    blockIdSchema.validate(ref) &&
    !escapedAt(node, match.index + caret)
    ? { index: match.index, ref }
    : null;
};

const readRef = (line: Paragraph | Heading, ownLine: boolean): void => {
  const last = line.children.at(-1);
  if (last?.type !== "text") {
    return;
  }
  const own = ownLine && line.children.length === 1 ? spelledRef(last, OWN_REF_RE, 0) : null;
  if (own !== null) {
    line.children = [{ own: true, ref: own.ref, type: "blockRef" }];
    return;
  }
  const trailing = spelledRef(last, TRAILING_REF_RE, 1);
  if (trailing !== null) {
    const before = textPiece(textCutter(last)(0, trailing.index));
    line.children.splice(-1, 1, ...before, { own: false, ref: trailing.ref, type: "blockRef" });
  }
};

// the lines a ref is read from, those the library keeps as blocks of their own: a section's own
// and a list's at any depth, where an item's first line is the item, so no ref stands alone on it
const readLines = (flow: readonly RootContent[], item: boolean): void => {
  for (const [index, node] of flow.entries()) {
    if (node.type === "paragraph") {
      readRef(node, !item || index > 0);
    } else if (node.type === "heading") {
      readRef(node, false);
    } else if (node.type === "list") {
      for (const listItem of node.children) {
        readLines(listItem.children, true);
      }
    }
  }
};

// a note's flow with its spellings read out of it, the nodes handed in reused
export const readObsidian = (flow: RootContent[]): RootContent[] => {
  const root: Root = { children: flow, type: "root" };
  walk(root);
  readLines(root.children, false);
  return root.children;
};

// a link's words are read as written, so nothing in them needs the escape
const NOT_READ = [...NOT_PROSE, "link" as const, "linkReference" as const];

const UNSAFE: Unsafe[] = [
  { after: COMMENT_TAIL, character: "%", inConstruct: "phrasing", notInConstruct: NOT_READ },
  // the name ends the line's text, which the serializer closes with the line's own break
  {
    after: String.raw`${REF_NAME}\n$`,
    before: String.raw`[ \t\n]`,
    character: "^",
    inConstruct: "phrasing",
    notInConstruct: NOT_READ,
  },
];

const obsidianToMarkdown: ToMarkdownExtension = {
  handlers: {
    blockRef: Object.assign(
      (node: BlockRef, parent: Parents | undefined) => {
        if (node.own) {
          return `^${node.ref}`;
        }
        // the block has no text, and a bare space would be trimmed into a ref of the block above
        return parent?.children[0] === node ? `&#x20;^${node.ref}` : ` ^${node.ref}`;
      },
      { peek: () => " " },
    ),
  },
  unsafe: UNSAFE,
};

export const remarkObsidian: Plugin = function remarkObsidian(this: Processor): undefined {
  (this.data().toMarkdownExtensions ??= []).push(obsidianToMarkdown);
};
