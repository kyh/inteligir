import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { itemView } from "@repo/editor/headless/codec/item-view";
import { FILL_LIMITS } from "@repo/contract/items/link-fill";
import { deriveBody } from "@repo/contract/library/derive-item";
import type { LibraryBlock, LibraryNode } from "@repo/contract/library/library-nodes";

import { extractPage } from "./extract-page";
import { readHtml } from "./read-html";
import { longPage } from "./test-support/long-page.test-utils";

const SCRIPT_SCHEME = ["java", "script:"].join("");

const CORPUS = path.join(import.meta.dirname, "test-support/corpus");
const PAGE_URL = "https://pages.example/posts/item";

const page = (name: string) => readFileSync(path.join(CORPUS, `${name}.html`), "utf-8");

const extracted = (name: string) =>
  extractPage({ html: page(name), prefer: "article", url: PAGE_URL });

const counter = () => {
  let next = 0;

  return (() => {
    next += 1;

    return `page${String(next)}`;
  }) satisfies () => string;
};

const readOf = (html: string, prefer: "article" | "description" = "article") =>
  readHtml({ html, prefer, url: PAGE_URL }, counter());

const read = (name: string) => readOf(page(name));

const written = (blocks: readonly LibraryBlock[]) =>
  itemView(
    blocks.map((block) => ({ block, section: "article" })),
    { title: () => null },
  ).markdown;

const wordsOf = (blocks: readonly LibraryBlock[]) => {
  const { text } = deriveBody(blocks.map((block) => ({ block, section: "article" })));

  return text === "" ? "" : `${text}\n`;
};

const typesIn = (blocks: readonly LibraryNode[]) => {
  const types = new Set<string>();
  const pending = [...blocks];

  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if ("text" in node) {
      types.add("text");
    } else {
      types.add(node.type);
      pending.push(...node.children);
    }
  }

  return types;
};

const articlePage = (markup: string) =>
  `<html><body><article><h1>A page</h1><p>An opening paragraph of ordinary prose, long enough for the reader to take the article as the page's readable part.</p>${markup}<p>A closing paragraph of ordinary prose, as long as the first, so the article ends in words.</p></article></body></html>`;

describe("page meta", () => {
  it("reads the extractor's facts and the head's covers, the secure image first", () => {
    const { facts } = extracted("blog-post");
    expect(facts.title).toBe("Keep your notes in files");
    expect(facts.site).toBe("Field Notes");
    expect(facts.description).toBe("A short argument for plain files over databases.");
    expect(facts.images).toStrictEqual([
      "https://cdn.fieldnotes.example/cover@2x.jpg",
      "https://pages.example/images/cover.jpg",
    ]);
    expect(facts.author).toBe("Ada Lindqvist");
    expect(facts.published).toBe("2024-03-04");
    expect(facts.lang).toBe("en");
  });

  it("keeps the day an ISO time was written in, not UTC's", () => {
    const html = `<html><head><meta property="article:published_time" content="2024-03-05T20:30:00-08:00"></head><body></body></html>`;
    expect(extractPage({ html, prefer: "article", url: PAGE_URL }).facts.published).toBe(
      "2024-03-05",
    );
  });

  it("reads twitter tags and a JSON-LD @graph with several authors", () => {
    const { facts } = extracted("news-article");
    expect(facts.title).toBe("Harbour bridge reopens after two years of repairs");
    expect(facts.site).toBe("The Coastal Herald");
    expect(facts.author).toBe("Maya Okafor, Tom Reyes");
    expect(facts.published).toBe("2025-11-02");
    expect(facts.images).toStrictEqual([
      "https://img.coastalherald.example/bridge.png",
      "https://img.coastalherald.example/bridge-wide.jpg",
    ]);
  });

  it("falls back to the application name, the description meta and the bare <title>", () => {
    expect(extracted("docs-page").facts).toMatchObject({
      description: "How to configure the sync daemon's interval, paths and conflict policy.",
      site: "Tidepool Docs",
      title: "Configuring the sync daemon",
    });
    expect(extracted("bare-title").facts).toMatchObject({
      author: null,
      description: null,
      images: [],
      site: null,
      title: "A page with only a title",
    });
  });

  it("finds the oEmbed discovery link and a video's description", () => {
    const { facts } = extracted("video-page");
    expect(facts.oembed).toBe(
      "https://vidtube.example/oembed?url=https%3A%2F%2Fvidtube.example%2Fwatch%3Fv%3Dabc123",
    );
    expect(facts.site).toBe("VidTube");
  });

  it("takes no in-page anchor for a picture", () => {
    const html = `<html><head><meta property="og:image" content="#top"></head><body></body></html>`;
    expect(extractPage({ html, prefer: "article", url: PAGE_URL }).facts.images).toStrictEqual([]);
  });

  it("drops a script url among the images", () => {
    expect(extracted("script-heavy").facts.images).toStrictEqual([
      "https://cdn.app.example/v4.png",
    ]);
  });
});

