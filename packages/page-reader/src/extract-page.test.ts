// the reader over a committed corpus of synthetic pages: what a page says about itself in the
// precedence page-meta.ts names, the article rules, the dialect escapes, and the body ladder's
// promise that every article is already the editor's own fixpoint, over linkedom, the DOM the Mac's
// fill worker and the phone's runtime under node parse with. The phone's page parses with its
// WebView's own DOMParser, which tools/e2e/src/scenarios/phone-editor-page.ts drives in a real
// browser against this same reading (jsdom's DOM is no stand-in: defuddle picks the whole body).

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { analyzeMarkdown, parseMarkdown } from "@repo/editor/markdown/markdown-doc";
import { composeLinkBody } from "@repo/notes/items/item-body";
import { composeItemFile } from "@repo/notes/items/item-frontmatter";
import { FILL_LIMITS } from "@repo/notes/items/link-fill";

import { extractPage, extractPageBlocks, KEPT_MIN } from "./extract-page";
import type { ParsePage } from "./extract-page";
import { parsePage } from "./linkedom-page";
import type { ExtractedPage } from "./page-facts";
import { longPage } from "./test-support/long-page";

// spelled in two halves: the scheme the article must not hold, never a link of this suite's
const SCRIPT_SCHEME = ["java", "script:"].join("");

const CORPUS = path.join(import.meta.dirname, "test-support/corpus");
const PAGE_URL = "https://pages.example/posts/item";

const page = (name: string): string => readFileSync(path.join(CORPUS, `${name}.html`), "utf-8");

const extracted = (
  name: string,
  prefer: "article" | "description" = "article",
  parse: ParsePage = parsePage,
): ExtractedPage => extractPage({ html: page(name), prefer, url: PAGE_URL }, parse);

interface SlateNode {
  type?: string;
  text?: string;
  children?: SlateNode[];
}

const nodesOf = (markdown: string): SlateNode[] => {
  const parsed = parseMarkdown(markdown);
  if (!parsed.ok) {
    throw new Error(`the article did not parse: ${parsed.reason.kind}`);
  }
  const all: SlateNode[] = [];
  const walk = (nodes: readonly SlateNode[]): void => {
    for (const node of nodes) {
      all.push(node);
      walk(node.children ?? []);
    }
  };
  walk(parsed.value);
  return all;
};

const textOf = (markdown: string): string =>
  nodesOf(markdown)
    .map((node) => node.text ?? "")
    .join("");

