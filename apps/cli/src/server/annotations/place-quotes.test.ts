import { describe, expect, it } from "vitest";

import { markerRootIds } from "@repo/notes/annotations/marker-ids";

import { annotationPassages } from "./passage-text";
import { placeQuotes, stripAnnotationMarkers } from "./place-quotes";
import { canonicalCorpus, quotesOf, seededRandom } from "./test-support/quote-corpus";

const fold = (text: string): string => text.replaceAll(/\s+/gu, " ").trim();

const placeOne = (content: string, quote: string, occurrence?: number) =>
  placeQuotes(content, [{ id: "h1", occurrence, quote }], { final: false });

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

describe("where the markers land", () => {
  it("wraps the n-th occurrence", () => {
    const content = "the cat and the dog and the bird\n";
    expect(placeOne(content, "the", 2).content).toBe(
      "the cat and %%i:h1:start%%the%%i:h1:end%% dog and the bird\n",
    );
    expect(placeOne(content, "the", 4).missing).toEqual(["h1"]);
  });

  it("matches across whitespace and across blocks", () => {
    const content = "First   para\nends here.\n\nSecond starts here.\n";
    const placed = placeOne(content, "para ends here. Second starts");
    expect(placed.content).toBe(
      "First   %%i:h1:start%%para\nends here.\n\nSecond starts%%i:h1:end%% here.\n",
    );
    expect(annotationPassages(placed.content).get("h1")).toBe("para ends here. Second starts");
  });

  it("widens an edge inside an atomic inline to that inline's edge", () => {
    expect(placeOne("A **bold claim** here.\n", "bold").content).toBe(
      "A %%i:h1:start%%**bold claim**%%i:h1:end%% here.\n",
    );
    expect(placeOne("See [the whole text](https://x.com/a) now.\n", "whole").content).toBe(
      "See %%i:h1:start%%[the whole text](https://x.com/a)%%i:h1:end%% now.\n",
    );
    expect(placeOne("Due @2026-10-17 then.\n", "2026-10").content).toBe(
      "Due %%i:h1:start%%@2026-10-17%%i:h1:end%% then.\n",
    );
  });

  it("widens an edge inside a word to the word", () => {
    expect(placeOne("hello world\n", "ello").content).toBe(
      "%%i:h1:start%%hello%%i:h1:end%% world\n",
    );
  });

  it("never puts an end marker where a bare url would swallow it", () => {
    const placed = placeOne("see https://x.com/a, then more\n", "https://x.com/a");
    expect(placed.content).toBe("see %%i:h1:start%%https://x.com/a, %%i:h1:end%%then more\n");
    expect(markerRootIds(placed.content).has("h1")).toBe(true);
  });

  it("never splits an escape or sits beside a literal delimiter", () => {
    expect(placeOne("a snake_case_name here\n", "case").content).toBe(
      "a %%i:h1:start%%snake_case_name%%i:h1:end%% here\n",
    );
    expect(placeOne("price \\* two\n", "* two").content).toBe(
      "price %%i:h1:start%%\\* two%%i:h1:end%%\n",
    );
  });

  it("keeps a quote's and a list's line prefixes outside the markers", () => {
    expect(placeOne("> one line\n> two line\n", "line two").content).toBe(
      "> one %%i:h1:start%%line\n> two%%i:h1:end%% line\n",
    );
    expect(placeOne("- item one\n  continues here\n", "one continues").content).toBe(
      "- item %%i:h1:start%%one\n  continues%%i:h1:end%% here\n",
    );
  });

  it("shares one marker pair between quotes landing on one range", () => {
    const placed = placeQuotes(
      "Some shared words here.\n",
      [
        { id: "a1", quote: "shared words" },
        { id: "b2", quote: "shared   words" },
      ],
      { final: false },
    );
    expect(placed.content).toBe("Some %%i:a1,b2:start%%shared words%%i:a1,b2:end%% here.\n");
    expect(placed.placed).toEqual(["a1", "b2"]);
  });

  it("nests a range inside another at a shared edge", () => {
    const placed = placeQuotes(
      "one two three\n",
      [
        { id: "in", quote: "one two" },
        { id: "out", quote: "one two three" },
      ],
      { final: false },
    );
    expect(placed.content).toBe(
      "%%i:out:start%%%%i:in:start%%one two%%i:in:end%% three%%i:out:end%%\n",
    );
  });

  it("leaves a root that already has markers where it is", () => {
    const content = "a %%i:h1:start%%b%%i:h1:end%% c b\n";
    expect(placeOne(content, "b")).toEqual({
      appended: [],
      content,
      missing: [],
      placed: ["h1"],
    });
  });

  it("matches nothing in code, math or frontmatter", () => {
    const content = "---\ntitle: secret\n---\n\n```\nsecret\n```\n\n$$\nsecret\n$$\n";
    expect(placeOne(content, "secret").missing).toEqual(["h1"]);
  });
});

