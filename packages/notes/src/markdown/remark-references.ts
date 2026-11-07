// A reference spells its address apart from its words (`[design doc][1]`, and `[1]: https://…`
// anywhere in the file), and the library holds neither: each reads as the link or image it names,
// which every reader after this one already knows, and a definition one used goes with it. A
// definition nothing used stays the line it is, as source (`./remark-opaque`).

import type { Definition, Nodes, Root } from "mdast";
import type { Plugin, Transformer } from "unified";
import { visit } from "unist-util-visit";

import { isMdastRoot } from "./mdast-nodes";

// the first definition of a label is the one a reference means
const definitionsIn = (tree: Root): ReadonlyMap<string, Definition> => {
  const definitions = new Map<string, Definition>();
  visit(tree, "definition", (node) => {
    if (!definitions.has(node.identifier)) {
      definitions.set(node.identifier, node);
    }
  });
  return definitions;
};

const named = (
  node: Nodes,
  definitions: ReadonlyMap<string, Definition>,
  used: Set<Definition>,
): Nodes | null => {
  if (node.type !== "linkReference" && node.type !== "imageReference") {
    return null;
  }
  const definition = definitions.get(node.identifier);
  if (definition === undefined) {
    return null;
  }
  used.add(definition);
  const { title, url } = definition;
  const { position } = node;
  return node.type === "linkReference"
    ? { children: node.children, position, title, type: "link", url }
    : { alt: node.alt, position, title, type: "image", url };
};

const resolveReferences = (tree: Root): void => {
  const definitions = definitionsIn(tree);
  if (definitions.size === 0) {
    return;
  }
  const used = new Set<Definition>();
  visit(tree, (node, index, parent) => {
    const read = named(node, definitions, used);
    if (read !== null && parent !== undefined && index !== undefined) {
      const siblings: Nodes[] = parent.children;
      siblings[index] = read;
    }
  });
  visit(tree, (node) => {
    if ("children" in node) {
      const children: Nodes[] = node.children;
      for (let at = children.length - 1; at >= 0; at -= 1) {
        const child = children[at];
        if (child?.type === "definition" && used.has(child)) {
          children.splice(at, 1);
        }
      }
    }
  });
};

export const remarkReferences: Plugin = function remarkReferences(): Transformer {
  return (tree) => {
    if (isMdastRoot(tree)) {
      resolveReferences(tree);
    }
  };
};
