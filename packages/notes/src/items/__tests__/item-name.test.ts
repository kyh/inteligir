import { describe, expect, it } from "vitest";

import { checkNoteName } from "../../knowledge/note-name";
import { itemNameFromTitle, itemNameFromUrl, itemStem } from "../item-name";

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

describe("itemNameFromTitle", () => {
  it.each([
    ["File over app", "File over app"],
    ["Why: a story | Part 1", "Why - a story - Part 1"],
    ["a/b\\c", "a-b-c"],
    ["[draft] notes", "(draft) notes"],
    ['He said "hi"', "He said 'hi'"],
    ["What? *Really* <yes>", "What Really yes"],
    ["  ...--Title--...  ", "Title"],
    ["Line one\nLine two\t end", "Line one Line two end"],
    ["étude", "étude"],
    ["con", "con (item)"],
    ["CON.tar", "CON (item).tar"],
    ["lpt1", "lpt1 (item)"],
    ["console", "console"],
  ])("%j → %j", (title, expected) => {
    expect(itemNameFromTitle(title)).toBe(expected);
  });

  it.each(["", "   ", "...", "\u0001\u0002", "*?<>", "- . -"])("%j has no name", (title) => {
    expect(itemNameFromTitle(title)).toBeNull();
  });

  it("cuts a long title at a word boundary at or under 120 characters", () => {
    const title = Array.from({ length: 60 }, (_, i) => `word${String(i)}`).join(" ");
    const name = itemNameFromTitle(title) ?? "";
    expect(name.length).toBeLessThanOrEqual(120);
    expect(title.startsWith(`${name} `)).toBe(true);
  });

  it("keeps a long unbroken title within the byte budget", () => {
    const name = itemNameFromTitle("漢".repeat(300)) ?? "";
    expect(name).toBe("漢".repeat(80));
    expect(checkNoteName(`${name} 99.md`).ok).toBe(true);
  });
});

describe("itemNameFromUrl and itemStem", () => {
  it.each([
    ["https://stephango.com/file-over-app", "stephango.com - file over app"],
    ["https://www.example.com/", "example.com"],
    ["https://example.com/docs/report_2026.pdf", "example.com - report 2026"],
    ["https://example.com/a%3Fb/", "example.com - ab"],
    ["https://example.com/a/b/?q=1#x", "example.com - b"],
  ])("%s → %j", (url, expected) => {
    expect(itemNameFromUrl(url)).toBe(expected);
  });

  it("takes the title first, the address next, and Untitled last", () => {
    expect(itemStem("Title", "https://x.com")).toBe("Title");
    expect(itemStem(null, "https://stephango.com/file-over-app")).toBe(
      "stephango.com - file over app",
    );
    expect(itemStem("***", "https://a.com/x")).toBe("a.com - x");
    expect(itemStem(null, null)).toBe("Untitled");
    expect(itemStem("", null)).toBe("Untitled");
  });
});

const NASTY = [
  "a",
  "Z",
  " ",
  "  ",
  "\t",
  "\n",
  ".",
  "-",
  ":",
  "|",
  "/",
  "\\",
  "[",
  "]",
  '"',
  "*",
  "?",
  "<",
  ">",
  "\u0000",
  "\u007F",
  "\u0085",
  "é",
  "é",
  "漢",
  "😀",
  "con",
  "nul",
  "com1",
  ".md",
  "#",
  "%",
];

describe("the seeded property", () => {
  it("every name a title or an address yields is one checkNoteName accepts as written", () => {
    const rand = mulberry32(0x0a_11_7e);
    for (let i = 0; i < 5000; i += 1) {
      const length = Math.floor(rand() * (i % 10 === 0 ? 200 : 12));
      const title = Array.from({ length }, () => pick(rand, NASTY)).join("");
      for (const name of [itemNameFromTitle(title), itemNameFromUrl(`https://h.com/${title}`)]) {
        if (name === null) {
          continue;
        }
        const verdict = checkNoteName(name);
        expect(verdict, JSON.stringify(title)).toEqual({ name, ok: true });
        expect([...name].length, JSON.stringify(title)).toBeLessThanOrEqual(120);
      }
    }
  });
});
