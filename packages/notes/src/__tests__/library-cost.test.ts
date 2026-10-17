import { describe, expect, it } from "vitest";

import { NOTE_FACTS } from "../items/item-frontmatter";
import type { ItemFacts } from "../items/item-frontmatter";
import type { ItemQuery } from "../items/library-index";
import { LinkGraphIndex } from "../knowledge/link-graph-index";
import { buildResolver, createPathResolver } from "../knowledge/link-resolve";
import type { DocProjection } from "../knowledge/projection";

// ratios rather than wall-clock ceilings, so a slow or loaded runner cannot fail them; the fastest
// of each size, so one GC pause or scheduler stall cannot stand for the cost
const ROUNDS = 7;

const linkFacts = (i: number): ItemFacts => ({
  ...NOTE_FACTS,
  hasId: true,
  host: "example.com",
  kind: i % 3 === 0 ? "note" : "link",
  savedMs: 1_700_000_000_000 + i * 1000,
  url: `https://example.com/${String(i)}`,
  urlKey: `example.com/${String(i)}`,
});

const projectionOf = (i: number): DocProjection => ({
  aliases: [],
  headings: [],
  item: linkFacts(i),
  links: [
    { embed: true, kind: "image", line: 1, snippet: "", target: `assets/covers/${String(i)}.jpg` },
  ],
  noteId: null,
  pinned: i % 997 === 0,
  preview: "A line of text.",
  tags: i % 5 === 0 ? ["reading"] : [],
  title: `Item ${String(i)}`,
});

const libraryOf = (size: number): LinkGraphIndex => {
  const graph = new LinkGraphIndex();
  for (let i = 0; i < size; i += 1) {
    const folder = `folder-${String(i % 50)}`;
    graph.applyDoc(`${folder}/item-${String(i)}.md`, projectionOf(i));
    graph.setOther(`assets/covers/${String(i)}.jpg`);
  }
  return graph;
};

const PAGE: ItemQuery = { limit: 100, offset: 0, sort: "saved", subfolders: true, untagged: false };

const fastest = (run: () => void): number => {
  let best = Number.POSITIVE_INFINITY;
  for (let round = 0; round < ROUNDS; round += 1) {
    const began = performance.now();
    run();
    best = Math.min(best, performance.now() - began);
  }
  return best;
};

describe("the library at scale", () => {
  it("answers a page of 50k items at most 8x the cost of one of 5k", { timeout: 120_000 }, () => {
    const small = libraryOf(5000);
    const large = libraryOf(50_000);
    // the first ask builds the sort; the cost measured is a page's
    small.items(PAGE);
    large.items(PAGE);
    const smallMs = fastest(() => small.items(PAGE));
    const largeMs = fastest(() => large.items(PAGE));
    expect(largeMs / Math.max(smallMs, 0.01)).toBeLessThanOrEqual(8);
  });

  it(
    "files one new path after 100k at most 1/100 of a build over them",
    { timeout: 120_000 },
    () => {
      const paths = Array.from(
        { length: 100_000 },
        (_, i) => `f-${String(i % 100)}/n-${String(i)}.md`,
      );
      const buildMs = fastest(() => buildResolver(paths));
      const live = createPathResolver();
      for (const path of paths) {
        live.addPath(path);
      }
      let next = 0;
      const addMs =
        fastest(() => {
          for (let i = 0; i < 100; i += 1) {
            live.addPath(`new/n-${String(next)}.md`);
            next += 1;
          }
        }) / 100;
      expect(addMs).toBeLessThanOrEqual(buildMs / 100);
    },
  );
});