describe("a final placement", () => {
  it("appends what found no passage under a trailing Highlights heading, escaped", () => {
    const content = "---\nid: x\n---\n\nThe article.\n";
    const hostile = "[a](javascript:x) <b>b</b> {{1+1}} %%i:zz:start%% @2026-01-02 *e* `c`";
    const placed = placeQuotes(
      content,
      [
        { id: "h1", quote: "The article" },
        { id: "h2", quote: hostile },
      ],
      { final: true },
    );
    expect(placed).toMatchObject({ appended: ["h2"], missing: [], placed: ["h1"] });
    expect(placed.content).toBe(
      [
        "---",
        "id: x",
        "---",
        "",
        "%%i:h1:start%%The article%%i:h1:end%%.",
        "",
        "## Highlights",
        "",
        String.raw`> %%i:h2:start%%\[a]\(javascript:x) \<b>b\</b> \{{1+1}} \%%i:zz:start%% \@2026-01-02 \*e\* \`c\`%%i:h2:end%%`,
        "",
      ].join("\n"),
    );
    expect(annotationPassages(placed.content).get("h2")).toBe(hostile);
    expect(markerRootIds(placed.content)).toEqual(new Set(["h1", "h2"]));
  });

  it("adds a later quote to the Highlights section the text already ends in", () => {
    const first = placeQuotes("Body.\n", [{ id: "h1", quote: "gone" }], { final: true });
    const second = placeQuotes(first.content, [{ id: "h2", quote: "also gone" }], {
      final: true,
    });
    expect(second.content).toBe(
      [
        "Body.",
        "",
        "## Highlights",
        "",
        "> %%i:h1:start%%gone%%i:h1:end%%",
        "",
        "> %%i:h2:start%%also gone%%i:h2:end%%",
        "",
      ].join("\n"),
    );
  });

  it("starts the section on an empty body one blank line under the frontmatter", () => {
    expect(
      placeQuotes("---\nid: x\n---\n", [{ id: "h1", quote: "x" }], { final: true }).content,
    ).toBe("---\nid: x\n---\n\n## Highlights\n\n> %%i:h1:start%%x%%i:h1:end%%\n");
  });

  it("appends nothing without final", () => {
    const placed = placeQuotes("Body.\n", [{ id: "h1", quote: "gone" }], { final: false });
    expect(placed).toEqual({ appended: [], content: "Body.\n", missing: ["h1"], placed: [] });
  });
});

describe("stripping markers", () => {
  it("splices out exactly the named ids, keeping the rest of a shared pair", () => {
    const content = "x %%i:a1,b2:start%%y%%i:a1,b2:end%% %%i:c3:start%%z%%i:c3:end%%\n";
    expect(stripAnnotationMarkers(content, ["a1"])).toBe(
      "x %%i:b2:start%%y%%i:b2:end%% %%i:c3:start%%z%%i:c3:end%%\n",
    );
    expect(stripAnnotationMarkers(content, ["a1", "b2", "c3"])).toBe("x y z\n");
  });

  it("leaves a marker in code and an escaped one alone", () => {
    const content = "`%%i:a1:start%%` \\%%i:a1:end%% %%i:a1:start%%k%%i:a1:end%%\n";
    expect(stripAnnotationMarkers(content, ["a1"])).toBe("`%%i:a1:start%%` \\%%i:a1:end%% k\n");
  });
});
