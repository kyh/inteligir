// the tree a page's readable part is read as, without the extractor in front of it: what a page
// may write (a link and a picture by a web address, code by its own language) and where a page
// past the article's budget is cut.

import type { Nodes, Root } from "mdast";
import { describe, expect, it } from "vitest";

import { FILL_LIMITS } from "@repo/contract/items/link-fill";

import { articleMdast, articleTree } from "./article-tree";
import { HAST, wordsOf } from "./page-words";

// spelled in two halves: the scheme the tree must not hold, never a link of this suite's
const SCRIPT_SCHEME = ["java", "script:"].join("");

const PAGE_URL = "https://pages.example/posts/item";

const treeOf = (html: string): Root => articleMdast(articleTree(html), PAGE_URL);

// every node of the tree in the page's order, less where it stood in the source
const nodesOf = (root: Root): Nodes[] => {
  const all: Nodes[] = [];
  const pending: Nodes[] = [root];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    const { position: _position, ...rest } = node;
    all.push(rest);
    if ("children" in node) {
      pending.push(...node.children.toReversed());
    }
  }
  return all;
};

const linksIn = (html: string): string[] =>
  nodesOf(treeOf(html)).flatMap((node) => (node.type === "link" ? [node.url] : []));

const picturesIn = (html: string): string[] =>
  nodesOf(treeOf(html)).flatMap((node) => (node.type === "image" ? [node.url] : []));

const textIn = (html: string): string =>
  nodesOf(treeOf(html))
    .flatMap((node) => (node.type === "text" ? [node.value] : []))
    .join("");

const kindsIn = (html: string): string[] => nodesOf(treeOf(html)).map((node) => node.type);

// a table's rows, each cell as its plain text
const rowsIn = (html: string): string[][] =>
  nodesOf(treeOf(html))
    .flatMap((node) => (node.type === "tableRow" ? [node] : []))
    .map((row) =>
      row.children.map((cell) =>
        cell.children.map((child) => (child.type === "text" ? child.value : "")).join(""),
      ),
    );

