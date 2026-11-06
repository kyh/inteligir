import { describe, expect, it } from "vitest";

import { frontmatterYaml, parseProperties } from "../markdown/frontmatter";
import { readItemFacts } from "./item-frontmatter";

// a file's facts, its frontmatter read as an import reads it
const factsOf = (content: string) => {
  const yaml = frontmatterYaml(content);
  return readItemFacts(yaml === null ? null : parseProperties(yaml));
};

describe(readItemFacts, () => {
  it("is a plain note for no block, an invalid one, or one with no item keys", () => {
    const note = readItemFacts(null);
    expect(note.kind).toBe("note");
    expect(note.url).toBeNull();
    expect(factsOf("---\nkey: [unclosed\n---\n")).toStrictEqual(note);
    expect(factsOf("hello")).toStrictEqual(note);
    expect(factsOf("---\ntitle: x\n---\n")).toStrictEqual(note);
  });

  it("folds the kind, and an unknown one is a note", () => {
    expect(factsOf("---\nkind: ' LINK '\n---\n").kind).toBe("link");
    expect(factsOf("---\nkind: bookmark\n---\n").kind).toBe("note");
    expect(factsOf("---\nkind: 5\n---\n").kind).toBe("note");
  });

  it("keeps only a web url, and any kind may carry one", () => {
    expect(factsOf("---\nurl: ftp://a.com\n---\n").url).toBeNull();
    const note = factsOf("---\nurl: https://a.com/x?utm_source=y\n---\n");
    expect(note.kind).toBe("note");
    expect(note.urlKey).toBe("a.com/x");
    expect(note.host).toBe("a.com");
  });

  it("reads authors, dates and numbers as written, clipped", () => {
    const facts = factsOf(
      [
        "---",
        "author:",
        "  - '[[Steph Ango]]'",
        "  - '[[people/kai|Kai]]'",
        "published: 2023",
        `site: ${"s".repeat(100)}`,
        "saved: 2026-10-17",
        "fetched: not a time",
        "---",
      ].join("\n"),
    );
    expect(facts.author).toBe("Steph Ango, Kai");
    expect(facts.published).toBe("2023");
    expect(facts.site).toBe("s".repeat(80));
    expect(facts.savedMs).toBe(Date.UTC(2026, 9, 17));
    expect(facts.fetchedMs).toBeNull();
  });
});
