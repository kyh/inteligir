import { describe, expect, it } from "vitest";

import { RAINDROP_EXPORT as FIXTURE } from "../test-support/raindrop-export.test-utils";
import { planBookmarks } from "./bookmark-plan";
import { parseRaindropCsv, parseRaindropHighlights } from "./raindrop-csv";

const NOW = Date.UTC(2026, 9, 17, 9, 0, 0);

const rowsOf = (text: string) => {
  const parsed = parseRaindropCsv(text);

  if (!parsed.ok) {
    throw new Error(parsed.reason);
  }

  return parsed.rows;
};

describe(parseRaindropCsv, () => {
  it("reads the export's rows and counts those it leaves out", () => {
    const parsed = parseRaindropCsv(FIXTURE);

    if (!parsed.ok) {
      throw new Error(parsed.reason);
    }

    expect(parsed.rows).toHaveLength(7);
    expect(parsed.skipped).toBe(3);
    const [first] = parsed.rows;
    expect(first).toMatchObject({
      cover: "https://stephango.com/og.jpg",
      created: "2023-07-01T09:12:30.000Z",
      excerpt:
        "If you want to create digital artifacts that last, they must be files you can control.",
      favorite: true,
      folder: ["Reading"],
      note: "For Tuesday.",
      tags: ["philosophy", "files"],
      title: "File over app",
    });
    expect(parsed.rows.at(-1)).toMatchObject({
      note: "A note,\nover two lines.",
      title: 'Commas, "quotes" and\nlines',
    });
  });

  it("reads the header by name, in any order and case, ignoring columns it does not know", () => {
    const rows = rowsOf("Extra,URL,Title,TAGS\nx,https://a.example/,A,one\n");
    expect(rows).toMatchObject([
      { folder: [], tags: ["one"], title: "A", url: "https://a.example/" },
    ]);
  });

  it("files no row of a per-collection export, which has no folder column", () => {
    const plan = planBookmarks(rowsOf("title,url\nA,https://a.example/\n"), NOW);
    expect(plan.items.map((item) => item.folder)).toStrictEqual([null]);
  });

  it("refuses a file that is no Raindrop export, saying how", () => {
    expect(parseRaindropCsv('a,"b\n')).toStrictEqual({ ok: false, reason: "not-csv" });
    expect(parseRaindropCsv("title,link\nA,https://a.example/\n")).toStrictEqual({
      ok: false,
      reason: "no-url-column",
    });
    expect(parseRaindropCsv("title,url\n")).toStrictEqual({ ok: false, reason: "empty" });
    expect(parseRaindropCsv("")).toStrictEqual({ ok: false, reason: "empty" });
  });

  it("skips a byte-order mark and blank lines, and reads a stray quote as the character it is", () => {
    expect(rowsOf('\uFEFFurl,title\r\n\r\nhttps://a.example/,Say "hi"\r\n')).toMatchObject([
      { title: 'Say "hi"', url: "https://a.example/" },
    ]);
  });
});

describe(parseRaindropHighlights, () => {
  it("opens a block at each Highlight line and its note at a Note line", () => {
    expect(
      parseRaindropHighlights(
        "Highlight: Files last.\nNote: The point.\n\nhighlight : Apps are ephemeral,\nbut files are not.",
      ),
    ).toStrictEqual([
      { note: "The point.", quote: "Files last." },
      { note: "", quote: "Apps are ephemeral,\nbut files are not." },
    ]);
  });

  it("reads a cell with no Highlight line as one quote", () => {
    expect(parseRaindropHighlights("  Use the zest.  ")).toStrictEqual([
      { note: "", quote: "Use the zest." },
    ]);
    expect(parseRaindropHighlights("")).toStrictEqual([]);
  });
});
