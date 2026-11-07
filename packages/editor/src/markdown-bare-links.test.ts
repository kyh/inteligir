import { assert, describe, expect, it } from "vitest";
import { ElementApi, NodeApi, TextApi } from "platejs";
import type { Descendant, Value } from "platejs";

import {
  analyzeMarkdown,
  headlessEditor,
  parseMarkdown,
  serializeNote,
} from "@repo/editor/markdown/markdown-doc";
import { projectPassages } from "@repo/notes/annotations/passage-text";

const parsed = (md: string): Value => {
  const result = parseMarkdown(md);
  assert(result.ok, md);
  return result.value;
};

const write = (md: string): string => serializeNote(headlessEditor(), parsed(md));

// a block as a reader meets it: its words, and each link's address, label and marks where they stand
const read = (nodes: readonly Descendant[]): unknown[] => {
  const runs: unknown[] = [];
  let words = "";
  const endWords = (): void => {
    if (words !== "") {
      runs.push(words);
    }
    words = "";
  };
  for (const node of nodes) {
    if (ElementApi.isElement(node)) {
      endWords();
      runs.push(
        node.type === "a"
          ? { label: read(node.children), text: NodeApi.string(node), url: node.url }
          : { [node.type]: read(node.children) },
      );
    } else if (TextApi.isText(node)) {
      const { text, ...marks } = node;
      if (Object.keys(marks).length === 0) {
        words += text;
      } else {
        endWords();
        runs.push({ marks, text });
      }
    }
  }
  endWords();
  return runs;
};

const readOf = (md: string): unknown[] => read(parsed(md));

// the same links at the same places, and bytes that are their own next write
const kept = (md: string): string => {
  const written = write(md);
  expect(readOf(written)).toStrictEqual(readOf(md));
  expect(write(written)).toBe(written);
  expect(analyzeMarkdown(written).kind).toBe("canonical");
  return written;
};

// any address as a source can spell it: every byte a label or a destination reads as syntax escaped
const escaped = (bytes: string): string => bytes.replaceAll(/[[\]<>\\*_~`&]/gu, String.raw`\$&`);
const spelled = (text: string, url = text): string => `[${escaped(text)}](<${escaped(url)}>)`;

const URL = "https://x.y/a";
const NEXT = "https://x.y/b";
const MAIL = "[a@b.cd](mailto:a@b.cd)";
const WWW = "[www.x.y](http://www.x.y)";
const LABELLED = `[${URL}](${URL})`;
const WWW_MAIL = "[www.x.y@b.cd](http://www.x.y@b.cd)";

describe("an address that ends where a literal would not keeps its label", () => {
  it.each([
    ["https://en.wikipedia.org/wiki/Oklahoma!", "[https://en.wikipedia.org/wiki/Oklahoma!]"],
    ["https://x.y/a.", "[https://x.y/a.]"],
    ["https://x.y/a,", "[https://x.y/a,]"],
    ["https://x.y/a?", "[https://x.y/a?]"],
    ["https://x.y/a:", "[https://x.y/a:]"],
    ["https://x.y/a;", "[https://x.y/a;]"],
    ["https://x.y/a'", "[https://x.y/a']"],
    ['https://x.y/a"', '[https://x.y/a"]'],
    ["https://x.y/a)", "[https://x.y/a)]"],
    ["https://x.y/(a))", "[https://x.y/(a))]"],
    ["https://x.y/a...", "[https://x.y/a...]"],
    ["https://x.y/a&amp;", String.raw`[https://x.y/a\&amp;]`],
    ["https://x.y/a]", String.raw`[https://x.y/a\]]`],
    ["https://x.y/a<b", String.raw`[https://x.y/a\<b]`],
    ["https://x.y/a_", String.raw`[https://x.y/a\_]`],
    ["https://x.y/a*", String.raw`[https://x.y/a\*]`],
    ["https://x.y/a~", String.raw`[https://x.y/a\~]`],
  ])("%s", (address, written) => {
    expect(kept(`${spelled(address)}\n`).startsWith(`${written}(`)).toBe(true);
  });

  it("a www address's dot", () => {
    expect(kept("[www.x.y/a.](http://www.x.y/a.)\n")).toBe("[www.x.y/a.](http://www.x.y/a.)\n");
  });
});

describe("an address gfm reads no literal in keeps its label", () => {
  it.each([
    ["an underscore in the domain's last parts", "https://foo_bar.example_x/a"],
    ["a space", "https://x.y/a b"],
  ])("%s", (_name, address) => {
    expect(kept(`${spelled(address)}\n`).startsWith("[")).toBe(true);
  });
});

