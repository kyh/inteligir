import { describe, expect, it } from "vitest";

import { CAPTURE_OPTIONS } from "./captured-page";
import type { CaptureOptions } from "./captured-page";
import { serializePage } from "./serialize-page";

const OPTIONS: CaptureOptions = CAPTURE_OPTIONS;

const pageOf = (body: string, head = ""): Document => {
  const doc = document.implementation.createHTMLDocument("A rendered page");
  doc.head.insertAdjacentHTML("beforeend", head);
  doc.body.innerHTML = body;
  return doc;
};

const selected = (text: string): Selection => {
  const selection = window.getSelection();
  if (selection === null) {
    throw new Error("jsdom has no selection");
  }
  const node = document.createElement("p");
  node.textContent = text;
  document.body.replaceChildren(node);
  selection.selectAllChildren(node);
  return selection;
};

const parsed = (html: string | null): Document => {
  expect(html).not.toBeNull();
  return new DOMParser().parseFromString(html ?? "", "text/html");
};

describe("the captured page", () => {
  it("is the rendered DOM with a doctype, its title and its address", () => {
    const doc = pageOf("<article><h1>Hello</h1><p>Built by script.</p></article>");
    const page = serializePage(doc, null, OPTIONS);
    expect(page.html?.startsWith("<!doctype html>\n<html")).toBe(true);
    expect(page.title).toBe("A rendered page");
    expect(page.url).toBe(doc.URL);
    expect(parsed(page.html).querySelector("article p")?.textContent).toBe("Built by script.");
  });

  it("drops every script but structured data, and leaves the live page as it was", () => {
    const doc = pageOf(
      '<script>steal()</script><script type="module">x()</script><script type=" Application/LD+JSON ">{"@type":"Article"}</script><p>text</p>',
    );
    const out = parsed(serializePage(doc, null, OPTIONS).html);
    const scripts = [...out.querySelectorAll("script")];
    expect(scripts.map((script) => script.textContent)).toEqual(['{"@type":"Article"}']);
    expect(doc.querySelectorAll("script")).toHaveLength(3);
  });

  it("carries no form value or choice, typed or prefilled, but keeps a button's label", () => {
    const doc = pageOf(
      '<form><input name="q" value="prefilled"><input type="password" value="hunter2"><input type="submit" value="Search"><textarea>draft words</textarea><input type="checkbox" name="news" checked><select name="country"><option value="fr">France</option><option value="nz" selected>New Zealand</option></select></form>',
    );
    const typed = doc.querySelector("input");
    if (typed !== null) {
      typed.value = "typed by the person";
    }
    const html = serializePage(doc, null, OPTIONS).html ?? "";
    expect(html).not.toContain("prefilled");
    expect(html).not.toContain("hunter2");
    expect(html).not.toContain("typed by the person");
    expect(html).not.toContain("draft words");
    const out = parsed(html);
    expect(out.querySelector('input[type="submit"]')?.getAttribute("value")).toBe("Search");
    expect(out.querySelector('input[type="checkbox"]')?.hasAttribute("checked")).toBe(false);
    expect(
      [...out.querySelectorAll("option")].map((option) => option.hasAttribute("selected")),
    ).toEqual([false, false]);
    // the page's list of choices stays: it is the page's, never the person's
    expect([...out.querySelectorAll("option")].map((option) => option.value)).toEqual(["fr", "nz"]);
  });

  it("empties every box a person types rich text into, keeping the page's own text", () => {
    const doc = pageOf(
      [
        "<article><p>The article.</p></article>",
        '<div contenteditable="true"><p>Dear Sam, half a reply</p></div>',
        '<div contenteditable=""><b>a comment</b></div>',
        '<div contenteditable="plaintext-only">a message</div>',
        '<div role="textbox">a field drawn by script</div>',
        '<div contenteditable="FALSE">kept, not editable</div>',
      ].join(""),
    );
    const html = serializePage(doc, null, OPTIONS).html ?? "";
    expect(html).toContain("The article.");
    expect(html).toContain("kept, not editable");
    for (const typed of ["half a reply", "a comment", "a message", "a field drawn by script"]) {
      expect(html).not.toContain(typed);
    }
  });

  it("pins each image to the source the browser chose, as its one source", () => {
    const doc = pageOf(
      '<img src="placeholder.gif" srcset="small.jpg 1x, large.jpg 2x" sizes="50vw"><picture><source media="(min-width: 800px)" srcset="wide.jpg"><img src="narrow.jpg"></picture><img>',
    );
    const [chosen, inPicture] = doc.querySelectorAll("img");
    if (chosen !== undefined && inPicture !== undefined) {
      Object.defineProperty(chosen, "currentSrc", { value: "https://example.test/large.jpg" });
      Object.defineProperty(inPicture, "currentSrc", { value: "https://example.test/wide.jpg" });
    }
    const out = parsed(serializePage(doc, null, OPTIONS).html);
    const images = [...out.querySelectorAll("img")];
    expect(images.map((image) => image.getAttribute("src"))).toEqual([
      "https://example.test/large.jpg",
      "https://example.test/wide.jpg",
      null,
    ]);
    expect(
      images.some((image) => image.hasAttribute("srcset") || image.hasAttribute("sizes")),
    ).toBe(false);
    expect(out.querySelectorAll("source")).toHaveLength(0);
  });

  it("names its base once, as the page resolved it, so relative links still resolve", () => {
    const doc = pageOf('<a href="next">next</a>', '<base href="https://old.test/">');
    const out = parsed(serializePage(doc, null, OPTIONS).html);
    const bases = [...out.querySelectorAll("base")];
    expect(bases.map((base) => base.getAttribute("href"))).toEqual([doc.baseURI]);
    expect(out.head.firstElementChild?.tagName).toBe("BASE");
  });

  it("answers no html past the cap, so the cloud reads the page from its address", () => {
    const doc = pageOf(`<p>${"x".repeat(500)}</p>`);
    const page = serializePage(doc, null, { ...OPTIONS, htmlMaxChars: 400 });
    expect(page.html).toBeNull();
    expect(page.title).toBe("A rendered page");
  });

  it("carries the selection's text, trimmed and capped, and none for an empty one", () => {
    const doc = pageOf("<p>One passage worth keeping.</p>");
    expect(serializePage(doc, selected("  a passage \n"), OPTIONS).selection).toBe("a passage");
    expect(serializePage(doc, selected("   "), OPTIONS).selection).toBeNull();
    expect(serializePage(doc, null, OPTIONS).selection).toBeNull();
    const long = serializePage(doc, selected("y".repeat(25_000)), OPTIONS).selection;
    expect(long).toHaveLength(OPTIONS.selectionMaxChars);
  });
});
