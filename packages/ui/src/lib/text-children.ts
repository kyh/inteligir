import type { ReactNode } from "react";

type TextChild = string | number;

export const isTextChild = (node: ReactNode): node is TextChild =>
  typeof node === "string" || typeof node === "number";

const isNodeList = (content: ReactNode): content is readonly ReactNode[] => Array.isArray(content);

export const childList = (content: ReactNode) =>
  (isNodeList(content) ? content : [content]) satisfies readonly ReactNode[];

export const splitLeadingText = (content: ReactNode) => {
  const nodes = childList(content);
  const leading: TextChild[] = [];

  for (const node of nodes) {
    if (!isTextChild(node)) {
      break;
    }

    leading.push(node);
  }

  return { rest: nodes.slice(leading.length), text: leading.join("") };
};