describe("the article", () => {
  it("keeps the prose, absolute links, a fenced code block and the picture, and none of the chrome", () => {
    const article = written(read("blog-post").article.blocks);
    expect(article).toContain("## What a file buys you");
    expect(article).toContain("[Unix philosophy](https://en.wikipedia.org/wiki/Unix_philosophy)");
    expect(article).toContain("(https://pages.example/posts/plain-text)");
    expect(article).toContain("```markdown\n# Groceries");
    expect(article).toContain(
      "![A shelf of paper notebooks](https://pages.example/images/shelf.jpg)",
    );
    expect(article).toContain("> Write programs to handle text streams");

    for (const chrome of ["Subscribe", "Archive", "window.track", "One more post"]) {
      expect(article, chrome).not.toContain(chrome);
    }
  });

  it("spells a plain table as GFM and flattens one with spans or blocks", () => {
    expect(written(read("news-article").article.blocks)).toMatch(/^\| Year \| Event +\|$/mu);
    const timetable = written(read("complex-table").article.blocks);
    expect(timetable).not.toContain("|");
    expect(timetable).toContain("North Quay · 05:40 · 07:10");
  });

  it("keeps code languages, nested lists and inline code, in a table's cell too", () => {
    const article = written(read("docs-page").article.blocks);
    expect(article).toMatch(/^\| `interval` +\| 60 /mu);
    expect(article).toContain("```toml\ninterval = 30");
    expect(article).toContain("`~/.config/tidepool/sync.toml`");
    expect(article).toMatch(/- On macOS it lives under your home folder\./u);
  });

  it("never names one of the dialect's own fenced blocks as a code block's language", () => {
    const { blocks } = read("docs-page").article;
    const article = written(blocks);
    expect(article).toContain("```\n<b>Synced</b> at noon\n```");
    expect(article).toContain('```\n{"type": "bar"}\n```');
    expect(article.toLowerCase()).not.toContain("```inteligir-");
    expect(
      [...typesIn(blocks)].filter((type) => type.endsWith("_block") && type !== "code_block"),
    ).toStrictEqual([]);
  });

  it("reads a definition list as a list, each term with its definition under it", () => {
    expect(written(read("docs-page").article.blocks)).toContain(
      "- The daemon exits at once\n\n  Check the file for a syntax error; the log names the line.",
    );
  });

  it("keeps nothing a script, a frame, an object or a form put there", () => {
    const article = written(read("script-heavy").article.blocks);
    expect(article).toContain("offline mode");

    for (const hostile of [
      "injected",
      SCRIPT_SCHEME,
      "ads.example",
      "Tell us what you think",
      "plugin.swf",
    ]) {
      expect(article, hostile).not.toContain(hostile);
    }
  });

  it("reads a video's description as its article when asked to", () => {
    const video = readOf(page("video-page"), "description");
    expect(video.rung).toBe("text");
    expect(video.article.blocks).toStrictEqual([
      {
        children: [{ text: "A quick guide to a first loaf: starter, dough, fold, bake." }],
        id: "page1",
        type: "p",
      },
    ]);
  });

  it("keeps a table's caption before the table, and reads such a page as its tree", () => {
    const captioned = readOf(
      articlePage(
        `<table><caption>Departures from North Quay on weekdays, before the summer timetable starts in June</caption><tr><th>Ferry</th><th>Leaves</th></tr><tr><td>Morning</td><td>05:40</td></tr></table>`,
      ),
    );

    expect(captioned.rung).toBe("rich");
    expect(written(captioned.article.blocks)).toMatch(
      /Departures from North Quay on weekdays, before the summer timetable starts in June\n\n\| Ferry/u,
    );
  });

  it("hands the reader a list item's paragraphs and its nested lists, less a short list it reads as a blog's metadata", () => {
    const { readable } = extracted("nested-lists");

    if (readable.kind !== "content") {
      throw new Error("the extractor gave up on the page");
    }

    for (const kept of [
      "Seeing it all at once",
      "Sleeping bag and pad at the bottom",
      "One spare shirt",
      'href="#the-steps"',
      'src="data:image/png;base64,',
    ]) {
      expect(readable.html, kept).toContain(kept);
    }

    for (const dropped of ["Water filter", "Headlamp with fresh batteries", "First aid kit"]) {
      expect(readable.html, dropped).not.toContain(dropped);
    }
  });

  it("reads a list item's paragraphs and the lists under it at their depth, an in-page link as its words and an inline picture as its alt", () => {
    const { blocks } = read("nested-lists").article;

    const textOf: (node: LibraryNode) => string = (node: LibraryNode) =>
      "text" in node ? node.text : node.children.map(textOf).join("");

    const blockOf = (words: string) => blocks.find((block) => textOf(block).startsWith(words));

    expect(blockOf("Lay everything out")).toMatchObject({ indent: 1, listStyleType: "decimal" });
    expect(blockOf("Seeing it all at once")).toMatchObject({ indent: 2, type: "p" });
    expect(blockOf("Sleeping bag and pad")).toMatchObject({ indent: 2, listStyleType: "disc" });
    expect(blockOf("One spare shirt")).toMatchObject({ indent: 3, listStyleType: "disc" });
    expect(blockOf("Weigh the pack")).toMatchObject({ indent: 1, listStart: 3 });
    expect(blockOf("A loaded pack on a scale")).toMatchObject({ indent: 2, type: "p" });
    expect(typesIn(blocks).has("a")).toBe(false);
    expect(JSON.stringify(blocks)).not.toContain("data:");
  });

  it("keeps an in-page link as its words", () => {
    expect(
      written(
        readOf(
          articlePage(
            `<p>See <a href="#section-two">the second section</a> or <a href="/next">the next page</a>.</p>`,
          ),
        ).article.blocks,
      ),
    ).toContain("See the second section or [the next page](https://pages.example/next).");
  });
});

