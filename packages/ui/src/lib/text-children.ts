import type { ReactNode } from "react";

type TextChild = string | number;

// A row's or a button's text is its strings; anything else a caller passes is an element it wants
// drawn beside that text, not inside it.
export const isTextChild = (node: ReactNode): node is TextChild =>
  typeof node === "string" || typeof node === "number";

// the leading strings are the label; whatever follows is drawn as given
export const splitLeadingText = (content: ReactNode) => {
  const nodes: ReactNode[] = Array.isArray(content) ? content : [content];
  const leading: TextChild[] = [];
  for (const node of nodes) {
    if (!isTextChild(node)) {
      break;
    }
    leading.push(node);
  }
  return { rest: nodes.slice(leading.length), text: leading.join("") };
};
