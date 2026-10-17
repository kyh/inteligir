import { describe, expect, it } from "vitest";
import { absolutizeCssUrls, freezeStyles } from "../freeze-styles";

// the window's own document: jsdom builds sheets only for a document with a browsing context
const pageOf = (head: string, body = "<p>text</p>"): Document => {
  document.head.innerHTML = head;
  document.body.innerHTML = body;
  Object.defineProperty(document, "adoptedStyleSheets", { configurable: true, value: [] });
  return document;
};

const frozen = (doc: Document): Element => {
  const cloned = doc.documentElement.cloneNode(true);
  if (!(cloned instanceof Element)) {
    throw new Error("the clone is not an element");
  }
  freezeStyles(doc, cloned);
  return cloned;
};

describe("frozen styles", () => {
  it("writes rules a script inserted through the CSSOM, in the sheet's own place", () => {
    const doc = pageOf(
      '<style id="a">h1 { color: red; }</style><style id="b">/* filled by script */</style>',
    );
    const [, inserted] = doc.styleSheets;
    inserted?.insertRule("p { margin: 3px; }");
    const styles = [...frozen(doc).querySelectorAll("style")];
    expect(styles).toHaveLength(2);
    expect(styles[0]?.textContent).toContain("h1 { color: red; }");
    expect(styles[1]?.textContent).toContain("p { margin: 3px; }");
  });

  it("keeps a sheet's media, and leaves a sheet the page may not read as its element", () => {
    const doc = pageOf(
      '<style media="print">p { color: blue; }</style><style>em { x: y; }</style>',
    );
    const [, foreign] = doc.styleSheets;
    if (foreign !== undefined) {
      Object.defineProperty(foreign, "cssRules", {
        get: () => {
          throw new DOMException("not this origin's", "SecurityError");
        },
      });
    }
    const out = frozen(doc);
    const styles = [...out.querySelectorAll("style")];
    expect(styles[0]?.getAttribute("media")).toBe("print");
    expect(styles[0]?.textContent).toBe("p { color: blue; }");
    // the unreadable one is the original element, its text as the markup had it
    expect(styles[1]?.textContent).toBe("em { x: y; }");
  });

  it("appends a constructed sheet after the document's own", () => {
    const doc = pageOf("<style>p { color: red; }</style>");
    const constructed = new CSSStyleSheet();
    constructed.insertRule(".adopted { color: green; }");
    Object.defineProperty(doc, "adoptedStyleSheets", { configurable: true, value: [constructed] });
    const styles = [...frozen(doc).querySelectorAll("head style")];
    expect(styles.at(-1)?.textContent).toContain(".adopted { color: green; }");
  });

  it("writes a linked sheet's relative urls whole, since inlined they would resolve against the page", () => {
    expect(
      absolutizeCssUrls(
        'a { background: url(img/x.png) } b { background: url("../y.png") } c { mask: url(data:image/png;base64,AA) } d { fill: url(#g) }',
        "https://cdn.test/css/site.css",
      ),
    ).toBe(
      'a { background: url("https://cdn.test/css/img/x.png") } b { background: url("https://cdn.test/y.png") } c { mask: url(data:image/png;base64,AA) } d { fill: url(#g) }',
    );
    expect(absolutizeCssUrls("a { background: url(x.png) }", null)).toBe(
      "a { background: url(x.png) }",
    );
  });
});
