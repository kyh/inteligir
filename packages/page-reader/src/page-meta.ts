import { z } from "zod";

import { isIsoDate } from "@repo/contract/iso-date";

import type { PageFacts } from "./page-facts";
import { resolveWebUrl } from "./web-url";

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

const oneLine = (raw: string | null | undefined, max: number) => {
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

const DATE_PREFIX = /^(?<date>\d{4}-\d{2}-\d{2})(?:$|[T ])/u;

const publishedOf = (raw: string | null) => {
  const text = oneLine(raw, 200);

  if (text === null) {
    return null;
  }

  const date = DATE_PREFIX.exec(text)?.groups?.date;

  if (date !== undefined && isIsoDate(date)) {
    return date;
  }

  return oneLine(text, PUBLISHED_MAX);
};

const metaContent = (document: Document, selectors: readonly string[]) => {
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

const property = (name: string) =>
  [`meta[property="${name}"]`, `meta[name="${name}"]`] satisfies string[];

const imageRef = z.union([
  z.string().transform((url) => ({ url })),
  z.looseObject({ url: z.string().optional() }),
]);

const oneOrMany = <T extends z.ZodType>(schema: T) =>
  z.union([schema.transform((one) => [one]), z.array(schema)]);

const jsonLdNode = z.looseObject({
  "@type": z.union([z.string().transform((type) => [type]), z.array(z.string())]).optional(),
  image: oneOrMany(imageRef).optional(),
});

type JsonLdNode = z.infer<typeof jsonLdNode>;

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

const typesOf = (node: JsonLdNode) => (node["@type"] ?? []).map((entry) => entry.toLowerCase());

const JSON_LD_DEPTH_MAX = 4;

const flattenJsonLd = (root: z.ZodSafeParseResult<unknown>) => {
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

const parseJson = (text: string) => {
  try {
    return z.unknown().safeParse(JSON.parse(text));
  } catch {
    return z.never().safeParse(null);
  }
};

const jsonLdNodes = (document: Document) =>
  [...document.querySelectorAll('script[type="application/ld+json"]')].flatMap((script) => {
    const text = script.textContent ?? "";

    return text.length > JSON_LD_MAX_CHARS ? [] : flattenJsonLd(parseJson(text));
  });

const ldImages = (node: JsonLdNode) =>
  (node.image ?? []).flatMap((entry) => (entry.url === undefined ? [] : [entry.url]));

export interface HeadReading {
  base: string;
  images: (string | null)[];
  oembed: string | null;
  lang: string | null;
}

export const readHead = (document: Document, pageUrl: string) => {
  const base =
    resolveWebUrl(document.querySelector("base[href]")?.getAttribute("href") ?? "", pageUrl) ??
    pageUrl;

  return {
    base,
    images: [
      metaContent(document, property("og:image:secure_url")),
      metaContent(document, property("og:image")),
      metaContent(document, property("og:image:url")),
      metaContent(document, property("twitter:image")),
      metaContent(document, property("twitter:image:src")),
      ...jsonLdNodes(document).flatMap(ldImages),
    ],
    lang: document.documentElement.getAttribute("lang"),
    oembed: resolveWebUrl(
      document
        .querySelector('link[rel~="alternate"][type="application/json+oembed"]')
        ?.getAttribute("href") ?? "",
      base,
    ),
  } satisfies HeadReading;
};

export const pageFactsOf = (head: HeadReading, extracted: ExtractedMeta) => {
  const extractedSite = extracted.site === extracted.domain ? null : extracted.site;

  const images = [...head.images, extracted.image].flatMap((raw) => {
    const url = resolveWebUrl(raw ?? "", head.base);

    return url === null ? [] : [url];
  });

  return {
    author: oneLine(extracted.author, AUTHOR_MAX),
    description: oneLine(extracted.description, DESCRIPTION_MAX),
    images: [...new Set(images)].slice(0, IMAGES_MAX),
    lang: oneLine(head.lang, 35),
    oembed: head.oembed,
    published: publishedOf(extracted.published),
    site: oneLine(extractedSite, SITE_MAX),
    title: oneLine(extracted.title, TITLE_MAX),
  } satisfies PageFacts;
};
