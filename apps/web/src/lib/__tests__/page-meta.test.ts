import { describe, expect, it } from "vitest";

import { pageHead, pageTitle } from "../page-head";
import { HOME_VIDEO, PAGES, statedDate } from "../page-meta";
import { siteConfig } from "../site-config";
import { buildSitemap } from "../sitemap";
import { pageGraph } from "../structured-data";

import privacy from "../../../../../docs/privacy.md?raw";
import terms from "../../../../../docs/terms.md?raw";

const metaContent = (head: ReturnType<typeof pageHead>, key: string): string | undefined => {
  for (const tag of head.meta) {
    if (("property" in tag && tag.property === key) || ("name" in tag && tag.name === key)) {
      return "content" in tag ? tag.content : undefined;
    }
  }
  return undefined;
};

describe("page metadata", () => {
  it("gives every page a distinct title and description", () => {
    const pages = Object.values(PAGES);
    expect(new Set(pages.map(pageTitle)).size).toBe(pages.length);
    expect(new Set(pages.map((page) => page.description)).size).toBe(pages.length);
  });

  it("reads the effective date each legal doc states", () => {
    expect(statedDate(privacy)).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
    expect(statedDate(terms)).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
    expect(statedDate("Effective as of October 3, 2026.")).toBe("2026-10-03");
    expect(statedDate("no date here")).toBeNull();
  });

  it("names the page's own URL and image in its Open Graph tags", () => {
    const head = pageHead(PAGES.about);
    expect(metaContent(head, "og:url")).toBe(`${siteConfig.url}/about`);
    expect(metaContent(head, "og:image")).toBe(`${siteConfig.url}/og/about.jpg`);
    expect(metaContent(head, "og:video")).toBeUndefined();
  });

  it("carries the captured clip on the home page, beside its image", () => {
    const head = pageHead(PAGES.home);
    expect(metaContent(head, "og:video:secure_url")).toBe(`${siteConfig.url}${HOME_VIDEO.path}`);
    expect(metaContent(head, "og:video:type")).toBe("video/mp4");
    expect(metaContent(head, "og:image")).toBe(`${siteConfig.url}/og.jpg`);
    const [page] = pageGraph(PAGES.home)["@graph"];
    expect(page !== undefined && "video" in page ? page.video?.contentUrl : undefined).toBe(
      `${siteConfig.url}${HOME_VIDEO.path}`,
    );
  });

  it("gives a page below the root a two-step breadcrumb", () => {
    const [, breadcrumb] = pageGraph(PAGES.terms)["@graph"];
    expect(breadcrumb?.itemListElement).toHaveLength(2);
  });
});

describe("the sitemap", () => {
  it("lists a lastmod only where a date is stated", () => {
    const xml = buildSitemap([{ path: "/" }, { lastModified: "2026-10-03", path: "/terms" }]);
    expect(xml).toContain(`<url><loc>${siteConfig.url}/</loc></url>`);
    expect(xml).toContain(
      `<url><loc>${siteConfig.url}/terms</loc><lastmod>2026-10-03</lastmod></url>`,
    );
  });
});
