import type { PageMeta } from "@/lib/page-meta";
import { statedDate } from "@/lib/page-meta";
import { siteConfig } from "@/lib/site-config";
import { pageGraph } from "@/lib/structured-data";

const absolute = (path: string): string => `${siteConfig.url}${path === "/" ? "" : path}`;

export const pageTitle = (page: PageMeta): string =>
  page.kind === "home" ? `${siteConfig.name}: ${page.title}` : `${page.title} · ${siteConfig.name}`;

/**
 * A route's head: its title, description, Open Graph and Twitter tags and its own JSON-LD. The
 * root route carries the site-wide defaults, and Start keeps the deepest match's tag for each
 * name or property, so these override them. The canonical link is the root document's.
 */
export const pageHead = (page: PageMeta, options: { dateModified?: string } = {}) => {
  const title = pageTitle(page);
  const image = absolute(page.image.path);
  return {
    meta: [
      { title },
      { content: page.description, name: "description" },
      { content: title, property: "og:title" },
      { content: page.description, property: "og:description" },
      { content: absolute(page.path), property: "og:url" },
      { content: page.kind === "legal" ? "article" : "website", property: "og:type" },
      { content: image, property: "og:image" },
      { content: String(page.image.width), property: "og:image:width" },
      { content: String(page.image.height), property: "og:image:height" },
      { content: page.image.alt, property: "og:image:alt" },
      ...(options.dateModified === undefined
        ? []
        : [{ content: options.dateModified, property: "article:modified_time" }]),
      { content: title, name: "twitter:title" },
      { content: page.description, name: "twitter:description" },
      { content: image, name: "twitter:image" },
      { content: page.image.alt, name: "twitter:image:alt" },
      { "script:ld+json": pageGraph(page, options) },
    ],
  };
};

/** A legal page's head, dated by the effective date its own doc states. */
export const legalHead = (page: PageMeta, markdown: string) => {
  const dateModified = statedDate(markdown);
  return pageHead(page, dateModified === null ? {} : { dateModified });
};
