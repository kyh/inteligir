// A line of Slate text as the codec writes it: the marks the vocabulary names, and neighbours that
// carry the same marks joined into one leaf, so a value read from markdown and one about to be
// written as markdown hold their text one way (two bold leaves side by side would save as
// `**a****b**`).

import { TextApi } from "platejs";
import type { Descendant, TText } from "platejs";

import type { LibraryNode } from "@repo/notes/library/library-nodes";

type LibraryText = Extract<LibraryNode, { text: string }>;

export type Marks = Omit<LibraryText, "text">;

// every mark the vocabulary's text names (`slate-leaves.test.ts` holds the two lists together)
export const MARK_KEYS = [
  "bold",
  "code",
  "italic",
  "strikethrough",
  "underline",
] as const satisfies readonly (keyof Marks)[];

export const isText = (node: Descendant): node is TText => TextApi.isText(node);

export const marksOf = (node: TText): Marks => {
  const marks: Marks = {};
  for (const key of MARK_KEYS) {
    if (node[key] === true) {
      marks[key] = true;
    }
  }
  return marks;
};

export const leaf = (text: string, marks: Marks): TText => ({ ...marks, text });

const sameMarks = (a: TText, b: TText): boolean =>
  MARK_KEYS.every((key) => (a[key] === true) === (b[key] === true));

// a run of text and inline nodes as Slate keeps it: neighbours with the same marks joined, an
// empty text kept only where nothing else is
export const tidyInlines = (nodes: readonly Descendant[]): Descendant[] => {
  const out: Descendant[] = [];
  for (const node of nodes) {
    const last = out.at(-1);
    if (isText(node) && last !== undefined && isText(last) && sameMarks(last, node)) {
      out[out.length - 1] = { ...last, text: last.text + node.text };
      continue;
    }
    out.push(node);
  }
  const kept = out.filter((node) => !isText(node) || node.text !== "");
  return kept.length > 0 ? kept : [{ text: "" }];
};
