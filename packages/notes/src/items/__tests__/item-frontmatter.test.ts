import { describe, expect, it } from "vitest";

import { frontmatterYaml, parseProperties } from "../../markdown/frontmatter";
import { splitLines } from "../../text/source-lines";
import { bodyOf, composeLinkBody, embedMarkdown, withBody } from "../item-body";
import {
  composeItemFile,
  FILL_OWNED_KEYS,
  isItemStub,
  ITEM_KEYS,
  itemFactsOf,
  NOTE_FACTS,
  readItemFacts,
  withItemFields,
} from "../item-frontmatter";
import type { ItemFieldPatch, ItemKey } from "../item-frontmatter";
import { linkStubText } from "../item-stub";

/* oxlint-disable no-bitwise -- mulberry32 is 32-bit integer math; the shifts and xors ARE the
   algorithm, and the seeded sequence depends on their exact wrap-around semantics. */
const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d_2b_79_f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
};
/* oxlint-enable no-bitwise */

const pick = <T>(rand: () => number, items: readonly T[]): T => {
  const item = items[Math.floor(rand() * items.length)];
  if (item === undefined) {
    throw new Error("pick from empty list");
  }
  return item;
};

const SAVED = Date.UTC(2026, 9, 17, 9, 12, 30);

const written = (content: string, patch: ItemFieldPatch): string => {
  const verdict = withItemFields(content, patch);
  if (verdict.kind !== "written") {
    throw new Error(`expected a write, got ${verdict.kind}`);
  }
  return verdict.content;
};

describe("the exact bytes of §1.4", () => {
  it("a note made in the app", () => {
    expect(composeItemFile({ saved: "2026-10-17T09:12:30Z" }, "")).toBe(
      "---\nsaved: 2026-10-17T09:12:30Z\n---\n",
    );
  });

  it("a link stub from a paste", () => {
    expect(
      linkStubText({
        id: "0e5b3c1a-9a51-4f0e-8a0c-0b7f9d3a2c11",
        note: "",
        saved: SAVED,
        url: "https://stephango.com/file-over-app",
      }),
    ).toBe(
      "---\nid: 0e5b3c1a-9a51-4f0e-8a0c-0b7f9d3a2c11\nkind: link\nurl: https://stephango.com/file-over-app\nsaved: 2026-10-17T09:12:30Z\n---\n",
    );
  });

  const phoneStub = linkStubText({
    id: "7d2f9e40-1c6b-4a8e-9f31-5b0a6c2e8d17",
    note: "For Tuesday.",
    saved: SAVED,
    url: "https://stephango.com/file-over-app?utm_source=share",
  });

  it("a phone stub with a note, its tracking parameters dropped", () => {
    expect(phoneStub).toBe(
      "---\nid: 7d2f9e40-1c6b-4a8e-9f31-5b0a6c2e8d17\nkind: link\nurl: https://stephango.com/file-over-app\nsaved: 2026-10-17T09:12:30Z\n---\nFor Tuesday.\n",
    );
  });

  it("the same stub after a fill, every key in compose order", () => {
    const fields = written(phoneStub, {
      author: "Steph Ango",
      description:
        "If you want to create digital artifacts that last, they must be files you can control, in formats that are easy to retrieve and read.",
      fetched: "2026-10-17T09:12:33Z",
      published: "2023-07-01",
      site: "Steph Ango",
    });
    const filled = withBody(
      fields,
      composeLinkBody({
        article: "File over app is a philosophy: …",
        copy: null,
        cover: "assets/covers/3f9a0c2b1d4e5f60.jpg",
        note: bodyOf(fields),
      }),
    );
    expect(filled).toBe(
      [
        "---",
        "id: 7d2f9e40-1c6b-4a8e-9f31-5b0a6c2e8d17",
        "kind: link",
        "url: https://stephango.com/file-over-app",
        "site: Steph Ango",
        "author: Steph Ango",
        "published: 2023-07-01",
        "saved: 2026-10-17T09:12:30Z",
        "fetched: 2026-10-17T09:12:33Z",
        "description: If you want to create digital artifacts that last, they must be files you can control, in formats that are easy to retrieve and read.",
        "---",
        "![](assets/covers/3f9a0c2b1d4e5f60.jpg)",
        "",
        "For Tuesday.",
        "",
        "File over app is a philosophy: …",
        "",
      ].join("\n"),
    );
    expect(isItemStub(itemFactsOf(filled))).toBe(false);
  });

  it("a failed fill", () => {
    const stub = linkStubText({ id: "i", note: "", saved: SAVED, url: "http://localhost:3000/" });
    expect(
      written(stub, {
        "fetch-error": "This address is on this Mac, so its page isn't read.",
        fetched: "2026-10-17T09:12:30Z",
      }),
    ).toBe(
      "---\nid: i\nkind: link\nurl: http://localhost:3000/\nsaved: 2026-10-17T09:12:30Z\nfetched: 2026-10-17T09:12:30Z\nfetch-error: This address is on this Mac, so its page isn't read.\n---\n",
    );
  });

  it("a YouTube save takes its kind from the address", () => {
    expect(
      linkStubText({
        id: "i",
        note: "",
        saved: SAVED,
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ&si=abc",
      }),
    ).toBe(
      "---\nid: i\nkind: video\nurl: https://www.youtube.com/watch?v=dQw4w9WgXcQ\nsaved: 2026-10-17T09:12:30Z\n---\n",
    );
  });

  it("an image item and a pdf item embed their original", () => {
    expect(
      composeItemFile(
        { id: "i", kind: "image", saved: "2026-10-17T09:12:30Z" },
        `${embedMarkdown("assets/IMG_2041.png")}\n`,
      ),
    ).toBe("---\nid: i\nkind: image\nsaved: 2026-10-17T09:12:30Z\n---\n![](assets/IMG_2041.png)\n");
    expect(
      composeItemFile(
        { id: "i", kind: "pdf", saved: "2026-10-17T09:12:30Z" },
        `${embedMarkdown("assets/Lecture notes.pdf")}\n`,
      ),
    ).toBe(
      "---\nid: i\nkind: pdf\nsaved: 2026-10-17T09:12:30Z\n---\n![](<assets/Lecture notes.pdf>)\n",
    );
  });
});

