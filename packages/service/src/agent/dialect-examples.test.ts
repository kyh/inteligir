import { ElementApi, KEYS, NodeApi, TextApi } from "platejs";
import type { TElement } from "platejs";
import { describe, expect, it } from "vitest";

import {
  CANVAS_BLOCK_KEY,
  CHART_BLOCK_KEY,
  FORMULA_PILL_KEY,
  HTML_BLOCK_KEY,
  TAB_GROUP_KEY,
  TAB_PANEL_KEY,
} from "@repo/editor/headless/dialect-node-keys";
import { lettersKept } from "@repo/editor/headless/markdown/markdown-doc";
import { alertProp } from "@repo/editor/headless/node-props";
import {
  meaningOf,
  readValue,
  rewrite,
  writeValue,
} from "@repo/editor/test-support/markdown-meaning.test-utils";

import { AGENT_SYSTEM_PROMPT } from "./agent-prompt";

const FENCE_OPEN = /^(?<fence>`{3,}|~{3,})(?<info>[^`\s]*)/u;
const HEADING = /^(?<level>#{1,6}) (?<title>.+)$/u;

interface Example {
  site: string;
  body: string;
}

const markdownExamples = (text: string) => {
  const examples: Example[] = [];
  let section = "";
  let heading = "";
  let open: { fence: string; info: string; body: string[] } | null = null;

  for (const line of text.split("\n")) {
    if (open === null) {
      const fence = FENCE_OPEN.exec(line)?.groups;
      const title = HEADING.exec(line)?.groups;

      if (fence !== undefined) {
        open = { body: [], fence: fence.fence ?? "", info: fence.info ?? "" };
      } else if (title !== undefined) {
        heading = title.title ?? "";
        section = title.level === "#" ? heading : section;
      }

      continue;
    }

    const { fence } = open;
    const closing = line.trim();

    if (closing.length >= fence.length && [...closing].every((char) => char === fence[0])) {
      if (open.info === "markdown") {
        examples.push({
          body: `${open.body.join("\n")}\n`,
          site: section === heading ? section : `${section} › ${heading}`,
        });
      }

      open = null;
      continue;
    }

    open.body.push(line);
  }

  return examples;
};

const EXAMPLES = markdownExamples(AGENT_SYSTEM_PROMPT);

const ALERT = "alert";

const DIALECT_CONSTRUCTS = [
  KEYS.mention,
  KEYS.date,
  FORMULA_PILL_KEY,
  KEYS.toggle,
  KEYS.columnGroup,
  KEYS.column,
  TAB_GROUP_KEY,
  TAB_PANEL_KEY,
  CHART_BLOCK_KEY,
  CANVAS_BLOCK_KEY,
  HTML_BLOCK_KEY,
  ALERT,
];

const constructsOf = (value: readonly TElement[]) => {
  const found = new Set<string>();

  for (const block of value) {
    for (const [node] of NodeApi.nodes(block)) {
      if (ElementApi.isElement(node)) {
        found.add(
          node.type === KEYS.blockquote && alertProp(node) !== undefined ? ALERT : node.type,
        );
      }
    }
  }

  return found;
};

const CONSTRUCT_AS_WORDS = /:(?:date|formula)[[{]|\]\(mention:|\[\[|^:{3,}/mu;

const ESCAPED_CONSTRUCT = /\\:|\\\[\\\[|\\\[!/u;

const leftAsWords = (md: string) => {
  const value = readValue(md);

  const words = value.flatMap((block) =>
    [...NodeApi.nodes(block)].flatMap(([node, path]) => {
      const inCode = [...NodeApi.ancestors(block, path)].some(
        ([ancestor]) => ElementApi.isElement(ancestor) && ancestor.type === KEYS.codeBlock,
      );

      return TextApi.isText(node) &&
        node.code !== true &&
        !inCode &&
        CONSTRUCT_AS_WORDS.test(node.text)
        ? [node.text]
        : [];
    }),
  );

  const escaped = ESCAPED_CONSTRUCT.exec(writeValue(value))?.[0];

  return (escaped === undefined ? words : [...words, escaped]) satisfies string[];
};

describe("the prompt's markdown examples", () => {
  it("finds them at all", () => {
    expect(EXAMPLES.length).toBeGreaterThan(5);
  });

  it.each(EXAMPLES)("$site reads, keeps its meaning and letters, and settles", (example) => {
    const value = readValue(example.body);
    const saved = writeValue(value);
    expect(lettersKept(example.body, saved), `${example.site} loses words on a save`).toBe(1);
    expect(meaningOf(readValue(saved)), `${example.site} means another thing once saved`).toBe(
      meaningOf(value),
    );
    expect(rewrite(saved), `${example.site} still moves on its second save`).toBe(saved);
  });

  it.each(EXAMPLES)("$site leaves no construct it spells as words", (example) => {
    expect(leftAsWords(example.body)).toStrictEqual([]);
  });

  it("together show every construct only the dialect spells", () => {
    const shown = new Set(
      EXAMPLES.flatMap((example) => [...constructsOf(readValue(example.body))]),
    );

    expect(DIALECT_CONSTRUCTS.filter((construct) => !shown.has(construct))).toStrictEqual([]);
  });

  it("catches a construct spelled wrong", () => {
    const misspelled = [
      ':formula[4]{sourc="2+2"}',
      "due :date[2026-02-30]",
      "[[Queue Design]]",
      ":::note\nAside.\n:::",
      "> [!NOTES]\n> Aside.",
    ];

    expect(misspelled.filter((md) => leftAsWords(`${md}\n`).length === 0)).toStrictEqual([]);
    expect(leftAsWords("`:date[2026-08-22]` and :date[2026-08-22]\n")).toStrictEqual([]);
  });
});
