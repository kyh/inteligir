// the placement every device runs (@repo/notes/annotations/place-quotes) held over the editor's
// canonical round-trip fixtures, every construct of the dialect among them, with quotes drawn from
// the text a person reads in each at a seeded random. The fixtures are read off disk, which the
// pure package's own suites never do, so the corpus properties live with the corpus.

import { markerRootIds } from "@repo/notes/annotations/marker-ids";
import { annotationPassages, projectPassages } from "@repo/notes/annotations/passage-text";
import { placeQuotes, stripAnnotationMarkers } from "@repo/notes/annotations/place-quotes";
import { describe, expect, it } from "vitest";

import { canonicalCorpus, quotesOf, seededRandom } from "./test-support/quote-corpus";

const fold = (text: string): string => text.replaceAll(/\s+/gu, " ").trim();

describe("placing a quote over the canonical corpus", () => {
  const corpus = canonicalCorpus();
  const random = seededRandom(20_261_017);
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

  it("only splices markers: stripping them gives back the input bytes", () => {
    for (const { content, id, quote } of cases) {
      const placed = placeQuotes(content, [{ id, quote }], { final: false });
      expect(stripAnnotationMarkers(placed.content, [id])).toBe(content);
    }
  });

  it("finds every placed id in the text, and its passage holds the quote", () => {
    let placedCount = 0;
    for (const { content, id, quote, name } of cases) {
      const placed = placeQuotes(content, [{ id, quote }], { final: false });
      if (!placed.placed.includes(id)) {
        expect(placed.missing, `${name}: ${quote}`).toEqual([id]);
        continue;
      }
      placedCount += 1;
      expect(markerRootIds(placed.content).has(id), `${name}: ${quote}`).toBe(true);
      expect(annotationPassages(placed.content).get(id), `${name}: ${quote}`).toContain(
        fold(quote),
      );
    }
    expect(placedCount).toBeGreaterThan(cases.length * 0.9);
  });

  it("is deterministic: the same input places the same bytes", () => {
    for (const { content, id, quote } of cases.slice(0, 120)) {
      const first = placeQuotes(content, [{ id, quote }], { final: false });
      expect(placeQuotes(content, [{ id, quote }], { final: false })).toEqual(first);
    }
  });
});

describe("the text a person reads, over the canonical corpus", () => {
  it("finds the markers the dialect's own transform finds", () => {
    for (const { content, name } of canonicalCorpus()) {
      expect(new Set(projectPassages(content).markers.keys()), name).toEqual(
        markerRootIds(content),
      );
    }
  });
});