describe("a link keeps its label beside what a literal would run into", () => {
  it.each([
    ["a word after it", `${LABELLED}b\n`],
    ["an apostrophe that runs on", `${LABELLED}'s page\n`],
    ["a word before it", `x${LABELLED}\n`],
    ["punctuation and a word after it", `${LABELLED},b\n`],
    ["an escape the writer owes the next text", `${LABELLED}\\_ b\n`],
    ["a code span", `${LABELLED}\`c\`\n`],
    ["a date", `${LABELLED}@2026-08-22\n`],
    ["a wiki link", `${LABELLED}[[Note]]\n`],
    ["a mark after it", `${LABELLED}_a_\n`],
    ["a mark before it", `_a_${LABELLED}\n`],
    ["a word after a mail link", `${MAIL}x\n`],
    ["a word before a mail link", `x${MAIL}\n`],
    ["a dot before a mail link", `x.${MAIL}\n`],
    ["a mark after a mail link", `${MAIL}_a_\n`],
    ["a word before a www link", `x${WWW}\n`],
    ["a word after a www link", `${WWW}b\n`],
    ["a `>` that would close an angle link further back", `<#${MAIL}>\n`],
    ["the same angle a few characters back", `<$%${MAIL}>\n`],
    ["a space the writer spells as a reference at a line's end", `${LABELLED}&#x20;\n`],
    ["the same space in a heading", `# ${LABELLED}&#x20;\n`],
    ["a tab the writer spells the same", `${LABELLED}&#x9;\n`],
    ["a word a dot joins to a www address that spells a mail address", `x.${WWW_MAIL}\n`],
    ["a dash that does", `x-${WWW_MAIL}\n`],
  ])("%s", (_name, md) => {
    expect(kept(md)).toBe(md);
  });

  it("two links that touch stay two", () => {
    expect(kept(`${LABELLED}[${NEXT}](${NEXT})\n`)).toBe(`${LABELLED}${NEXT}\n`);
  });

  it("the second of two a comma joins stands bare", () => {
    expect(kept(`${LABELLED},[${NEXT}](${NEXT})\n`)).toBe(`${LABELLED},${NEXT}\n`);
  });

  it("a `!` before a label stays no image", () => {
    const address = "www.x.y/a}";
    const md = `\\!${spelled(address, `http://${address}`)}\n`;
    expect(kept(md)).toBe("\\![www.x.y/a}](http://www.x.y/a})\n");
  });
});

describe("a plain bare url stays as it is written", () => {
  it.each([
    ["https://x.y/a\n"],
    ["see https://x.y/a now\n"],
    ["https://x.y/Mercury_(planet)\n"],
    ["https://x.y/a}\n"],
    ["https://x.y/a.\n"],
    ["https://x.y/a, and on\n"],
    ["(https://x.y/a)\n"],
    ["(see https://x.y/a).\n"],
    ["https://x.y/a?b=c&d=e#f\n"],
    ["https://x.y/a's\n"],
    ["https://x.y/a_b*c~d\n"],
    ["localhost: http://localhost/a\n"],
    ["1https://x.y/a\n"],
    ["see:https://x.y/a\n"],
    ["www.x.y/a b\n"],
    ["see (www.x.y/a) and www.x.y.\n"],
    ["a@b.cd\n"],
    ["mail a@b.cd.\n"],
    ["https://x.y/a <b>c</b>\n"],
    ["https://x.y/a<u>c</u>\n"],
    ["_https://x.y/a_\n"],
    ["**https://x.y/a**\n"],
    ["~~https://x.y/a~~\n"],
    ["_**https://x.y/a**_\n"],
    ["**https://x.y/a**.\n"],
    ["**https://x.y/a** b\n"],
    ["a **https://x.y/a**\n"],
    ["https://x.y/a  \nb\n"],
    ["**https://x.y/a**  \nb\n"],
    ["_https://x.y/a_  \nb\n"],
    ["_www.x.y@b.cd_  \nb\n"],
    ["a\\\n_www.x.y@b.cd_  \nb\n"],
    ["x**https://x.y/a**\n"],
    ["x*https://x.y/a*\n"],
    ["x~~https://x.y/a~~\n"],
    ["https://x.y/a\n\nhttps://x.y/b\n"],
    ["# https://x.y/a\n"],
    ["# see https://x.y/a now\n"],
    ["- https://x.y/a\n- a@b.cd\n"],
    ["> https://x.y/a\n"],
    ["| a             |\n| ------------- |\n| https://x.y/a |\n"],
    ["| a                 |\n| ----------------- |\n| see https://x.y/a |\n"],
    ["| a               |\n| --------------- |\n| https://x.y/a b |\n"],
    ["| a       |\n| ------- |\n| www.x.y |\n"],
    ["[^a]: see https://x.y/a\n"],
    ["<span>https://x.y/a</span>\n"],
  ])("%j", (md) => {
    expect(kept(md)).toBe(md);
  });

  it.each([
    ["a label it needs no more", `${LABELLED}\n`, `${URL}\n`],
    ["a dot outside the link", `${LABELLED}.\n`, `${URL}.\n`],
    ["a word a space away", `${LABELLED} ok\n`, `${URL} ok\n`],
    ["angle brackets", `<${URL}>\n`, `${URL}\n`],
    ["a mail link", `${MAIL}\n`, "a@b.cd\n"],
    ["a www link", `${WWW}\n`, "www.x.y\n"],
  ])("sheds %s", (_name, md, written) => {
    expect(kept(md)).toBe(written);
  });
});

