import { createElement } from "react";
import { renderToString } from "react-dom/server";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { describe, expect, it } from "vitest";

// the docs the legal pages render, read as those routes read them
import privacy from "../../../../../docs/privacy.md?raw";
import terms from "../../../../../docs/terms.md?raw";
import { headingSlug, rehypeHeadingIds } from "../heading-ids";

// the pipeline MarkdownPage runs, without the page chrome that needs a router
const render = (markdown: string): string =>
  renderToString(
    createElement(
      Markdown,
      { rehypePlugins: [rehypeHeadingIds], remarkPlugins: [remarkGfm] },
      markdown,
    ),
  );

const ANCHOR_LINK = /\]\(#(?<anchor>[^)\s]+)\)/gu;
const ELEMENT_ID = /\bid="(?<id>[^"]+)"/gu;

const anchorsIn = (markdown: string): string[] =>
  [...markdown.matchAll(ANCHOR_LINK)].flatMap((match) => match.groups?.anchor ?? []);

const idsIn = (html: string): string[] =>
  [...html.matchAll(ELEMENT_ID)].flatMap((match) => match.groups?.id ?? []);

describe("heading ids", () => {
  it.each([
    ["Tracking & Other Technologies", "tracking--other-technologies"],
    ["How we use your personal information", "how-we-use-your-personal-information"],
    ["Changes to this Privacy Policy", "changes-to-this-privacy-policy"],
    ["5. Third-Party Services & Other Users", "5-third-party-services--other-users"],
    ["11. Dispute Resolution", "11-dispute-resolution"],
  ])("anchors %s as GitHub does", (heading, slug) => {
    expect(headingSlug(heading)).toBe(slug);
  });

  it("numbers a repeated heading as GitHub does, afresh for each document", () => {
    const markdown = "# Notes\n\n## Retention\n\nOne.\n\n### Retention\n\nTwo.\n\n## Retention\n";
    expect(idsIn(render(markdown))).toEqual(["notes", "retention", "retention-1", "retention-2"]);
    expect(idsIn(render(markdown))).toEqual(["notes", "retention", "retention-1", "retention-2"]);
  });

  it("reads a heading's text through its inline markup", () => {
    expect(idsIn(render("## The **bold** `code` part\n"))).toEqual(["the-bold-code-part"]);
  });
});

describe("the legal docs", () => {
  it.each([
    ["docs/privacy.md", privacy],
    ["docs/terms.md", terms],
  ])("%s renders every heading with a distinct id", (_doc, markdown) => {
    const ids = idsIn(render(markdown));
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("lands every link in the privacy policy's index on one of its headings", () => {
    const anchors = anchorsIn(privacy);
    expect(anchors, "docs/privacy.md has no in-page links: the index is gone").toContain(
      "every-address-the-app-talks-to",
    );
    const ids = new Set(idsIn(render(privacy)));
    expect(anchors.filter((anchor) => !ids.has(anchor))).toEqual([]);
  });

  it("links the terms to the privacy policy", () => {
    expect(terms).toContain("https://inteligir.com/privacy");
  });
});
