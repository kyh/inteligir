import { TextApi } from "platejs";
import type { Descendant, TText } from "platejs";

import type { LibraryNode } from "@repo/contract/library/library-nodes";

type LibraryText = Extract<LibraryNode, { text: string }>;

export type Marks = Omit<LibraryText, "text">;

export const MARK_KEYS = [
  "bold",
  "code",
  "highlight",
  "italic",
  "strikethrough",
  "underline",
] as const satisfies readonly (keyof Marks)[];

export const isText = (node: Descendant): node is TText => TextApi.isText(node);

export const marksOf = (node: TText) => {
  const marks: Marks = {};

  for (const key of MARK_KEYS) {
    if (node[key] === true) {
      marks[key] = true;
    }
  }

  return marks;
};

export const leaf = (text: string, marks: Marks) => ({ ...marks, text }) satisfies TText;

export const sameMarks = (a: TText, b: TText) =>
  MARK_KEYS.every((key) => (a[key] === true) === (b[key] === true));

export const tidyInlines: (nodes: readonly Descendant[]) => Descendant[] = (
  nodes: readonly Descendant[],
) => {
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

  return (kept.length > 0 ? kept : [{ text: "" }]) satisfies Descendant[];
};