describe("a mark over the whole link", () => {
  it.each([
    ["bold", `[**${URL}**](${URL})b\n`],
    ["italic", `[_${URL}_](${URL})b\n`],
    ["struck", `[~~${URL}~~](${URL})b\n`],
    ["bold on an address no literal ends on", `[**${URL}!**](${URL}!)\n`],
  ])("%s keeps its label", (_name, md) => {
    expect(kept(md)).toBe(md);
  });

  it.each([
    ["bold", `[**${URL}**](${URL}) b\n`, `**${URL}** b\n`],
    ["italic", `[_${URL}_](${URL}).\n`, `_${URL}_.\n`],
  ])("%s sheds a label it needs no more", (_name, md, written) => {
    expect(kept(md)).toBe(written);
  });

  it("beside a run of the same mark", () => {
    expect(kept(`**a**[**${URL}**](${URL})\n`)).toBe(`**a**[**${URL}**](${URL})\n`);
  });

  it("after a link that stands bare, whose closer it would join", () => {
    const bold = "[**a@b.cd**](mailto:a@b.cd)";
    expect(kept(`${bold}[**${URL}**](${URL})\n`)).toBe(`**a@b.cd**[**${URL}**](${URL})\n`);
  });
});

const row = (cell: string): string => `| ${cell} |\n`;

describe("wherever the block is", () => {
  const touching = `${LABELLED}b`;

  it.each([
    ["the very start of a block", `${touching} c\n`],
    ["the very end of a block", `c ${touching}\n`],
    ["a heading", `# ${touching}\n`],
    ["a list item", `- ${touching}\n`],
    ["a to-do", `- [ ] ${touching}\n`],
    ["a quote", `> ${touching}\n`],
    ["lines of a paragraph", `a\\\n${touching}\\\nc\n`],
  ])("%s", (_name, md) => {
    expect(kept(md)).toBe(md);
  });

  it("a table cell", () => {
    const md = `${row("a".padEnd(touching.length))}${row("-".repeat(touching.length))}${row(touching)}`;
    expect(kept(md)).toBe(md);
  });

  it("a tag that ends a cell's line, which stops a literal", () => {
    const md = "| a                     |\n| --------------------- |\n| https://x.y/a<br/>see |\n";
    expect(kept(md)).toBe(md);
  });

  it("a pipe in a cell's address, which a literal would read with its backslash", () => {
    const address = String.raw`https://x.y/a\|b`;
    expect(kept(`| a |\n| - |\n| [${address}](${address}) |\n`)).toContain(
      `[${address}](${address})`,
    );
  });
});

const BESIDE = [
  ["", ""],
  [" ", " "],
  ["x", ""],
  ["", "x"],
  ["1", ""],
  ["", "1"],
  ["-", ""],
  ["", "-"],
  ["(", ")"],
  ['"', '"'],
  ["'", "'"],
  [String.raw`\!`, ""],
  [String.raw`\\`, ""],
  ["", "'s"],
  ["", "."],
  ["", ".x"],
  ["", ". x"],
  ["", ", x"],
  ["", ":x"],
  ["", "!"],
  ["", "?!"],
  ["", ");"],
  ["/", ""],
  ["", "/"],
  ["", "#"],
  ["", "="],
  ["", "&"],
  ["", "&x;"],
  ["", "@"],
  ["", "é"],
  ["é", ""],
  ["", "\u00A0x"],
  ["x.", ""],
  ["x-", ""],
  ["_a_ ", ""],
  ["", " _a_"],
  ["", "_a_"],
  ["_a_", ""],
  ["**a**", ""],
  ["", "**a**"],
  ["", "`a`"],
  ["`a`", ""],
  ["", "<u>a</u>"],
  ["<u>a</u>", ""],
  ["<#", ">"],
  ["<", ">"],
] as const;

