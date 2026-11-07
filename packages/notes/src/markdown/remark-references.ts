// A reference spells its address apart from its words (`[design doc][1]`, and `[1]: https://…`
// anywhere in the file), and the library holds neither: each reads as the link or image it names,
// which every reader after this one already knows, and a definition one used goes with it. A
// definition nothing used stays the line it is, as source (`./remark-opaque`). A footnote's call
// reads only beside its definition, and an edit re-reads the stretch it touched alone, so a call
// left in finished text is held here too: typed text that spells one has its `[` escaped, and a bare
// link is the address it spells, with no label for a call to stand in. This runs after
// `./remark-containers`, so a tab's label keeps the words it spells.

import type { Definition, Nodes, Parent, PhrasingContent, Root, RootContent, Text } from "mdast";
import type { Plugin, Transformer } from "unified";
import { visit } from "unist-util-visit";

import { besideChild, isBareLink } from "./autolink-text";
import type { Range } from "./line-scan";
import { isMdastRoot } from "./mdast-nodes";
import { escapedAt, textCutter } from "./text-escapes";

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

// global, so for matchAll alone
const FOOTNOTE_CALL_RE = /\[\^[^\s[\]]+\]/gu;

const anyEscaped = ({ end, start }: Range, escaped: (index: number) => boolean): boolean => {
  for (let index = start; index < end; index += 1) {
    if (escaped(index)) {
      return true;
    }
  }
  return false;
};

// the calls finished text still spells; an escape anywhere in one is what micromark reads as no call
export const footnoteCallsIn = (value: string, escaped: (index: number) => boolean): Range[] =>
  [...value.matchAll(FOOTNOTE_CALL_RE)]
    .map((match) => ({ end: match.index + match[0].length, start: match.index }))
    .filter((call) => !anyEscaped(call, escaped));

const heldCallsIn = (node: Text): PhrasingContent[] => {
  const cut = textCutter(node);
  const read: PhrasingContent[] = [];
  let cursor = 0;
  for (const { end, start } of footnoteCallsIn(node.value, (at) => escapedAt(node, at))) {
    if (start > cursor) {
      read.push(cut(cursor, start));
    }
    read.push({ type: "opaqueInline", value: node.value.slice(start, end) });
    cursor = end;
  }
  return cursor === 0
    ? [node]
    : [...read, ...(cursor < node.value.length ? [cut(cursor, node.value.length)] : [])];
};

const holdFootnoteCalls = (parent: Parent): void => {
  parent.children = parent.children.flatMap((child, index, siblings): RootContent[] => {
    if (child.type === "text") {
      return heldCallsIn(child);
    }
    if (
      "children" in child &&
      !(child.type === "link" && isBareLink(child, besideChild(siblings, index)))
    ) {
      holdFootnoteCalls(child);
    }
    return [child];
  });
};

export const remarkReferences: Plugin = function remarkReferences(): Transformer {
  return (tree) => {
    if (isMdastRoot(tree)) {
      resolveReferences(tree);
      holdFootnoteCalls(tree);
    }
  };
};
