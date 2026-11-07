import { describe, expect, it } from "vitest";

import { markerRootIds } from "../test-support/annotation-markers";
import { annotationPassages } from "./passage-text";
import { placeQuotes } from "./place-quotes";

const placeOne = (content: string, quote: string, occurrence?: number) =>
  placeQuotes(content, [{ id: "h1", occurrence, quote }], { final: false });

describe("where the markers land", () => {
  it("wraps the n-th occurrence", () => {
    const content = "the cat and the dog and the bird\n";
    expect(placeOne(content, "the", 2).content).toBe(
      "the cat and %%i:h1:start%%the%%i:h1:end%% dog and the bird\n",
    );
    expect(placeOne(content, "the", 4).missing).toStrictEqual(["h1"]);
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

  it("finds a quote of a bare url whose address spells a call", () => {
    const placed = placeOne("see https://x.y/?q=[^a-z]+b now\n", "https://x.y/?q=[^a-z]+b");
    expect(placed.missing).toStrictEqual([]);
    expect(placed.content).toBe("see %%i:h1:start%%https://x.y/?q=[^a-z]+b %%i:h1:end%%now\n");
  });

  describe("in a cell of two lines", () => {
    const cell = (text: string) => `| a | b |\n| - | - |\n| ${text} | x |\n`;

    it("matches across the lines, each marker on its own line's bytes", () => {
      const placed = placeOne(cell("the one<br/>two here"), "one two");
      expect(placed.content).toBe(cell("the %%i:h1:start%%one<br/>two%%i:h1:end%% here"));
      expect(annotationPassages(placed.content).get("h1")).toBe("one two");
    });

    it("finds no word the two lines would make", () => {
      expect(placeOne(cell("one<br/>two"), "onetwo").missing).toStrictEqual(["h1"]);
    });

    it("places a quote of one line on that line", () => {
      expect(placeOne(cell("one<br/>two"), "one").content).toBe(
        cell("%%i:h1:start%%one%%i:h1:end%%<br/>two"),
      );
      expect(placeOne(cell("one<br/>two"), "two").content).toBe(
        cell("one<br/>%%i:h1:start%%two%%i:h1:end%%"),
      );
    });

    it("widens no edge past a line, as it widens none past a block", () => {
      expect(placeOne(cell("one*<br/>two"), "one").missing).toStrictEqual(["h1"]);
      expect(placeOne("one*\n\ntwo\n", "one").missing).toStrictEqual(["h1"]);
    });
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
    expect(placed.placed).toStrictEqual(["a1", "b2"]);
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
    expect(placeOne(content, "b")).toStrictEqual({
      appended: [],
      content,
      missing: [],
      placed: ["h1"],
    });
  });

  it("matches nothing in code, math or frontmatter", () => {
    const content = "---\ntitle: secret\n---\n\n```\nsecret\n```\n\n$$\nsecret\n$$\n";
    expect(placeOne(content, "secret").missing).toStrictEqual(["h1"]);
  });

  it("matches nothing in a footnote's definition, which stands as its source", () => {
    const content = "One[^a].\n\n[^a]: secret\n";
    expect(placeOne(content, "secret").missing).toStrictEqual(["h1"]);
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
    expect(markerRootIds(placed.content)).toStrictEqual(new Set(["h1", "h2"]));
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

  // a bare url an escape broke is found again in finished text, which once cost the date after it
  // its escape: the passage read the chip's date without its `@`
  it("reads an escaped date after a bare url back with its @", () => {
    const quote = "www.y.org' a www.y.org2026-01-02) @2026-01-02-$";
    const placed = placeQuotes("", [{ id: "h1", quote }], { final: true });
    expect(placed.appended).toStrictEqual(["h1"]);
    expect(placed.content).toContain("\\@2026-01-02-$%%i:h1:end%%");
    expect(annotationPassages(placed.content).get("h1")).toBe(quote);
  });

  it("appends nothing without final", () => {
    const placed = placeQuotes("Body.\n", [{ id: "h1", quote: "gone" }], { final: false });
    expect(placed).toStrictEqual({ appended: [], content: "Body.\n", missing: ["h1"], placed: [] });
  });
});
