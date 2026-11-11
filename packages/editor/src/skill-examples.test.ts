// the skills teach an agent the dialect by example, and an example the codec cannot hold is the
// agent taught to write bytes that lose what they say on a save, or that read as words where it
// meant a construct. read as files: @repo/agent-skills is content, never imported.

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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
} from "@repo/editor/dialect-node-keys";
import { alertMarkerPrefix } from "@repo/editor/markdown/alert-marker";
import { lettersKept } from "@repo/editor/markdown/markdown-doc";

import { meaningOf, readValue, rewrite, writeValue } from "./test-support/markdown-meaning";

const SKILLS_DIR = fileURLToPath(new URL("../../agent-skills/skills", import.meta.url));

const FENCE_OPEN = /^(?<fence>`{3,}|~{3,})(?<info>[^`\s]*)/u;

interface Example {
  site: string;
  body: string;
}

// a fence closes on a run of its own character at least as long as the one that opened it, so a
// ````markdown example may hold a ``` block of its own.
const markdownExamples = (file: string, text: string): Example[] => {
  const examples: Example[] = [];
  let open: { fence: string; info: string; line: number; body: string[] } | null = null;
  for (const [index, line] of text.split("\n").entries()) {
    if (open === null) {
      const groups = FENCE_OPEN.exec(line)?.groups;
      if (groups !== undefined) {
        open = { body: [], fence: groups.fence ?? "", info: groups.info ?? "", line: index + 1 };
      }
      continue;
    }
    const { fence } = open;
    const closing = line.trim();
    if (closing.length >= fence.length && [...closing].every((char) => char === fence[0])) {
      if (open.info === "markdown") {
        examples.push({ body: `${open.body.join("\n")}\n`, site: `${file}:${String(open.line)}` });
      }
      open = null;
      continue;
    }
    open.body.push(line);
  }
  return examples;
};

const EXAMPLES = readdirSync(SKILLS_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .flatMap((entry) =>
    markdownExamples(
      `packages/agent-skills/skills/${entry.name}/SKILL.md`,
      readFileSync(`${SKILLS_DIR}/${entry.name}/SKILL.md`, "utf-8"),
    ),
  );

const ALERT = "alert";

// every construct only the dialect spells, as the node a read makes of it
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

// what each element of a value reads as; a quote led by an alert's marker is that alert
const constructsOf = (value: readonly TElement[]): Set<string> => {
  const found = new Set<string>();
  for (const block of value) {
    for (const [node] of NodeApi.nodes(block)) {
      if (ElementApi.isElement(node)) {
        found.add(
          node.type === KEYS.blockquote && alertMarkerPrefix(NodeApi.string(node)) !== null
            ? ALERT
            : node.type,
        );
      }
    }
  }
  return found;
};

// a construct's spelling a read left in words: a directive the dialect did not read, a page link
// by title nothing resolved, or a colon block's marker line
const CONSTRUCT_AS_WORDS = /:(?:date|formula)[[{]|\]\(mention:|\[\[|^:{3,}/mu;

// what the writer escapes so that words stay words: a colon before a dialect name, a page link by
// title, and a quote's marker that is no alert
const ESCAPED_CONSTRUCT = /\\:|\\\[\\\[|\\\[!/u;

// the spellings an example's read left as words, outside code, and its write escaped
const leftAsWords = (md: string): string[] => {
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
  return escaped === undefined ? words : [...words, escaped];
};

describe("the skills' markdown examples", () => {
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
