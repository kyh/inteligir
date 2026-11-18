import type { BlockContent, DefinitionContent, List, RootContent } from "mdast";

declare module "mdast" {
  interface Data {
    listDepth?: number;
  }
}

export type FlowContent = BlockContent | DefinitionContent;

const FLOW_TYPES: ReadonlySet<string> = new Set([
  "blockquote",
  "code",
  "containerDirective",
  "definition",
  "footnoteDefinition",
  "heading",
  "html",
  "leafDirective",
  "list",
  "math",
  "paragraph",
  "table",
  "thematicBreak",
  "yaml",
]);

export const isFlow = (node: { type: string }): node is FlowContent => FLOW_TYPES.has(node.type);

const isList = (node: RootContent | undefined): node is List => node?.type === "list";

const itemAt = (list: List, depth: number) => {
  let item = list.children.at(-1) ?? null;

  for (let level = 1; level < depth && item !== null; level += 1) {
    const last = item.children.at(-1);

    if (last?.type !== "list") {
      break;
    }

    item = last.children.at(-1) ?? null;
  }

  return item;
};

const continues = (list: RootContent | undefined, line: List): list is List =>
  isList(list) && list.ordered === line.ordered;

export const nestInLists = <Node extends RootContent>(children: readonly Node[]) => {
  const out: Node[] = [];

  for (const child of children) {
    const depth = child.data?.listDepth ?? null;
    const last = out.at(-1);
    const item = depth !== null && isList(last) ? itemAt(last, depth - 1) : null;

    if (depth === 1 && isList(child) && continues(last, child)) {
      last.children.push(...child.children);
    } else if (depth !== 1 && item !== null && isList(child)) {
      const tail = item.children.at(-1);

      if (continues(tail, child)) {
        tail.children.push(...child.children);
      } else {
        item.children.push(child);
      }
    } else if (item !== null && !isList(child) && isFlow(child)) {
      const [head, ...rest] = item.children;

      const wordless =
        rest.length === 0 &&
        head?.type === "paragraph" &&
        head.children.every((leaf) => leaf.type === "text" && leaf.value === "");

      item.children = wordless ? [child] : [...item.children, child];
      item.spread = true;
    } else {
      out.push(child);
    }
  }

  return out;
};
