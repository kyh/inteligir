import { describe, expect, it } from "vitest";

import {
  parseRaindropCsv,
  parseRaindropHighlights,
  planRaindropImport,
  toTagName,
} from "./raindrop";
import type { RaindropRow } from "./raindrop";
import { RAINDROP_EXPORT as FIXTURE } from "./test-support/raindrop-export";

const NOW = Date.UTC(2026, 9, 17, 9, 0, 0);

const rowsOf = (text: string): RaindropRow[] => {
  const parsed = parseRaindropCsv(text);
  if (!parsed.ok) {
    throw new Error(parsed.reason);
  }
  return parsed.rows;
};

describe("parseRaindropCsv", () => {
  it("reads the export's rows and says why the others were left out", () => {
    const parsed = parseRaindropCsv(FIXTURE);
    if (!parsed.ok) {
      throw new Error(parsed.reason);
    }
    expect(parsed.rows.map((row) => row.record)).toEqual([1, 2, 3, 7, 8, 9, 10]);
    expect(parsed.skipped).toEqual([
      { reason: "in-trash", record: 4 },
      { reason: "no-url", record: 5 },
      { reason: "not-web-url", record: 6 },
    ]);
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

  it("puts every row of a per-collection export, which has no folder column, in Unsorted", () => {
    const plan = planRaindropImport(rowsOf("title,url\nA,https://a.example/\n"), NOW);
    expect(plan.items.map((item) => item.folder)).toEqual(["Unsorted"]);
  });

  it("refuses a file that is no Raindrop export, saying how", () => {
    expect(parseRaindropCsv('a,"b\n')).toEqual({ ok: false, reason: "not-csv" });
    expect(parseRaindropCsv("title,link\nA,https://a.example/\n")).toEqual({
      ok: false,
      reason: "no-url-column",
    });
    expect(parseRaindropCsv("title,url\n")).toEqual({ ok: false, reason: "empty" });
    expect(parseRaindropCsv("")).toEqual({ ok: false, reason: "empty" });
  });
});

describe("parseRaindropHighlights", () => {
  it("opens a block at each Highlight line and its note at a Note line", () => {
    expect(
      parseRaindropHighlights(
        "Highlight: Files last.\nNote: The point.\n\nhighlight : Apps are ephemeral,\nbut files are not.",
      ),
    ).toEqual([
      { note: "The point.", quote: "Files last." },
      { note: "", quote: "Apps are ephemeral,\nbut files are not." },
    ]);
  });

  it("reads a cell with no Highlight line as one quote", () => {
    expect(parseRaindropHighlights("  Use the zest.  ")).toEqual([
      { note: "", quote: "Use the zest." },
    ]);
    expect(parseRaindropHighlights("")).toEqual([]);
  });
});

describe("toTagName", () => {
  it.each([
    ["philosophy", "philosophy"],
    ["#Quick Meals", "Quick-Meals"],
    ["machine   learning", "machine-learning"],
    ["c++", "c"],
    ["work/2024 plans", "work/2024-plans"],
    ["Café", "Café"],
  ])("%s becomes %s", (raw, name) => {
    expect(toTagName(raw)).toBe(name);
  });

  it.each(["2024", "+++", "#"])("drops %s, which no tag name can be made of", (raw) => {
    expect(toTagName(raw)).toBeNull();
  });
});

describe("planRaindropImport", () => {
  const plan = planRaindropImport(rowsOf(FIXTURE), NOW);
  const byUrl = new Map(plan.items.map((item) => [item.url, item]));

  it("folds rows of one url key into the first, uniting tags and highlights", () => {
    expect(plan.duplicates).toBe(1);
    const item = byUrl.get("https://stephango.com/file-over-app");
    expect(item).toMatchObject({
      cover: "https://stephango.com/og.jpg",
      description:
        "If you want to create digital artifacts that last, they must be files you can control.",
      folder: "Reading",
      note: "For Tuesday.",
      pinned: true,
      saved: "2023-07-01T09:12:30Z",
      savedMs: Date.UTC(2023, 6, 1, 9, 12, 30),
      stem: "File over app",
      tags: ["philosophy", "files", "ideas", "c"],
      title: "File over app",
    });
    expect(item?.highlights).toEqual([
      { quote: "Files last.", text: "The point." },
      { quote: "Apps are ephemeral, but files are not.", text: "" },
      { quote: "A third one.", text: "" },
    ]);
    expect(plan.droppedTags).toEqual(["2024"]);
  });

  it("nests folders, names each segment, and sends empty and Unsorted to Unsorted", () => {
    expect(byUrl.get("https://cooking.example.com/pasta-al-limone")?.folder).toBe(
      "Cooking/Weeknight",
    );
    expect(byUrl.get("https://example.com/deep")?.folder).toBe("Reading/Long reads/2024");
    expect(byUrl.get("https://example.com/untitled")?.folder).toBe("Unsorted");
    expect(byUrl.get("https://example.com/unsorted")?.folder).toBe("Unsorted");
  });

  it("reads created as ISO 8601 or unix seconds, and anything else as the import's moment", () => {
    expect(byUrl.get("https://cooking.example.com/pasta-al-limone")?.saved).toBe(
      "2023-10-01T08:00:00Z",
    );
    const deep = byUrl.get("https://example.com/deep");
    expect(deep?.saved).toBe("2026-10-17T09:00:00Z");
    expect(deep?.savedSeconds).toBe(NOW / 1000);
  });

  it("keeps only a web cover, and names an untitled row after its url", () => {
    expect(byUrl.get("https://example.com/deep")?.cover).toBeNull();
    expect(byUrl.get("https://example.com/untitled")?.stem).toBe("example.com - untitled");
    expect(byUrl.get("https://example.com/untitled")?.title).toBeNull();
    expect(byUrl.get("https://cooking.example.com/pasta-al-limone")?.tags).toEqual([
      "recipes",
      "Quick-Meals",
    ]);
  });

  it("clips a highlight's quote to the store's limit", () => {
    const long = "word ".repeat(2000);
    const [item] = planRaindropImport(
      rowsOf(`url,highlights\nhttps://a.example/,"${long}"\n`),
      NOW,
    ).items;
    expect(item?.highlights[0]?.quote.length).toBeLessThanOrEqual(4000);
    expect(item?.highlights[0]?.quote.endsWith("…")).toBe(true);
  });
});
