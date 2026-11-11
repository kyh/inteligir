import { describe, expect, it } from "vitest";

import { ITEM_FIELD_CAPS } from "@repo/contract/library/library-item";
import {
  highlightBlocks,
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
    const plan = planRaindropImport(rowsOf("title,url\nA,https://a.example/\n"), NOW);
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

describe(toTagName, () => {
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

describe(planRaindropImport, () => {
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
      pinned: true,
      savedMs: Date.UTC(2023, 6, 1, 9, 12, 30),
      tags: ["philosophy", "files", "ideas", "c"],
      title: "File over app",
    });
    expect(item?.note).toBe("For Tuesday.");
    expect(item?.highlights).toStrictEqual([
      { note: "The point.", quote: "Files last." },
      { note: "", quote: "Apps are ephemeral,\nbut files are not." },
      { note: "", quote: "A third one." },
    ]);
  });

  it("keeps the highlights of a bookmark with no note of its own", () => {
    expect(byUrl.get("https://cooking.example.com/pasta-al-limone")).toMatchObject({
      highlights: [{ note: "", quote: "Use the zest." }],
      note: "",
    });
    expect(byUrl.get("https://example.com/deep")).toMatchObject({ highlights: [], note: "" });
  });

  it("nests folders, and files an empty folder and Raindrop's Unsorted in none", () => {
    expect(byUrl.get("https://cooking.example.com/pasta-al-limone")?.folder).toBe(
      "Cooking/Weeknight",
    );
    expect(byUrl.get("https://example.com/deep")?.folder).toBe("Reading/Long reads/2024");
    expect(byUrl.get("https://example.com/untitled")?.folder).toBeNull();
    expect(byUrl.get("https://example.com/unsorted")?.folder).toBeNull();
  });

  it("keeps a folder's name as Raindrop spelled it", () => {
    const rows = rowsOf('url,folder\nhttps://a.example/,"R&D: Notes/What next? [Aux]"\n');
    const [item] = planRaindropImport(rows, NOW).items;
    expect(item?.folder).toBe("R&D: Notes/What next? [Aux]");
  });

  it("reads created as ISO 8601 or unix seconds, and anything else as the import's moment", () => {
    expect(byUrl.get("https://cooking.example.com/pasta-al-limone")?.savedMs).toBe(
      Date.UTC(2023, 9, 1, 8, 0, 0),
    );
    const deep = byUrl.get("https://example.com/deep");
    expect(deep?.savedMs).toBe(NOW);
  });

  it.each(["99999999999999999", "0000-01-01T00:00:00Z", "1969-12-31T23:59:59Z"])(
    "reads a created of %s, no instant the library holds, as the import's moment",
    (created) => {
      const [row] = rowsOf(FIXTURE);
      if (row === undefined) {
        throw new Error("the fixture holds no row");
      }
      const { items } = planRaindropImport([{ ...row, created }], NOW);
      expect(items.map((item) => item.savedMs)).toStrictEqual([NOW]);
    },
  );

  it("leaves a cover past what a url holds to the page's own", () => {
    const [row] = rowsOf(FIXTURE);
    if (row === undefined) {
      throw new Error("the fixture holds no row");
    }
    const held = `https://example.com/${"c".repeat(ITEM_FIELD_CAPS.url - "https://example.com/".length)}`;
    const [fits] = planRaindropImport([{ ...row, cover: held }], NOW).items;
    const [past] = planRaindropImport([{ ...row, cover: `${held}c` }], NOW).items;
    expect(fits?.cover).toBe(held);
    expect(past?.cover).toBeNull();
  });

  it("keeps only a web cover, and leaves an untitled row's title to its landing", () => {
    expect(byUrl.get("https://example.com/deep")?.cover).toBeNull();
    expect(byUrl.get("https://example.com/untitled")?.title).toBeNull();
    expect(byUrl.get("https://cooking.example.com/pasta-al-limone")?.tags).toStrictEqual([
      "recipes",
      "Quick-Meals",
    ]);
  });
});

const counter = () => {
  let next = 0;
  return () => {
    next += 1;
    return `b${String(next)}`;
  };
};

describe(highlightBlocks, () => {
  it("quotes each passage, its own note the paragraphs under it", () => {
    expect(
      highlightBlocks(
        [
          { note: "The point.", quote: "Files last." },
          {
            note: "One thought.\n \nAnother.",
            quote: "Apps are ephemeral,\nbut files are not.\n\nA second paragraph.",
          },
        ],
        counter(),
      ),
    ).toStrictEqual([
      {
        children: [{ children: [{ text: "Files last." }], type: "p" }],
        id: "b1",
        type: "blockquote",
      },
      { children: [{ text: "The point." }], id: "b2", type: "p" },
      {
        children: [
          { children: [{ text: "Apps are ephemeral,\nbut files are not." }], type: "p" },
          { children: [{ text: "A second paragraph." }], type: "p" },
        ],
        id: "b3",
        type: "blockquote",
      },
      { children: [{ text: "One thought." }], id: "b4", type: "p" },
      { children: [{ text: "Another." }], id: "b5", type: "p" },
    ]);
  });

  it("keeps a highlight's words the text they are, never markdown", () => {
    const [item] = planRaindropImport(
      rowsOf(
        'url,highlights\nhttps://a.example/,"Highlight: *not* [a](link) :date[2026-01-02] [[Beta]] @2026-08-22\nNote: # a note"\n',
      ),
      NOW,
    ).items;
    expect(highlightBlocks(item?.highlights ?? [], counter())).toStrictEqual([
      {
        children: [
          {
            children: [{ text: "*not* [a](link) :date[2026-01-02] [[Beta]] @2026-08-22" }],
            type: "p",
          },
        ],
        id: "b1",
        type: "blockquote",
      },
      { children: [{ text: "# a note" }], id: "b2", type: "p" },
    ]);
  });

  it("quotes nothing for a passage with no words", () => {
    expect(highlightBlocks([{ note: "Still mine.", quote: " \n\n " }], counter())).toStrictEqual([
      { children: [{ text: "Still mine." }], id: "b1", type: "p" },
    ]);
  });
});