describe("composeItemFile", () => {
  it("writes id, the item keys in order, tags as a block list, then pinned", () => {
    expect(
      composeItemFile(
        {
          description: "One line.",
          id: "i",
          kind: "link",
          pinned: true,
          saved: "2026-10-17T09:12:30Z",
          site: null,
          tags: ["reading", "a/b"],
          url: "https://a.com/",
        },
        "body\n",
      ),
    ).toBe(
      "---\nid: i\nkind: link\nurl: https://a.com/\nsaved: 2026-10-17T09:12:30Z\ndescription: One line.\ntags:\n  - reading\n  - a/b\npinned: true\n---\nbody\n",
    );
  });

  it("omits a note's kind, quotes what yaml would misread, and writes no block for no fields", () => {
    expect(composeItemFile({ kind: "note", saved: "2026-10-17" }, "")).toBe(
      "---\nsaved: 2026-10-17\n---\n",
    );
    expect(composeItemFile({ description: "a: b", site: "true" }, "")).toBe(
      '---\nsite: "true"\ndescription: "a: b"\n---\n',
    );
    expect(composeItemFile({ url: "https://a.com/?x=1,2" }, "")).toBe(
      "---\nurl: https://a.com/?x=1,2\n---\n",
    );
    expect(composeItemFile({}, "just text\n")).toBe("just text\n");
  });

  it("round-trips through readItemFacts", () => {
    const content = composeItemFile(
      {
        author: "Steph Ango",
        description: "d",
        "fetch-error": "e",
        fetched: "2026-10-17T09:12:33Z",
        id: "i",
        kind: "video",
        published: "2023-07-01",
        saved: "2026-10-17T09:12:30Z",
        site: "YouTube",
        url: "https://youtu.be/abc",
      },
      "",
    );
    expect(itemFactsOf(content)).toEqual({
      author: "Steph Ango",
      description: "d",
      fetchError: "e",
      fetchedMs: Date.UTC(2026, 9, 17, 9, 12, 33),
      hasId: true,
      host: "youtu.be",
      kind: "video",
      published: "2023-07-01",
      savedMs: SAVED,
      site: "YouTube",
      url: "https://youtu.be/abc",
      urlKey: "youtube.com/watch?v=abc",
    });
  });
});

