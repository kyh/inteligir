import { describe, expect, it } from "vitest";

import sitemap from "../app/sitemap";
import { LEGAL_DOCS } from "./legal-docs";
import { PAGES, statedDate } from "./page-meta";
import { pageMetadata, pageTitle } from "./page-metadata";
import { siteConfig } from "./site-config";
import { homeMarkdown } from "./site-content";
import { pageGraph } from "./structured-data";

describe("page metadata", () => {
  it("gives every page a distinct title and description", () => {
    const pages = Object.values(PAGES);
    expect(new Set(pages.map(pageTitle)).size).toBe(pages.length);
    expect(new Set(pages.map((page) => page.description)).size).toBe(pages.length);
  });

  it("reads the effective date each legal doc states", () => {
    expect(statedDate(LEGAL_DOCS.privacy)).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
    expect(statedDate(LEGAL_DOCS.terms)).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
    expect(statedDate("Effective as of October 3, 2026.")).toBe("2026-10-03");
    expect(statedDate("no date here")).toBeNull();
  });

  it("names the page's own URL and image in its card, and its canonical address", () => {
    const image = { url: `${siteConfig.url}/og/about.jpg` };
    expect(pageMetadata(PAGES.about)).toMatchObject({
      alternates: { canonical: `${siteConfig.url}/about` },
      openGraph: { images: [image], type: "website", url: `${siteConfig.url}/about` },
      title: { absolute: `About · ${siteConfig.name}` },
      twitter: { images: [image] },
    });
  });

  it("titles the home page as its own heading names it", () => {
    expect(homeMarkdown.split("\n", 1)[0]).toBe(`# ${siteConfig.name}: ${PAGES.home.title}`);
  });

  it("gives the home page its own image, at the site's root", () => {
    const image = { url: `${siteConfig.url}/og.jpg` };
    expect(pageMetadata(PAGES.home)).toMatchObject({
      alternates: { canonical: siteConfig.url },
      openGraph: { images: [image] },
      twitter: { images: [image] },
    });
  });

  it("dates a legal page as an article by the day its doc states", () => {
    expect(pageMetadata(PAGES.terms, { dateModified: "2026-10-03" })).toMatchObject({
      openGraph: { modifiedTime: "2026-10-03", type: "article" },
    });
  });

  it("gives a page below the root a two-step breadcrumb", () => {
    const [, breadcrumb] = pageGraph(PAGES.terms)["@graph"];
    expect(breadcrumb?.itemListElement).toHaveLength(2);
  });
});

describe("the sitemap", () => {
  it("lists a lastModified only where a doc states one", () => {
    const entries = sitemap();
    expect(entries).toContainEqual({ url: `${siteConfig.url}/` });
    expect(entries).toContainEqual({
      lastModified: statedDate(LEGAL_DOCS.terms),
      url: `${siteConfig.url}/terms`,
    });
  });
});
