import type { Metadata } from "next";

import type { PageMeta } from "#lib/page-meta";
import { siteConfig } from "#lib/site-config";

// the pathname alone, so a query string never splits one page into several canonical URLs
export const absoluteUrl = (path: string): string => `${siteConfig.url}${path === "/" ? "" : path}`;

export const pageTitle = (page: PageMeta): string =>
  page.kind === "home" ? `${siteConfig.name}: ${page.title}` : `${page.title} · ${siteConfig.name}`;

/**
 * A page's title, description, canonical address and its own card. A page's `openGraph` and
 * `twitter` replace the layout's whole objects, so each restates the site-wide fields.
 */
export const pageMetadata = (
  page: PageMeta,
  { dateModified }: { dateModified?: string | null } = {},
): Metadata => {
  const title = pageTitle(page);
  const url = absoluteUrl(page.path);
  const image = {
    alt: page.image.alt,
    height: page.image.height,
    url: absoluteUrl(page.image.path),
    width: page.image.width,
  };
  const card = {
    description: page.description,
    images: [image],
    locale: "en_US",
    siteName: siteConfig.name,
    title,
    url,
  };
  return {
    alternates: { canonical: url },
    description: page.description,
    openGraph:
      page.kind === "legal"
        ? { ...card, modifiedTime: dateModified ?? undefined, type: "article" }
        : { ...card, type: "website" },
    title: { absolute: title },
    twitter: {
      card: "summary_large_image",
      creator: siteConfig.twitter,
      description: page.description,
      images: [image],
      title,
    },
  };
};
