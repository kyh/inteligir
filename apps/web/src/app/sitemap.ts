import type { MetadataRoute } from "next";

import { LEGAL_DOCS } from "#lib/legal-docs";
import { PAGES, statedDate } from "#lib/page-meta";
import { siteConfig } from "#lib/site-config";
import { SITEMAP_PATHS } from "#lib/site-content";

const STATED: ReadonlyMap<string, string | null> = new Map([
  [PAGES.privacy.path, statedDate(LEGAL_DOCS.privacy)],
  [PAGES.terms.path, statedDate(LEGAL_DOCS.terms)],
]);

const sitemap = () =>
  SITEMAP_PATHS.map((path) => {
    const url = `${siteConfig.url}${path}`;
    const lastModified = STATED.get(path) ?? undefined;

    return lastModified === undefined ? { url } : { lastModified, url };
  }) satisfies MetadataRoute.Sitemap;

export default sitemap;