describe("every address beside everything", () => {
  const addresses = [
    ["https://x.y/a", "https://x.y/a"],
    ["https://x.y/", "https://x.y/"],
    ["https://x.y", "https://x.y"],
    ["https://x.y/a!", "https://x.y/a!"],
    ["https://x.y/a.", "https://x.y/a."],
    ["https://x.y/(a)", "https://x.y/(a)"],
    ["https://x.y/a_b", "https://x.y/a_b"],
    ["www.x.y/a", "http://www.x.y/a"],
    ["www.x.y/a}", "http://www.x.y/a}"],
    ["www.x.y/a.", "http://www.x.y/a."],
    ["a@b.cd", "mailto:a@b.cd"],
    ["a-b_c.d+e@f-g.hi", "mailto:a-b_c.d+e@f-g.hi"],
    ["www.x.y@b.cd", "http://www.x.y@b.cd"],
  ] as const;

  it.each(
    addresses.flatMap(([text, url]) =>
      [...BESIDE, ["", "&#x20;"] as const].map(
        ([before, after]) => `${before}${spelled(text, url)}${after}\n`,
      ),
    ),
  )("%j", (md) => {
    expect(readOf(kept(md))).toStrictEqual(readOf(md));
  });
});

describe("a link in a held source", () => {
  it.each([
    ["punctuation and a word after it", `<span>${LABELLED}.x</span>\n`],
    ["a call after it", `<span>${LABELLED}[^b]</span>\n`],
    ["the end of a mark", `<span>**${LABELLED}**</span>\n`],
    ["the end of a mark, words run on past it", `<span>**${LABELLED}**.x</span>\n`],
    ["the end of a mark, a hard break after it", `<span>**${LABELLED}**\\\nb</span>\n`],
    ["the end of a mark in a footnote", `[^a]: **${LABELLED}**\n`],
    ["a hard break in a footnote", `[^a]: **${LABELLED}**\\\n    b\n`],
    ["a call past a mark in a footnote", `[^a]: *x ${LABELLED}*[^b]\n`],
    ["a mark over its label", `<span>[**${URL}**](${URL})</span>\n`],
    ["a mark over a mail address's label", "<span>[*a@b.cd*](mailto:a@b.cd)</span>\n"],
    ["a mark over its label in a footnote", `[^a]: [~~${URL}~~](${URL})\n`],
  ])("keeps its label at %s", (_name, md) => {
    expect(kept(md)).toBe(md);
  });

  it.each([
    ["a tag", "<span>https://x.y/a</span>\n"],
    ["a word a space away", "<span>https://x.y/a b</span>\n"],
    ["a hard break", "<span>https://x.y/a  \nb</span>\n"],
    ["an underline around it", "<span><u>https://x.y/a</u></span>\n"],
    ["a footnote", "[^a]: see https://x.y/a\n"],
    ["a hard break in a footnote", "[^a]: https://x.y/a  \n    b\n"],
  ])("stays bare at %s", (_name, md) => {
    expect(kept(md)).toBe(md);
  });

  const INNER_RE = /^<span>(?<inner>[^]*)<\/span>\n$/u;
  const WWW_ADDRESS = "www.x.y/a";

  // an underline is a tag the library reads through, so a held tag's bytes read as they stand
  it.each(
    [spelled(URL), spelled(`${URL}!`), spelled(WWW_ADDRESS, `http://${WWW_ADDRESS}`), MAIL].flatMap(
      (link) =>
        BESIDE.flatMap(([before, after]) =>
          ["", "**", "_", "~~"].map((mark) => `${before}${mark}${link}${mark}${after}`),
        ),
    ),
  )("%j reads the same held", (inline) => {
    const inner = INNER_RE.exec(kept(`<span>${inline}</span>\n`))?.groups?.inner;
    assert(inner !== undefined, inline);
    expect(readOf(`<u>${inner}</u>\n`)).toStrictEqual(readOf(`<u>${inline}</u>\n`));
  });
});

describe("a call in an address reads as the writer spells the link", () => {
  it.each([
    ["a word after it", "[https://x.y/[^a]b](https://x.y/\\[^a]b)c\n"],
    ["an address no literal ends on", "[https://x.y/[^a]b!](https://x.y/\\[^a]b!)\n"],
  ])("a label's call stays a label's, beside %s", (_name, md) => {
    expect(kept(md)).toBe(md);
  });

  it("an address that needs no label holds no call", () => {
    expect(kept("[https://x.y/[^a]b](https://x.y/[^a]b) c\n")).toBe("https://x.y/[^a]b c\n");
  });

  it.each(
    ["https://x.y/[^a]b", "https://x.y/[^a]b!"].flatMap((address) =>
      BESIDE.map(([before, after]) => `${before}[${address}](${address})${after}\n`),
    ),
  )("%j reads the same written", (md) => {
    expect(projectPassages(kept(md)).text).toBe(projectPassages(md).text);
  });
});
