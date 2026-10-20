// The dialect reads its pills, dates, annotation markers and `:::` lines out of finished text, where
// micromark has already folded a backslash escape into the character it spells. So the parse
// keeps, on each text node, which characters an escape wrote, and a construct whose first
// character is one stays text: the escape the serializer writes before a text that would read
// back as a construct.

import type { Text } from "mdast";
import type { CompileContext, Extension as FromMarkdownExtension } from "mdast-util-from-markdown";
import type { Plugin, Processor } from "unified";

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

export const remarkTextEscapes: Plugin = function remarkTextEscapes(this: Processor): undefined {
  (this.data().fromMarkdownExtensions ??= []).push(escapesFromMarkdown);
};
