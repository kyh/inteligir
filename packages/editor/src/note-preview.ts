// What a link's hover card shows of the item it names: the first lines of its blocks as plain text,
// a link written as its chip reads, a date and a formula as they show, and no marker, picture or
// rich block. A tooltip earns a walk of the blocks, never a serialization.

import { ElementApi, TextApi } from "platejs";
import type { TElement } from "platejs";

import { shownText } from "@repo/editor/shown-text";

const PREVIEW_MAX_LINES = 20;

// the blocks that are lines of their own when a container holds them
const LINE_BLOCKS = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "code_line", "td", "th"]);

// a block's lines: a paragraph or heading is one, a container gives one per line block it holds
const linesOf = (element: TElement): string[] => {
  if (LINE_BLOCKS.has(element.type) || element.children.every(TextApi.isText)) {
    return [shownText(element)];
  }
  return element.children.flatMap((child) =>
    ElementApi.isElement(child) ? linesOf(child) : [shownText(child)],
  );
};

export const notePreviewHead = (blocks: readonly TElement[]): string => {
  const lines: string[] = [];
  for (const raw of blocks.flatMap(linesOf).flatMap((text) => text.split("\n"))) {
    if (lines.length >= PREVIEW_MAX_LINES) {
      break;
    }
    const line = raw.trimEnd();
    if (line.trim() === "" && (lines.length === 0 || lines.at(-1) === "")) {
      continue;
    }
    lines.push(line.trim() === "" ? "" : line);
  }
  while (lines.length > 0 && lines.at(-1) === "") {
    lines.pop();
  }
  return lines.join("\n");
};
