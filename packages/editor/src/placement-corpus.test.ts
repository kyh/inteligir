// The placement every device runs (@repo/notes/annotations/place-quotes) held over the editor's
// canonical round-trip fixtures, every construct of the dialect among them, with quotes drawn from
// the text a person reads in each by the package's seeded generator. The fixtures are this
// package's, read off disk, which the pure package's own suites never do, so the corpus
// properties live with the corpus.

import { annotationPassages, projectPassages } from "@repo/notes/annotations/passage-text";
import { placeQuotes } from "@repo/notes/annotations/place-quotes";
import { markerRootIds, stripAnnotationMarkers } from "@repo/notes/test-support/annotation-markers";
import { mulberry32 } from "@repo/notes/test-support/seeded-random";
import { describe, expect, it } from "vitest";

import { canonicalCorpus, quotesOf } from "./test-support/quote-corpus";

const fold = (text: string): string => text.replaceAll(/\s+/gu, " ").trim();

describe("placing a quote over the canonical corpus", () => {
  const corpus = canonicalCorpus();
  const random = mulberry32(20_261_017);
  const cases = corpus.flatMap((doc) =>
    quotesOf(doc.content, random, 12).map((quote, index) => ({
      ...doc,
      id: `q${index}`,
      quote,
    })),
  );

  it("draws quotes from every fixture", () => {
    expect(new Set(cases.map((entry) => entry.name)).size).toBeGreaterThan(40);
  });

  // a placement per case, each a parse of a fixture, about a thousand in all
  it("only splices markers: stripping them gives back the input bytes", { timeout: 30_000 }, () => {
    for (const { content, id, quote } of cases) {
      const placed = placeQuotes(content, [{ id, quote }], { final: false });
      expect(stripAnnotationMarkers(placed.content, [id])).toBe(content);
    }
  });

  // a placement and two reads of its result per case
  it(
    "finds every placed id in the text, and its passage holds the quote",
    { timeout: 30_000 },
    () => {
      const placements = cases.map((entry) => ({
        ...entry,
        placed: placeQuotes(entry.content, [{ id: entry.id, quote: entry.quote }], {
          final: false,
        }),
      }));
      const landed = placements.filter(({ id, placed }) => placed.placed.includes(id));
      // a quote not placed is named missing, and nothing else is
      for (const { id, name, placed, quote } of placements.filter(
        (placement) => !landed.includes(placement),
      )) {
        expect(placed.missing, `${name}: ${quote}`).toStrictEqual([id]);
      }
      for (const { id, name, placed, quote } of landed) {
        expect(markerRootIds(placed.content).has(id), `${name}: ${quote}`).toBe(true);
        expect(annotationPassages(placed.content).get(id), `${name}: ${quote}`).toContain(
          fold(quote),
        );
      }
      expect(landed.length).toBeGreaterThan(cases.length * 0.9);
    },
  );

  // two placements per case over the first 120
  it("is deterministic: the same input places the same bytes", { timeout: 30_000 }, () => {
    for (const { content, id, quote } of cases.slice(0, 120)) {
      const first = placeQuotes(content, [{ id, quote }], { final: false });
      expect(placeQuotes(content, [{ id, quote }], { final: false })).toStrictEqual(first);
    }
  });
});

describe("the text a person reads, over the canonical corpus", () => {
  it("finds the markers the dialect's own parse finds", () => {
    for (const { content, name } of canonicalCorpus()) {
      expect(new Set(projectPassages(content).markers.keys()), name).toStrictEqual(
        markerRootIds(content),
      );
    }
  });
});
