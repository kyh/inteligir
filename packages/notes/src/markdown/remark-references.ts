// A reference spells its address apart from its words (`[design doc][1]`, and `[1]: https://…`
// anywhere in the file), and the library holds neither: each reads as the link or image it names,
// which every reader after this one already knows, and a definition one used goes with it. A
// definition nothing used stays the line it is, as source (`./remark-opaque`). A footnote reads as
// the text the file spells: its call is the `[^label]` it wrote, and its definition its own blocks
// where it stood, led by `[^label]: `, so its words are searched like any others and an edit of a
// call's line alone reads it the same.

import type {
  Definition,
  FootnoteDefinition,
  FootnoteReference,
  Nodes,
  Paragraph,
  Root,
  Text,
} from "mdast";
import type { Transform } from "mdast-util-from-markdown";
import type { Plugin, Processor, Transformer } from "unified";
import { visit } from "unist-util-visit";

import { isMdastRoot } from "./mdast-nodes";
import { joinedText } from "./text-escapes";

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

type Point = NonNullable<Text["position"]>["start"];

const spanning = (start: Point | undefined, end: Point | undefined): Text["position"] =>
  start === undefined || end === undefined ? undefined : { end, start };

// a call's text joins the texts either side, so no block holds two leaves the editor would merge
const joinedSpan = (left: Text, right: Text): Text => ({
  ...joinedText(left, right),
  position: spanning(left.position?.start, right.position?.end),
});

const callText = (call: FootnoteReference): Text => ({
  position: call.position,
  type: "text",
  value: `[^${call.label ?? call.identifier}]`,
});

const callsAsText = (children: readonly Nodes[]): Nodes[] => {
  const read: Nodes[] = [];
  let holdsCall = false;
  for (const child of children) {
    const isCall = child.type === "footnoteReference";
    const node = isCall ? callText(child) : child;
    const last = read.at(-1);
    if (node.type === "text" && last?.type === "text" && (isCall || holdsCall)) {
      read[read.length - 1] = joinedSpan(last, node);
      holdsCall = true;
    } else {
      read.push(node);
      holdsCall = isCall;
    }
  }
  return read;
};

// the lead spans the bytes up to the first block, so a reader by offset finds its label there
const definitionBlocks = (definition: FootnoteDefinition): Nodes[] => {
  const lead = `[^${definition.label ?? definition.identifier}]:`;
  const [first, ...rest] = definition.children;
  const start = definition.position?.start;
  const position = spanning(start, first?.position?.start ?? definition.position?.end);
  if (first?.type !== "paragraph") {
    const alone: Paragraph = {
      children: [{ position, type: "text", value: lead }],
      position,
      type: "paragraph",
    };
    return [alone, ...definition.children];
  }
  const head: Text = { position, type: "text", value: `${lead} ` };
  const [text, ...after] = first.children;
  const led: Paragraph = {
    ...first,
    children:
      text?.type === "text" ? [joinedSpan(head, text), ...after] : [head, ...first.children],
    position: spanning(start, first.position?.end),
  };
  return [led, ...rest];
};

const isFootnote = (node: Nodes): boolean =>
  node.type === "footnoteReference" || node.type === "footnoteDefinition";

const asText = (node: Nodes): void => {
  if (!("children" in node)) {
    return;
  }
  for (const child of node.children) {
    asText(child);
  }
  const children: Nodes[] = node.children;
  if (children.some(isFootnote)) {
    const read = callsAsText(children).flatMap((child) =>
      child.type === "footnoteDefinition" ? definitionBlocks(child) : [child],
    );
    children.splice(0, children.length, ...read);
  }
};

const footnotesAsText: Transform = (tree) => {
  asText(tree);
};

export const remarkReferences: Plugin = function remarkReferences(this: Processor): Transformer {
  // pushed, so it runs after GFM's own transforms and the escapes' hand-on (`./text-escapes`),
  // which find the nodes they replaced by identity, and every reader of the parse meets text
  (this.data().fromMarkdownExtensions ??= []).push({ transforms: [footnotesAsText] });
  return (tree) => {
    if (isMdastRoot(tree)) {
      resolveReferences(tree);
    }
  };
};
