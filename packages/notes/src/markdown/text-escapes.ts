// The dialect reads its pills, dates, annotation markers and `:::` lines out of finished text, where
// micromark has already folded a backslash escape into the character it spells. So the parse
// keeps, on each text node, which characters an escape wrote, and a construct whose first
// character is one stays text: the escape the serializer writes before a text that would read
// back as a construct.
//
// GFM finds a bare url micromark did not (one an escape broke, `www\.example.org`) in finished
// text too, splitting its text node into new ones that carry no data
// (mdast-util-gfm-autolink-literal through mdast-util-find-and-replace). So the parse notes each
// parent's children before that transform and, after it, hands a replaced node's escapes on to the
// nodes that took its place, by where their text falls in its own: their text, read in order, is
// the text it held.

import type { Nodes, Parent, Root, Text } from "mdast";
import type {
  CompileContext,
  Extension as FromMarkdownExtension,
  Transform,
} from "mdast-util-from-markdown";
import type { Plugin, Processor } from "unified";
import { visit } from "unist-util-visit";

declare module "mdast" {
  interface TextData {
    // ascending offsets into `value`
    escapes?: number[];
  }
}

// an escape's value lands on the text node it ends, the last child of what is open
const escapesFromMarkdown: FromMarkdownExtension = {
  exit: {
    characterEscape(this: CompileContext) {
      const open = this.stack.at(-1);
      const tail = open !== undefined && "children" in open ? open.children.at(-1) : undefined;
      if (tail?.type === "text") {
        tail.data ??= {};
        (tail.data.escapes ??= []).push(tail.value.length - 1);
      }
    },
  },
};

export const escapedAt = (node: Text, index: number): boolean => {
  const escapes = node.data?.escapes ?? [];
  let low = 0;
  let high = escapes.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((escapes[middle] ?? index) < index) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return escapes[low] === index;
};

// cuts of one text node taken left to right, each carrying the escapes inside it; one pass over
// the escapes however many cuts, since a paragraph is cut at every line
export const textCutter = (node: Text): ((start: number, end: number) => Text) => {
  const escapes = node.data?.escapes ?? [];
  let next = 0;
  return (start, end) => {
    const value = node.value.slice(start, end);
    const inside: number[] = [];
    for (; next < escapes.length; next += 1) {
      const at = escapes[next] ?? end;
      if (at >= end) {
        break;
      }
      if (at >= start) {
        inside.push(at - start);
      }
    }
    return inside.length === 0
      ? { type: "text", value }
      : { data: { escapes: inside }, type: "text", value };
  };
};

// GFM takes the space after a todo's checkbox off the item's first text only as its paragraph
// closes, so the escapes noted while that text was read each stand one too far along
const alignTodoEscapes: Transform = (tree) => {
  visit(tree, "listItem", (item) => {
    const line = item.children.find((child) => child.type === "paragraph");
    const head = line?.children[0];
    if (typeof item.checked === "boolean" && head?.type === "text" && head.data !== undefined) {
      head.data.escapes = head.data.escapes?.map((at) => at - 1);
    }
  });
};

const escapesOf = (node: Nodes): readonly number[] =>
  node.type === "text" ? (node.data?.escapes ?? []) : [];

// each parent holding an escaped text node, with its children as they stood before GFM's transform
const noted = new WeakMap<Root, Map<Parent, readonly Nodes[]>>();

const noteChildren: Transform = (tree) => {
  const parents = new Map<Parent, readonly Nodes[]>();
  visit(tree, (node) => {
    if ("children" in node && node.children.some((child) => escapesOf(child).length > 0)) {
      parents.set(node, [...node.children]);
    }
  });
  noted.set(tree, parents);
};

// every text leaf of a run of nodes, in reading order, a link's text among them
const textLeaves = (nodes: readonly Nodes[]): Text[] =>
  nodes.flatMap((node) => {
    if (node.type === "text") {
      return [node];
    }
    return "children" in node ? textLeaves(node.children) : [];
  });

const handOn = (escapes: readonly number[], run: readonly Nodes[]): void => {
  let offset = 0;
  let next = 0;
  for (const leaf of textLeaves(run)) {
    const end = offset + leaf.value.length;
    const inside: number[] = [];
    for (; next < escapes.length && (escapes[next] ?? end) < end; next += 1) {
      inside.push((escapes[next] ?? offset) - offset);
    }
    if (inside.length > 0) {
      leaf.data ??= {};
      leaf.data.escapes = inside;
    }
    offset = end;
  }
};

// where the first of `later` still standing in `after` stands, at or past `from`
const nextStanding = (later: readonly Nodes[], after: readonly Nodes[], from: number): number => {
  for (const node of later) {
    const found = after.indexOf(node, from);
    if (found !== -1) {
      return found;
    }
  }
  return after.length;
};

const handOnEscapes: Transform = (tree) => {
  const parents = noted.get(tree);
  noted.delete(tree);
  for (const [parent, before] of parents ?? []) {
    const after: readonly Nodes[] = parent.children;
    let at = 0;
    for (const [index, old] of before.entries()) {
      const kept = after.indexOf(old, at);
      if (kept !== -1) {
        at = kept + 1;
        continue;
      }
      // the nodes that replaced it run up to the next of the old children still standing
      const end = nextStanding(before.slice(index + 1), after, at);
      handOn(escapesOf(old), after.slice(at, end));
      at = end;
    }
  }
};

export const remarkTextEscapes: Plugin = function remarkTextEscapes(this: Processor): undefined {
  const data = this.data();
  data.fromMarkdownExtensions ??= [];
  // the note before every other extension's transform, GFM's literal autolinks among them, and the
  // escapes' own exit and their hand-on after them
  data.fromMarkdownExtensions.unshift({ transforms: [alignTodoEscapes, noteChildren] });
  data.fromMarkdownExtensions.push(escapesFromMarkdown, { transforms: [handOnEscapes] });
};