describe("page meta", () => {
  it("takes og before JSON-LD before the extractor and <title>, the secure image first", () => {
    const { facts } = extracted("blog-post");
    expect(facts.title).toBe("Keep your notes in files");
    expect(facts.site).toBe("Field Notes");
    expect(facts.description).toBe("Plain files outlive the apps that made them.");
    expect(facts.images).toEqual([
      "https://cdn.fieldnotes.example/cover@2x.jpg",
      "https://pages.example/images/cover.jpg",
    ]);
    // a JSON-LD byline is structured, so it beats the plain author meta
    expect(facts.author).toBe("A. Lindqvist (JSON-LD)");
    // an ISO time keeps the day it was written in, not UTC's
    expect(facts.published).toBe("2024-03-05");
    expect(facts.lang).toBe("en");
  });

  it("reads twitter tags and a JSON-LD @graph with several authors", () => {
    const { facts } = extracted("news-article");
    expect(facts.title).toBe("Harbour bridge reopens after two years of repairs");
    expect(facts.site).toBe("The Coastal Herald");
    expect(facts.author).toBe("Maya Okafor, Tom Reyes");
    expect(facts.published).toBe("2025-11-02");
    expect(facts.images).toEqual([
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
    expect(facts.author).toBe("Crumb Kitchen");
  });

  it("drops a script url among the images", () => {
    expect(extracted("script-heavy").facts.images).toEqual(["https://cdn.app.example/v4.png"]);
  });
});

describe("the article", () => {
  it("keeps the prose, absolute links, a fenced code block and the picture, and none of the chrome", () => {
    const { article } = extracted("blog-post");
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
    expect(extracted("news-article").article).toMatch(/^\| Year \| Event +\|$/mu);
    const timetable = extracted("complex-table").article;
    expect(timetable).not.toContain("|");
    expect(timetable).toContain("North Quay · 05:40 · 07:10");
  });

  it("keeps code languages, nested lists and inline code", () => {
    const { article } = extracted("docs-page");
    expect(article).toContain("```toml\ninterval = 30");
    expect(article).toContain("`~/.config/tidepool/sync.toml`");
    expect(article).toMatch(/- On macOS it lives under your home folder\./u);
  });

  it("never names one of the dialect's own fenced blocks as a code block's language", () => {
    const { article } = extracted("docs-page");
    expect(article).toContain("```\n<b>Synced</b> at noon\n```");
    expect(article).toContain('```\n{"type": "bar"}\n```');
    expect(article.toLowerCase()).not.toContain("```inteligir-");
    const types = new Set(nodesOf(article).map((node) => node.type ?? "text"));
    expect([...types].filter((type) => type.endsWith("_block") && type !== "code_block")).toEqual(
      [],
    );
  });

  it("keeps nothing a script, a frame, an object or a form put there", () => {
    const { article } = extracted("script-heavy");
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

  it("writes a video's description as its article when asked to", () => {
    expect(extracted("video-page", "description").article).toBe(
      "A quick guide to a first loaf: starter, dough, fold, bake.\n",
    );
  });
});

describe("the article's budget", () => {
  // a page twice the article's budget on purpose, which takes seconds to read
  it(
    "keeps a long page's leading paragraphs, whole, within the budget",
    { timeout: 30_000 },
    () => {
      const long = longPage(FILL_LIMITS.articleBytes * 2);
      const { article } = extractPage(
        { html: long.html, prefer: "article", url: PAGE_URL },
        parsePage,
      );
      expect(article).toContain("Paragraph 0 opens with");
      expect(article).not.toContain(`Paragraph ${String(long.paragraphs - 1)} opens`);
      // whole paragraphs: the last one kept ends its sentence
      expect(article.trimEnd().endsWith("ordinary prose.")).toBe(true);
      // markdown is shorter than the markup it was read from, which the budget counts
      expect(article.length).toBeLessThan(FILL_LIMITS.articleBytes);
      expect(article.length).toBeGreaterThan(FILL_LIMITS.articleBytes / 3);
    },
  );

  // a page twice the article's budget on purpose, which takes seconds to read
  it(
    "opens one wrapper past the budget rather than losing the whole page",
    { timeout: 30_000 },
    () => {
      const long = longPage(FILL_LIMITS.articleBytes * 2);
      const wrapped = long.html
        .replace("<article>", "<article><div><div>")
        .replace("</article>", "</div></div></article>");
      const { article } = extractPage(
        { html: wrapped, prefer: "article", url: PAGE_URL },
        parsePage,
      );
      expect(article).toContain("Paragraph 0 opens with");
      expect(article).not.toContain(`Paragraph ${String(long.paragraphs - 1)} opens`);
    },
  );

  it("leaves a page within the budget whole", () => {
    const short = longPage(FILL_LIMITS.articleBytes / 4);
    const { article } = extractPage(
      { html: short.html, prefer: "article", url: PAGE_URL },
      parsePage,
    );
    expect(article).toContain(`Paragraph ${String(short.paragraphs - 1)} opens`);
  });
});

describe("the dialect escapes", () => {
  const { article } = extracted("dialect-hazards");
  const text = textOf(article);
  const types = new Set(nodesOf(article).map((node) => node.type ?? "text"));

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
    expect([...types].toSorted()).toEqual(["p", "text"]);
  });
});

describe("every corpus page", () => {
  const names = readdirSync(CORPUS)
    .filter((name) => name.endsWith(".html"))
    .map((name) => name.slice(0, -".html".length))
    .toSorted();

  it.each(names)("%s is the editor's fixpoint, kept whole or on a lower rung", (name) => {
    const result = extracted(name);
    expect(analyzeMarkdown(result.article).kind).toBe("canonical");
    expect(result.kept >= KEPT_MIN || result.rung !== "rich").toBe(true);
  });

  it.each(names)("%s composes into an item that opens rich", (name) => {
    const { article, facts } = extracted(name);
    const item = composeItemFile(
      {
        description: facts.description,
        fetched: "2026-10-17T09:12:33Z",
        id: "7d2f9e40-1c6b-4a8e-9f31-5b0a6c2e8d17",
        kind: "link",
        saved: "2026-10-17T09:12:30Z",
        site: facts.site,
        url: PAGE_URL,
      },
      composeLinkBody({
        article,
        copy: "assets/pages/3f9a0c2b1d4e5f60.html",
        cover: "assets/covers/3f9a0c2b1d4e5f60.jpg",
        note: "For Tuesday.\n",
      }),
    );
    expect(analyzeMarkdown(item).kind).toBe("canonical");
  });
});

describe("the body ladder", () => {
  it("falls to the plain text rung for a page nested past any recursion", () => {
    const depth = 3000;
    const result = extractPage(
      {
        html: `<html><body><article>${"<blockquote>".repeat(depth)}deep words here${"</blockquote>".repeat(depth)}<p>after them</p></article></body></html>`,
        prefer: "article",
        url: PAGE_URL,
      },
      parsePage,
    );
    expect(result.rung).toBe("text");
    expect(result.article).toBe("deep words here\n\nafter them\n");
    expect(analyzeMarkdown(result.article).kind).toBe("canonical");
  });
});

// block ids from a counter, as a host mints its own
const counter = (): (() => string) => {
  let next = 0;
  return () => {
    next += 1;
    return `page${String(next)}`;
  };
};

describe("the article as blocks", () => {
  const names = readdirSync(CORPUS)
    .filter((file) => file.endsWith(".html"))
    .map((file) => file.slice(0, -".html".length));
  it.each(names)("%s reads as its item's article section, every block stored", (name) => {
    const html = page(name);
    const read = extractPageBlocks(
      { html, prefer: "article", url: PAGE_URL },
      parsePage,
      counter(),
    );
    const { article } = extractPage({ html, prefer: "article", url: PAGE_URL }, parsePage);
    expect(read.article.refused).toEqual([]);
    expect(read.article.blocks.every((placed) => placed.section === "article")).toBe(true);
    expect(read.article.blocks.map((placed) => placed.block.id)).toEqual(
      read.article.blocks.map((_, index) => `page${String(index + 1)}`),
    );
    // the blocks hold the article's words: each text the markdown read as, found in the blocks
    const stored = JSON.stringify(read.article.blocks.map((placed) => placed.block));
    const words = nodesOf(article).flatMap((node) =>
      (node.text ?? "").split(/\W+/u).filter((word) => word !== ""),
    );
    expect(words.filter((word) => !stored.includes(word))).toEqual([]);
  });

  it("keeps a page's hashtag and highlight spelling as the page's text", () => {
    const read = extractPageBlocks(
      {
        html: "<html><body><article><p>A post about #rust with ==marks== and a %%note%% in it, longer than a line.</p></article></body></html>",
        prefer: "article",
        url: PAGE_URL,
      },
      parsePage,
      counter(),
    );
    const stored = JSON.stringify(read.article.blocks);
    expect(stored).not.toContain('"tag"');
    expect(stored).not.toContain('"annotationMarker"');
    expect(stored).not.toContain('"opaque"');
    expect(stored).toContain("#rust");
  });
});