describe("the article's budget", () => {
  it("keeps a long page's leading paragraphs, whole, within the budget", () => {
    const long = longPage(FILL_LIMITS.articleBytes * 2);
    const article = wordsOf(readOf(long.html).article.blocks);
    expect(article).toContain("Paragraph 0 opens with");
    expect(article).not.toContain(`Paragraph ${String(long.paragraphs - 1)} opens`);
    expect(article.trimEnd().endsWith("ordinary prose.")).toBe(true);
    expect(article.length).toBeLessThan(FILL_LIMITS.articleBytes);
    expect(article.length).toBeGreaterThan(FILL_LIMITS.articleBytes / 3);
  });

  it("opens one wrapper past the budget rather than losing the whole page", () => {
    const long = longPage(FILL_LIMITS.articleBytes * 2);

    const wrapped = long.html
      .replace("<article>", "<article><div><div>")
      .replace("</article>", "</div></div></article>");

    const article = wordsOf(readOf(wrapped).article.blocks);
    expect(article).toContain("Paragraph 0 opens with");
    expect(article).not.toContain(`Paragraph ${String(long.paragraphs - 1)} opens`);
  });

  it("leaves a page within the budget whole", () => {
    const short = longPage(FILL_LIMITS.articleBytes / 4);
    expect(wordsOf(readOf(short.html).article.blocks)).toContain(
      `Paragraph ${String(short.paragraphs - 1)} opens`,
    );
  });
});

