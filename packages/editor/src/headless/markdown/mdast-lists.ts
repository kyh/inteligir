// A block nested in a list item, and a list line after one, in mdast alone: the rules mark it with
// its depth, and it rides beside its list until its container is written.

import type { BlockContent, DefinitionContent, List, ListItem, RootContent } from "mdast";

declare module "mdast" {
  interface Data {
    // the depth a block nested in a list item, or a list line after one, rides to `nestInLists`
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

// the list item `depth` levels down a list's last items
const itemAt = (list: List, depth: number): ListItem | null => {
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

// a block marked with its list depth goes into the item it nests under, which is how markdown
// spells a block inside a list item; with no list before it, it stands where it is
// Plate ends a list at the first block that is not an item, so a list line after a nested block,
// marked with its depth, goes on as an item of the list it continues there (the list before it at
// depth 1, deeper the last list of the item above it) or opens a list there; an item holding a
// block is loose, since a tight item writes a table and the paragraph after it as one table
export const nestInLists = <Node extends RootContent>(children: readonly Node[]): Node[] => {
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
      // an item with no words opens with its block, since `-` then a blank line is an empty item
      // and what follows stands outside the list
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
