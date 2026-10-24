import { siteConfig } from "@/lib/site-config";

export interface SitemapEntry {
  path: string;
  // ISO date; left out where nothing states when the page last changed
  lastModified?: string | null | undefined;
}

const escapeXml = (text: string): string =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

export const buildSitemap = (entries: readonly SitemapEntry[]): string =>
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries.map(({ path, lastModified }) => {
      const loc = `<loc>${escapeXml(`${siteConfig.url}${path}`)}</loc>`;
      const lastmod =
        lastModified === undefined || lastModified === null
          ? ""
          : `<lastmod>${lastModified}</lastmod>`;
      return `  <url>${loc}${lastmod}</url>`;
    }),
    "</urlset>",
    "",
  ].join("\n");
