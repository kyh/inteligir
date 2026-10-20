// what a page says about itself, read from its head before anything rewrites the document: the
// Open Graph and Twitter tags, schema.org's JSON-LD and the plain meta tags, each in a fixed order
// of precedence, then the extractor's own reading as the last resort. Every value is the page's
// claim and so hostile: text is collapsed to one line and clipped, a date is kept as written, and
// a url is kept only when it resolves to http or https.

import { z } from "zod";

import type { PageFacts } from "./page-facts";

// the extractor's reading, the fallback for each key
export interface ExtractedMeta {
  title: string;
  site: string;
  author: string;
  published: string;
  description: string;
  image: string;
  domain: string;
}

const TITLE_MAX = 2000;
const SITE_MAX = 80;
const AUTHOR_MAX = 120;
const PUBLISHED_MAX = 40;
const DESCRIPTION_MAX = 1000;
const IMAGES_MAX = 8;
const JSON_LD_MAX_CHARS = 512 * 1024;

// one line, control characters gone, clipped at a word boundary when it can be
const oneLine = (raw: string | null | undefined, max: number): string | null => {
  if (raw === null || raw === undefined) {
    return null;
  }
  const text = raw
    .replaceAll(/\p{Cc}+/gu, " ")
    .replaceAll(/\s+/gu, " ")
    .trim();
  if (text === "") {
    return null;
  }
  if (text.length <= max) {
    return text;
  }
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return (space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd();
};

const webUrl = (raw: string | null | undefined, base: string): string | null => {
  if (raw === null || raw === undefined || raw.trim() === "") {
    return null;
  }
  try {
    const url = new URL(raw.trim(), base);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
};

const DATE_PREFIX = /^(?<date>\d{4}-\d{2}-\d{2})(?:$|[T ])/u;

// a date the page gave in ISO form keeps its own calendar day; anything else stays as written
const publishedOf = (raw: string | null): string | null => {
  const text = oneLine(raw, 200);
  if (text === null) {
    return null;
  }
  const date = DATE_PREFIX.exec(text)?.groups?.date;
  if (date !== undefined) {
    const [year = 0, month = 0, day = 0] = date.split("-").map(Number);
    const check = new Date(Date.UTC(year, month - 1, day));
    if (
      check.getUTCFullYear() === year &&
      check.getUTCMonth() === month - 1 &&
      check.getUTCDate() === day
    ) {
      return date;
    }
  }
  return oneLine(text, PUBLISHED_MAX);
};

const metaContent = (document: Document, selectors: readonly string[]): string | null => {
  for (const selector of selectors) {
    for (const element of document.querySelectorAll(selector)) {
      const content = element.getAttribute("content");
      if (content !== null && content.trim() !== "") {
        return content;
      }
    }
  }
  return null;
};

const property = (name: string): string[] => [`meta[property="${name}"]`, `meta[name="${name}"]`];

// schema.org's loose shapes: a string, an object with a name or url, or a list of either, each
// read into the object form
const named = z.union([
  z.string().transform((name) => ({ name })),
  z.looseObject({ name: z.string().optional() }),
]);
const imageRef = z.union([
  z.string().transform((url) => ({ url })),
  z.looseObject({ url: z.string().optional() }),
]);
const oneOrMany = <T extends z.ZodType>(schema: T) =>
  z.union([schema.transform((one) => [one]), z.array(schema)]);
const jsonLdNode = z.looseObject({
  "@type": z.union([z.string().transform((type) => [type]), z.array(z.string())]).optional(),
  author: oneOrMany(named).optional(),
  datePublished: z.string().optional(),
  description: z.string().optional(),
  headline: z.string().optional(),
  image: oneOrMany(imageRef).optional(),
  name: z.string().optional(),
  publisher: named.optional(),
});
type JsonLdNode = z.infer<typeof jsonLdNode>;

// what a JSON-LD value may hold more nodes in: a list, or an object's @graph
const containerSchema = z.union([
  z.array(z.unknown()),
  z.looseObject({ "@graph": z.array(z.unknown()) }).transform((node) => node["@graph"]),
]);

const ARTICLE_TYPES = new Set([
  "article",
  "newsarticle",
  "blogposting",
  "techarticle",
  "scholarlyarticle",
  "report",
  "webpage",
  "videoobject",
  "podcastepisode",
  "musicrecording",
  "recipe",
  "product",
  "creativework",
]);

const typesOf = (node: JsonLdNode): string[] =>
  (node["@type"] ?? []).map((entry) => entry.toLowerCase());

const JSON_LD_DEPTH_MAX = 4;

// every object a JSON-LD block holds, through lists and @graph, depth-bounded
const flattenJsonLd = (root: z.ZodSafeParseResult<unknown>): JsonLdNode[] => {
  const found: JsonLdNode[] = [];
  const pending = root.success ? [{ depth: 0, value: root.data }] : [];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    const node = jsonLdNode.safeParse(next.value);
    if (node.success && typesOf(node.data).some((type) => ARTICLE_TYPES.has(type))) {
      found.push(node.data);
    }
    const inner = containerSchema.safeParse(next.value);
    if (inner.success && next.depth < JSON_LD_DEPTH_MAX) {
      pending.push(...inner.data.toReversed().map((value) => ({ depth: next.depth + 1, value })));
    }
  }
  return found;
};

const parseJson = (text: string): z.ZodSafeParseResult<unknown> => {
  try {
    return z.unknown().safeParse(JSON.parse(text));
  } catch {
    return z.never().safeParse(null);
  }
};

const jsonLdNodes = (document: Document): JsonLdNode[] =>
  [...document.querySelectorAll('script[type="application/ld+json"]')].flatMap((script) => {
    const text = script.textContent ?? "";
    return text.length > JSON_LD_MAX_CHARS ? [] : flattenJsonLd(parseJson(text));
  });

const firstOf = <T>(
  nodes: readonly JsonLdNode[],
  read: (node: JsonLdNode) => T | null,
): T | null => {
  for (const node of nodes) {
    const value = read(node);
    if (value !== null) {
      return value;
    }
  }
  return null;
};

const ldAuthors = (node: JsonLdNode): string | null => {
  const names = (node.author ?? [])
    .map((author) => author.name ?? "")
    .filter((name) => name.trim() !== "");
  return names.length === 0 ? null : names.join(", ");
};

const ldImages = (node: JsonLdNode): string[] =>
  (node.image ?? []).flatMap((entry) => (entry.url === undefined ? [] : [entry.url]));

// "@handle" is not a byline, and a profile url is not a name
const bylineOf = (raw: string | null): string | null =>
  raw === null || /^https?:\/\//iu.test(raw.trim()) ? null : raw.replace(/^@/u, "");

const firstText = (...values: (string | null | undefined)[]): string | null => {
  for (const value of values) {
    if (value !== null && value !== undefined && value.trim() !== "") {
      return value;
    }
  }
  return null;
};

// what the head says, read before anything strips it: each key's chain of the page's own claims,
// with the extractor's reading still to come at its end
export interface HeadReading {
  base: string;
  title: string | null;
  htmlTitle: string | null;
  site: string | null;
  author: string | null;
  published: string | null;
  description: string | null;
  images: (string | null)[];
  oembed: string | null;
  lang: string | null;
}

export const readHead = (document: Document, pageUrl: string): HeadReading => {
  const base =
    webUrl(document.querySelector("base[href]")?.getAttribute("href"), pageUrl) ?? pageUrl;
  const ld = jsonLdNodes(document);
  return {
    author: firstText(
      firstOf(ld, ldAuthors),
      metaContent(document, ['meta[name="author"]', 'meta[name="byl"]']),
      bylineOf(metaContent(document, property("article:author"))),
      bylineOf(metaContent(document, ['meta[name="twitter:creator"]'])),
    ),
    base,
    description: firstText(
      metaContent(document, property("og:description")),
      metaContent(document, property("twitter:description")),
      metaContent(document, ['meta[name="description"]']),
      firstOf(ld, (node) => node.description ?? null),
    ),
    htmlTitle: document.querySelector("title")?.textContent ?? null,
    images: [
      metaContent(document, property("og:image:secure_url")),
      metaContent(document, property("og:image")),
      metaContent(document, property("og:image:url")),
      metaContent(document, property("twitter:image")),
      metaContent(document, property("twitter:image:src")),
      ...ld.flatMap(ldImages),
    ],
    lang: document.documentElement.getAttribute("lang"),
    oembed: webUrl(
      document
        .querySelector('link[rel~="alternate"][type="application/json+oembed"]')
        ?.getAttribute("href"),
      base,
    ),
    published: firstText(
      metaContent(document, property("article:published_time")),
      firstOf(ld, (node) => node.datePublished ?? null),
      metaContent(document, [
        'meta[name="date"]',
        'meta[name="pubdate"]',
        'meta[name="dc.date"]',
        'meta[name="DC.date"]',
        'meta[itemprop="datePublished"]',
      ]),
      document.querySelector("time[datetime]")?.getAttribute("datetime"),
    ),
    site: firstText(
      metaContent(document, property("og:site_name")),
      firstOf(ld, (node) => node.publisher?.name ?? null),
      metaContent(document, ['meta[name="application-name"]']),
    ),
    title: firstText(
      metaContent(document, property("og:title")),
      metaContent(document, property("twitter:title")),
      firstOf(ld, (node) => node.headline ?? null),
    ),
  };
};

// the head's claims first, then the extractor's reading, each cleaned and clipped
export const pageFactsOf = (head: HeadReading, extracted: ExtractedMeta): PageFacts => {
  // the extractor falls back to the domain, which the card already shows as the host
  const extractedSite = extracted.site === extracted.domain ? null : extracted.site;
  const images = [...head.images, extracted.image]
    .map((raw) => webUrl(raw, head.base))
    .filter((url): url is string => url !== null);
  return {
    author: oneLine(firstText(head.author, extracted.author), AUTHOR_MAX),
    description: oneLine(firstText(head.description, extracted.description), DESCRIPTION_MAX),
    images: [...new Set(images)].slice(0, IMAGES_MAX),
    lang: oneLine(head.lang, 35),
    oembed: head.oembed,
    published: publishedOf(firstText(head.published, extracted.published)),
    site: oneLine(firstText(head.site, extractedSite), SITE_MAX),
    title: oneLine(firstText(head.title, extracted.title, head.htmlTitle), TITLE_MAX),
  };
};