describe("what a page may write", () => {
  it.each([
    "#section-two",
    `${SCRIPT_SCHEME}alert(1)`,
    "mention:0190a0a0-0000-7000-8000-000000000001",
    "data:text/html,<b>x</b>",
    "mailto:someone@pages.example",
  ])("a link to %s is its words", (href) => {
    const html = `<p>Read <a href="${href}">these words</a> on.</p>`;
    expect(linksIn(html)).toStrictEqual([]);
    expect(textIn(html)).toBe("Read these words on.");
  });

  it("a link to the web is absolute against the page, whatever base the page names", () => {
    expect(
      linksIn(
        `<base href="https://elsewhere.example/"><p><a href="/next">Next</a> and <a href="https://other.example/a?b=c">other</a></p>`,
      ),
    ).toStrictEqual(["https://pages.example/next", "https://other.example/a?b=c"]);
  });

  it("a base no address can stand on fails no read", () => {
    expect(linksIn(`<base href="//[bad"><p><a href="/next">Next</a></p>`)).toStrictEqual([
      "https://pages.example/next",
    ]);
  });

  it("a picture is one by a web address, and its alt anywhere else", () => {
    const html = `<p><img src="/shelf.jpg" alt="A shelf"></p><p><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="Drawn inline"></p><p><img alt="No address"></p><p><image src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="An old tag"></p>`;
    expect(picturesIn(html)).toStrictEqual(["https://pages.example/shelf.jpg"]);
    expect(textIn(html)).toBe("Drawn inlineNo addressAn old tag");
  });

  it("a picture inside a link stands before the link's words, and alone where it has none", () => {
    expect(kindsIn(`<p><a href="/big"><img src="/thumb.png" alt="A thumb"></a></p>`)).toStrictEqual(
      ["root", "paragraph", "image"],
    );
    expect(
      kindsIn(`<p><a href="/post"><img src="/thumb.png" alt="A thumb"> Read the post</a></p>`),
    ).toStrictEqual(["root", "paragraph", "image", "link", "text"]);
  });

  it("a table of plain rows is headed by its first, and one with a head by that", () => {
    expect(
      rowsIn(`<table><tr><td>a1</td><td>b1</td></tr><tr><td>a2</td><td>b2</td></tr></table>`),
    ).toStrictEqual([
      ["a1", "b1"],
      ["a2", "b2"],
    ]);
    expect(
      rowsIn(
        `<table><thead><tr><th>Name</th><th>Value</th></tr></thead><tr><td>x</td><td>1</td></tr></table>`,
      ),
    ).toStrictEqual([
      ["Name", "Value"],
      ["x", "1"],
    ]);
  });

  it("code keeps its language, unless that names one of the dialect's own fenced blocks", () => {
    const code = nodesOf(
      treeOf(
        `<pre><code class="language-toml">a = 1</code></pre><pre><code class="language-inteligir-html">&lt;b&gt;x&lt;/b&gt;</code></pre><pre><code class="language-Inteligir-Chart">{}</code></pre>`,
      ),
    ).flatMap((node) => (node.type === "code" ? [node] : []));
    expect(code).toStrictEqual([
      { lang: "toml", meta: null, type: "code", value: "a = 1" },
      { lang: null, meta: null, type: "code", value: "<b>x</b>" },
      { lang: null, meta: null, type: "code", value: "{}" },
    ]);
  });

  it("nothing a comment, a script or a form holds, and a formula's words", () => {
    const html = `<p>Mass and energy: <math><mi>E</mi><mo>=</mo><mi>m</mi><msup><mi>c</mi><mn>2</mn></msup></math>.</p><!-- a note to self --><script>window.injected = 1</script><form><p>Tell us what you think</p><input value="typed"></form>`;
    expect(textIn(html)).toBe("Mass and energy: E=mc2.");
    expect(new Set(nodesOf(treeOf(html)).map((node) => node.type))).toStrictEqual(
      new Set(["root", "paragraph", "text"]),
    );
  });

  it("only what markdown's own tree names, whatever the page spells", () => {
    const html = `<p>{{x}} :date[2026-01-02] $$x$$ [[Page]] ==mark== %%note%% #tag</p><p>:::tabs</p><blockquote><p>[!NOTE]</p><p>quoted</p></blockquote>`;
    expect(new Set(nodesOf(treeOf(html)).map((node) => node.type))).toStrictEqual(
      new Set(["root", "paragraph", "blockquote", "text"]),
    );
    expect(textIn(html)).toContain("{{x}} :date[2026-01-02] $$x$$ [[Page]] ==mark== %%note%% #tag");
  });
});

const paragraph = (index: number): string =>
  `<p>Paragraph ${String(index)} holds <a href="/notes/${String(index)}">a link</a> and closes with a plain sentence of ordinary prose.</p>`;

const paragraphs = (count: number): string =>
  Array.from({ length: count }, (_, index) => paragraph(index)).join("");

describe("a readable part past the article's budget", () => {
  const count = Math.ceil((FILL_LIMITS.articleBytes * 2) / paragraph(0).length);

  it("is parsed only as far as the budget, and cut between whole blocks", () => {
    const html = paragraphs(count);
    const tree = articleTree(html);
    const end = tree.children.at(-1)?.position?.end.offset ?? 0;
    expect(end).toBeLessThanOrEqual(FILL_LIMITS.articleBytes);
    expect(end).toBeGreaterThan(FILL_LIMITS.articleBytes - 2 * paragraph(0).length);
    const words = wordsOf(tree, HAST);
    expect(words.length).toBe(tree.children.length);
    expect(words.every((text) => text.endsWith("ordinary prose."))).toBe(true);
  });

  it("opens a wrapper the cut fell in, and keeps the blocks before it whole", () => {
    const tree = articleTree(
      `<section><div>${paragraphs(count)}</div></section><p>after the wrapper</p>`,
    );
    const words = wordsOf(tree, HAST);
    expect(words.length).toBeGreaterThan(count / 3);
    expect(words.every((text) => text.endsWith("ordinary prose."))).toBe(true);
  });

  it("drops one block that alone is past it", () => {
    const tree = articleTree(`<p>before</p><pre>${"x".repeat(FILL_LIMITS.articleBytes)}</pre>`);
    expect(wordsOf(tree, HAST)).toStrictEqual(["before"]);
  });

  it("leaves a part within the budget whole", () => {
    const html = paragraphs(10);
    expect(wordsOf(articleTree(html), HAST)).toHaveLength(10);
  });
});