describe("readItemFacts", () => {
  it("is a plain note for no block, an invalid one, or one with no item keys", () => {
    expect(itemFactsOf("hello")).toBe(NOTE_FACTS);
    expect(itemFactsOf("---\nkey: [unclosed\n---\n")).toBe(NOTE_FACTS);
    expect(readItemFacts(null)).toBe(NOTE_FACTS);
    expect(itemFactsOf("---\ntitle: x\n---\n")).toEqual(NOTE_FACTS);
  });

  it("folds the kind, and an unknown one is a note", () => {
    expect(itemFactsOf("---\nkind: ' LINK '\n---\n").kind).toBe("link");
    expect(itemFactsOf("---\nkind: bookmark\n---\n").kind).toBe("note");
    expect(itemFactsOf("---\nkind: 5\n---\n").kind).toBe("note");
  });

  it("keeps only a web url, and any kind may carry one", () => {
    expect(itemFactsOf("---\nurl: ftp://a.com\n---\n").url).toBeNull();
    const note = itemFactsOf("---\nurl: https://a.com/x?utm_source=y\n---\n");
    expect(note.kind).toBe("note");
    expect(note.urlKey).toBe("a.com/x");
    expect(note.host).toBe("a.com");
  });

  it("reads authors, dates and numbers as written, clipped", () => {
    const facts = itemFactsOf(
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

describe("isItemStub", () => {
  const stub = linkStubText({ id: "i", note: "", saved: SAVED, url: "https://a.com/" });

  it("is an app-made url item whose page is unread", () => {
    expect(isItemStub(itemFactsOf(stub))).toBe(true);
  });

  it.each([
    ["no id", "---\nkind: link\nurl: https://a.com/\nsaved: 2026-10-17T09:12:30Z\n---\n"],
    ["no saved", "---\nid: i\nkind: link\nurl: https://a.com/\n---\n"],
    ["fetched", written(stub, { fetched: "2026-10-17T09:12:31Z" })],
    ["a note with a url", "---\nid: i\nurl: https://a.com/\nsaved: 2026-10-17T09:12:30Z\n---\n"],
    ["an image", "---\nid: i\nkind: image\nurl: https://a.com/\nsaved: 2026-10-17\n---\n"],
    ["no web url", "---\nid: i\nkind: link\nurl: nope\nsaved: 2026-10-17T09:12:30Z\n---\n"],
  ])("is not one with %s", (_, content) => {
    expect(isItemStub(itemFactsOf(content))).toBe(false);
  });
});

describe("withItemFields", () => {
  it("keeps the BOM, CRLF, comments, unknown keys and flow lists byte-exact", () => {
    const content =
      "﻿---\r\nid: x\r\n# keep me\r\nother: [a,  b]\r\nkind: link\r\ntags: [r, s]\r\n---\r\nbody\r\n";
    expect(written(content, { site: "S" })).toBe(
      "﻿---\r\nid: x\r\n# keep me\r\nother: [a,  b]\r\nkind: link\r\nsite: S\r\ntags: [r, s]\r\n---\r\nbody\r\n",
    );
  });

  it("puts an added key before the nearest later one, else after id, else first", () => {
    expect(written("---\nid: x\nfoo: 1\nurl: https://a.com\n---\n", { kind: "link" })).toBe(
      "---\nid: x\nfoo: 1\nkind: link\nurl: https://a.com\n---\n",
    );
    expect(written("---\nfoo: 1\nid: x\n---\n", { site: "S" })).toBe(
      "---\nfoo: 1\nid: x\nsite: S\n---\n",
    );
    expect(written("---\nfoo: 1\n---\n", { site: "S" })).toBe("---\nsite: S\nfoo: 1\n---\n");
    expect(written("body\n", { kind: "link", url: "https://a.com" })).toBe(
      "---\nkind: link\nurl: https://a.com\n---\nbody\n",
    );
  });

  it("replaces a key's own lines, block values included", () => {
    expect(written("---\nauthor:\n  - a\n  - b\nsite: s\n---\n", { author: "C" })).toBe(
      "---\nauthor: C\nsite: s\n---\n",
    );
  });

  it("validates the kind, the url and the times, and writes them canonical", () => {
    expect(withItemFields("x", { kind: "bookmark" })).toEqual({
      key: "kind",
      kind: "refused",
      reason: "bookmark is not an item kind",
    });
    expect(withItemFields("x", { url: "ftp://a" }).kind).toBe("refused");
    expect(withItemFields("x", { saved: "yesterday" }).kind).toBe("refused");
    expect(written("x", { saved: "2026-10-17T11:12:30+02:00" })).toBe(
      "---\nsaved: 2026-10-17T09:12:30Z\n---\nx",
    );
    expect(written("x", { url: "https://u:p@a.com/?fbclid=1" })).toBe(
      "---\nurl: https://a.com/\n---\nx",
    );
  });

  it("removes a key for null and for a note's kind, dropping an emptied block", () => {
    expect(written("---\nkind: link\nsite: s\n---\nx", { kind: "note" })).toBe(
      "---\nsite: s\n---\nx",
    );
    expect(written("---\nsite: s\n---\nx", { site: null })).toBe("x");
  });

  it("is unchanged when every key already says it, and refuses an invalid block", () => {
    expect(
      withItemFields("---\nkind: link\npublished: 2023-07-01\n---\n", {
        kind: "link",
        published: "2023-07-01",
        site: null,
      }),
    ).toEqual({ kind: "unchanged" });
    expect(withItemFields("---\nkey: [unclosed\n---\n", { site: "s" })).toEqual({
      kind: "invalid",
    });
  });

  it("names the fill's keys among the item keys", () => {
    for (const key of FILL_OWNED_KEYS) {
      expect(ITEM_KEYS).toContain(key);
    }
    expect(FILL_OWNED_KEYS).not.toContain("url");
    expect(FILL_OWNED_KEYS).not.toContain("saved");
  });
});

const OTHER_LINES = [
  "# a comment",
  "other: [a,  b]",
  "title-ish: 'quoted'",
  "aliases:",
  "  - one",
  "nested:",
  "  key: value",
  "tags: [x, y]",
  "pinned: true",
];
const PATCH_VALUES = {
  author: ["Ann", null],
  description: ["One, two: three", "plain", null],
  "fetch-error": ["It failed.", null],
  fetched: ["2026-10-17T09:12:33Z", "2026-10-17", null],
  kind: ["link", "video", "note", null],
  published: ["2023-07-01", null],
  saved: ["2026-10-17T09:12:30Z", null],
  site: ["Site", null],
  url: ["https://a.com/x", null],
} satisfies Record<ItemKey, readonly (string | null)[]>;

const isItemLine = (line: string): boolean => ITEM_KEYS.some((key) => line.startsWith(`${key}:`));

describe("the seeded fuzz", () => {
  it("touches only the patched keys' lines, reads back the patch, and settles", () => {
    const rand = mulberry32(0xf0_0d);
    for (let i = 0; i < 300; i += 1) {
      const eol = rand() < 0.5 ? "\r\n" : "\n";
      const bom = rand() < 0.3 ? "﻿" : "";
      const others = OTHER_LINES.filter(() => rand() < 0.5).filter(
        (line, index, all) => !line.startsWith("  ") || all[index - 1]?.endsWith(":") === true,
      );
      const start = linkStubText({ id: "i", note: "", saved: SAVED, url: "https://a.com/" });
      const startLines = splitLines(frontmatterYaml(start) ?? "");
      const block = [...startLines, ...others];
      const content = `${bom}---${eol}${block.join(eol)}${eol}---${eol}body${eol}`;
      const patch: Record<string, string | null> = {};
      for (const key of ITEM_KEYS) {
        if (rand() < 0.4) {
          patch[key] = pick(rand, PATCH_VALUES[key]);
        }
      }
      const verdict = withItemFields(content, patch);
      expect(verdict.kind, JSON.stringify({ content, patch })).not.toBe("invalid");
      const next = verdict.kind === "written" ? verdict.content : content;
      expect(next.startsWith(`${bom}---${eol}`)).toBe(true);
      expect(next.endsWith(`---${eol}body${eol}`)).toBe(true);
      const yaml = frontmatterYaml(next) ?? "";
      expect(parseProperties(yaml).kind).not.toBe("invalid");
      expect(splitLines(yaml).filter((line) => !isItemLine(line))).toEqual(
        block.filter((line) => !isItemLine(line)),
      );
      const facts = itemFactsOf(next);
      if (patch["site"] !== undefined) {
        expect(facts.site).toBe(patch["site"]);
      }
      if (patch["kind"] !== undefined) {
        expect(facts.kind).toBe(patch["kind"] ?? "note");
      }
      expect(withItemFields(next, patch)).toEqual({ kind: "unchanged" });
    }
  });
});