describe("a page's text the dialect would read as its own", () => {
  const { blocks } = read("dialect-hazards").article;
  const text = wordsOf(blocks);

  it.each([
    "{{x}}",
    "{{ user.name }}",
    "@2026-01-02",
    "%% hidden %%",
    ":::tabs",
    "$$5",
    "$x$",
    "<div>",
    "&copy;",
    "~x~",
    "[[x]]",
    "==this==",
    "%%i:abc:start%%",
  ])("%s stays text", (literal) => {
    expect(text).toContain(literal);
  });

  it("reads as nothing but paragraphs of text", () => {
    expect([...typesIn(blocks)].toSorted()).toStrictEqual(["p", "text"]);
  });
});

describe("a page the tree cannot hold", () => {
  it("reads as its words when the page nests past any recursion", () => {
    const depth = 3000;

    const deep = readOf(
      `<html><body><article>${"<blockquote>".repeat(depth)}deep words here${"</blockquote>".repeat(depth)}<p>after them</p></article></body></html>`,
    );

    expect(deep.rung).toBe("text");
    expect(wordsOf(deep.article.blocks)).toBe("deep words here\nafter them\n");
  });

  it.each([
    ["sections", "<div>", "</div>", "rich"],
    ["marks", "<em>", "</em>", "rich"],
    ["quotes", "<blockquote>", "</blockquote>", "text"],
  ])("keeps the words under 250 nested %s", (_name, open, close, rung) => {
    const deep = readOf(
      articlePage(`${open.repeat(250)}<p>deep words here</p>${close.repeat(250)}`),
    );

    expect(deep.rung).toBe(rung);
    expect(wordsOf(deep.article.blocks)).toContain("deep words here");
  });

  it("reads as its words when the tree would lose them to a block no store takes", () => {
    const depth = 40;

    const quoted = readOf(
      articlePage(
        `${"<blockquote>".repeat(depth)}<p>Words quoted deeper than a block may nest, which the page still says and the article still keeps, every one of them.</p>${"</blockquote>".repeat(depth)}`,
      ),
    );

    expect(quoted.rung).toBe("text");
    expect(wordsOf(quoted.article.blocks)).toContain("Words quoted deeper than a block may nest");
    expect([...typesIn(quoted.article.blocks)].toSorted()).toStrictEqual(["p", "text"]);
  });
});

describe("every corpus page", () => {
  const names = readdirSync(CORPUS)
    .filter((file) => file.endsWith(".html"))
    .map((file) => file.slice(0, -".html".length))
    .toSorted();

  it.each(names)("%s reads as the words its snapshot holds, read as a tree", async (name) => {
    const { article, rung } = read(name);
    expect(rung).toBe("rich");
    expect(article.refused).toBe(0);
    await expect(wordsOf(article.blocks)).toMatchFileSnapshot(
      path.join(CORPUS, `${name}.article.txt`),
    );
  });

  it.each(names)("%s names every block with the host's ids, in order", (name) => {
    const { blocks } = read(name).article;
    expect(blocks.map((block) => block.id)).toStrictEqual(
      blocks.map((_, index) => `page${String(index + 1)}`),
    );
  });

  it("keeps a page's hashtag and highlight spelling as the page's text", () => {
    const { blocks } = readOf(
      "<html><body><article><p>A post about #rust with ==marks== and a %%note%% in it, longer than a line.</p></article></body></html>",
    ).article;

    const stored = JSON.stringify(blocks);
    expect(stored).not.toContain('"tag"');
    expect(stored).toContain("#rust");
  });
});
