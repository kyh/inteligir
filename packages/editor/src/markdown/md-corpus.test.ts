import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ElementApi, NodeApi } from "platejs";
import type { TElement } from "platejs";

import { meaningOf, readValue, writeValue } from "../test-support/markdown-meaning";
import { lettersKept } from "./markdown-doc";

const FIXTURES = fileURLToPath(new URL("../test-support/fixtures/", import.meta.url));

// a list of the kind people keep: times, quotes, a url, an at-name, money and dates
const PROSE_LIST = Array.from({ length: 30 }, (_, index) => {
  const n = index + 1;
  const lines = [
    `- Meeting at 10:${String(n).padStart(2, "0")} with Ana: review the Q${String((n % 4) + 1)} plan, then ship it.`,
    `- Read "Thinking, Fast and Slow" (ch. ${String(n)}) — *note* the anchoring bias; see https://example.com/${String(n)}.`,
    `- Call @Sam re: invoice #${String(1000 + n)}; costs $${String(n * 3)}.50 and 20% tax.`,
    `- Draft: **why** the cache (L${String(n)}) misses ~${String(n)}% of reads under load.`,
    `- Buy milk, eggs & bread; ask about the 2026-01-${String((n % 28) + 1).padStart(2, "0")} delivery.`,
  ];
  return lines[index % lines.length] ?? "";
}).join("\n");

const CORPUS = [
  ...(["corpus", "frontmatter"] as const).flatMap((dir) =>
    readdirSync(`${FIXTURES}${dir}`)
      .toSorted()
      .map((file) => ({ md: readFileSync(`${FIXTURES}${dir}/${file}`, "utf-8"), name: file })),
  ),
  { md: PROSE_LIST, name: "prose-list" },
];

// the share of a file's letters a write keeps where it keeps fewer than all: what stock markdown
// cannot hold (an inline tag's markup, an entity decoded, a mail link's address beside its words)
const KEPT_BELOW_ALL = new Map([
  ["entities.md", 0.4375],
  ["mailto-resource.md", 0.2857],
  ["tag-void-inline.md", 0.8378],
]);

const LINK_TYPES = new Set(["a", "mention"]);
const MEDIA_TYPES = new Set(["img", "video", "file", "media_embed"]);

const counts = (value: readonly TElement[]) => {
  let links = 0;
  let media = 0;
  for (const [node] of value.flatMap((block) => [...NodeApi.nodes(block)])) {
    if (ElementApi.isElement(node)) {
      links += LINK_TYPES.has(node.type) ? 1 : 0;
      media += MEDIA_TYPES.has(node.type) ? 1 : 0;
    }
  }
  return { links, media };
};

describe.each(CORPUS)("$name", ({ md, name }) => {
  const first = readValue(md);
  const written = writeValue(first);
  const second = readValue(written);

  it("keeps the letters it wrote", () => {
    expect(lettersKept(md, written)).toBeGreaterThanOrEqual(KEPT_BELOW_ALL.get(name) ?? 1);
  });

  it("reads back the links and the media it read", () => {
    expect(counts(second)).toStrictEqual(counts(first));
  });

  it("writes its own fixpoint, which reads back as itself", () => {
    expect(writeValue(second)).toBe(written);
    expect(meaningOf(readValue(writeValue(second)))).toBe(meaningOf(second));
  });
});

describe("the corpus", () => {
  it("holds every file it keeps fewer letters of", () => {
    const names = new Set(CORPUS.map(({ name }) => name));
    expect([...KEPT_BELOW_ALL.keys()].filter((name) => !names.has(name))).toStrictEqual([]);
  });
});
