import { toMarkdown } from "mdast-util-to-markdown";
import { describe, expect, it } from "vitest";

import type { FlowSpan } from "./flow-spans";
import { recordFlowSpans } from "./flow-spans";
import { MD_PROCESSOR, MD_STRINGIFY } from "./md-plugins";
import { parseMdast } from "./parse";

const DOCS = [
  "# Title\n\nA paragraph.\n\n- one\n- two\n\n1. first\n2. second\n\n> quote\n",
  // two adjacent lists the stringifier keeps apart, a rule and a fence
  "- a\n- b\n\n* c\n\n***\n\n```js\nx\n```\n",
  ":::toggle\ninside\n:::\n\n| a | b |\n| - | - |\n| 1 | 2 |\n",
];

interface Written {
  readonly text: string;
  readonly spans: readonly FlowSpan[];
}

const write = (md: string, spans: boolean): Written => {
  const { root } = parseMdast(md);
  const recorder = recordFlowSpans();
  const options = {
    ...MD_STRINGIFY,
    extensions: MD_PROCESSOR.data("toMarkdownExtensions") ?? [],
    handlers: spans ? { ...MD_STRINGIFY.handlers, root: recorder.root } : MD_STRINGIFY.handlers,
  };
  return { spans: recorder.spans, text: toMarkdown(root, options) };
};

describe("a root written with its children's spans", () => {
  it.each(DOCS)("writes the bytes the default root writes: %j", (md) => {
    expect(write(md, true).text).toBe(write(md, false).text);
  });

  it.each(DOCS)("spans each child, in order, with only joins between: %j", (md) => {
    const { spans, text } = write(md, true);
    const { root } = parseMdast(md);
    expect(spans).toHaveLength(root.children.length);
    for (const [index, span] of spans.entries()) {
      const next = spans[index + 1];
      expect(text.slice(span.start, span.end).trim()).not.toBe("");
      if (next !== undefined) {
        expect(text.slice(span.end, next.start)).toMatch(/^\n+(?:<!---->\n+)?$/u);
      }
    }
  });
});
