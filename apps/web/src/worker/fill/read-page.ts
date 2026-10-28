// One page read for the cell, by the rules every device that fills a link reads it by
// (`@repo/notes/items/link-fill`'s limits, `@repo/page-reader` over linkedom, `@repo/notes/items`'
// oEmbed and sniffing): the page asked for through the guarded fetch (`./page-fetch`), a file the
// address answered with kept as the item's original, a page's article and facts read, a media
// host's oEmbed asked, and the first candidate that is really a picture of a cover's size kept as
// the cover, whole: no picture is decoded here, since a Worker's heap holds the reading already
// (`packages/page-reader/src/extract-page.heap.test.ts`), so a device draws its own thumbnail. Every
// byte kept goes to R2 as a library file before the reading lands (`./store-file`). The reader and
// the DOM it reads over load with the first page a consumer reads, never with the Worker's start,
// which every request waits on.

import type { ExtractedPageBlocks } from "@repo/page-reader/page-reading";
import type { readHtml as readHtmlType } from "@repo/page-reader/read-html";
import { failureOf, fileOnlyLinked, TEXT_NOT_SAVED } from "@repo/notes/items/fill-sentences";
import { originalFileName } from "@repo/notes/items/item-name";
import { kindForUrl } from "@repo/notes/items/item-url";
import { FILL_LIMITS, isPageType, playableKindOf } from "@repo/notes/items/link-fill";
import {
  OEMBED_MAX_BYTES,
  oembedEndpoint,
  parseOEmbed,
  youTubeStills,
} from "@repo/notes/items/oembed";
import type { OEmbed } from "@repo/notes/items/oembed";
import { pixelSize, sniffMedia } from "@repo/notes/items/sniff-media";
import { decodeText } from "@repo/notes/text/decode-text";

import type { FillJob } from "./fill-job";
import type { FillLanding } from "./fill-landing";
import type { FetchedPage, PageFetch } from "./page-fetch";

const PAGE_ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
const COVER_ACCEPT =
  "image/avif,image/webp,image/png,image/jpeg,image/gif,image/svg+xml;q=0.8,*/*;q=0.5";

export interface ReadPorts {
  readonly fetch: PageFetch;
  // bytes kept as a library file by their sha, or null when the library could not take them
  readonly keep: (file: {
    readonly bytes: Uint8Array;
    readonly mime: string;
  }) => Promise<string | null>;
}

// a reading that did not land a page: said in the item, unless a later try may get past it
export type PageRead =
  | { readonly kind: "landing"; readonly landing: FillLanding }
  | { readonly kind: "retry"; readonly sentence: string };

const failed = (job: FillJob, sentence: string): PageRead => ({
  kind: "landing",
  landing: { itemId: job.itemId, kind: "failed", sentence, url: job.url },
});

const askOEmbed = async (ports: ReadPorts, url: string, discovered: string | null) => {
  const endpoint = oembedEndpoint(url, discovered);
  if (endpoint === null) {
    return null;
  }
  const fetched = await ports.fetch({
    accept: "application/json",
    maxBytes: OEMBED_MAX_BYTES,
    overflow: "refuse",
    url: endpoint,
  });
  return fetched.ok ? parseOEmbed(fetched.page.bytes) : null;
};

// the first candidate that is a picture, and not a pixel or an icon by the size its header names
const keepCover = async (
  ports: ReadPorts,
  candidates: readonly string[],
): Promise<string | null> => {
  for (const candidate of new Set(candidates)) {
    const fetched = await ports.fetch({
      accept: COVER_ACCEPT,
      maxBytes: FILL_LIMITS.coverBytes,
      overflow: "refuse",
      url: candidate,
    });
    const sniffed = fetched.ok ? sniffMedia(fetched.page.bytes) : null;
    if (!fetched.ok || sniffed?.kind !== "image") {
      continue;
    }
    const size = pixelSize(fetched.page.bytes, sniffed.mediaType);
    if (size !== null && Math.max(size.width, size.height) < FILL_LIMITS.coverMinEdge) {
      continue;
    }
    const sha = await ports.keep({ bytes: fetched.page.bytes, mime: sniffed.mediaType });
    if (sha !== null) {
      return sha;
    }
  }
  return null;
};

// a link that answered with a picture or a PDF becomes that file's item; a video, a song or any
// other file keeps its link and is read as such
const fileRead = async (ports: ReadPorts, job: FillJob, page: FetchedPage): Promise<PageRead> => {
  const sniffed = sniffMedia(page.bytes);
  if (sniffed !== null && page.truncated) {
    return failed(job, fileOnlyLinked(page.declaredBytes));
  }
  if (sniffed === null) {
    return {
      kind: "landing",
      landing: {
        article: [],
        coverSha: null,
        facts: { author: null, description: null, lang: null, published: null, site: null },
        finalUrl: page.url,
        itemId: job.itemId,
        kind: "read",
        playable: playableKindOf(page.mediaType),
        title: null,
        url: job.url,
      },
    };
  }
  const sha = await ports.keep({ bytes: page.bytes, mime: sniffed.mediaType });
  return sha === null
    ? { kind: "retry", sentence: failureOf({ kind: "unreachable", transient: true }).sentence }
    : {
        kind: "landing",
        landing: {
          fileKind: sniffed.kind,
          itemId: job.itemId,
          kind: "file",
          originalName: originalFileName(page.url, sniffed.mediaType),
          originalSha: sha,
          url: job.url,
        },
      };
};

const coverCandidates = (job: FillJob, images: readonly string[], oembed: OEmbed | null) => [
  ...images,
  ...(oembed?.thumbnail === null || oembed === null ? [] : [oembed.thumbnail]),
  ...youTubeStills(job.url),
  ...(job.coverHint === null ? [] : [job.coverHint]),
];

// a text no field takes past a line's length is clipped to it, as every field's cap is
const line = (value: string | null): string | null => {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed.slice(0, 1000);
};

const newBlockId = (): string => crypto.randomUUID();

type ReadHtml = typeof readHtmlType;

const loadReader = async (): Promise<ReadHtml> => {
  const reader = await import("@repo/page-reader/read-html");
  return reader.readHtml;
};

// a post whose page is an app shell (X) says its words only in the oEmbed markup
const articleOf = (
  readHtml: ReadHtml,
  read: ExtractedPageBlocks,
  oembed: OEmbed | null,
  url: string,
) => {
  const markup = oembed?.html ?? null;
  return read.article.blocks.length > 0 || markup === null
    ? read.article
    : readHtml({ html: markup, prefer: "article", url }, newBlockId).article;
};

// what the page says of itself, and what a media host's oEmbed says where the page says nothing
const factsOf = (facts: ExtractedPageBlocks["facts"], oembed: OEmbed | null) => ({
  author: line(facts.author ?? oembed?.author ?? null),
  description: facts.description?.trim().slice(0, 10_000) || null,
  lang: line(facts.lang),
  published: line(facts.published),
  site: line(facts.site ?? oembed?.provider ?? null),
});

const pageRead = async (ports: ReadPorts, job: FillJob, page: FetchedPage): Promise<PageRead> => {
  const kind = kindForUrl(job.url);
  const prefer = kind === "video" || kind === "audio" ? "description" : "article";
  const html = decodeText(page.bytes.subarray(0, FILL_LIMITS.htmlBytes), page.charset);
  const readHtml = await loadReader();
  const read = readHtml({ html, prefer, url: page.url }, newBlockId);
  if (read.rung === null && read.facts.title === null && read.facts.description === null) {
    return failed(job, TEXT_NOT_SAVED);
  }
  const oembed = await askOEmbed(ports, job.url, read.facts.oembed);
  const article = articleOf(readHtml, read, oembed, job.url);
  const coverSha = await keepCover(ports, coverCandidates(job, read.facts.images, oembed));
  return {
    kind: "landing",
    landing: {
      article: article.blocks.map(({ block, ord }) => ({ block, ord })),
      coverSha,
      facts: factsOf(read.facts, oembed),
      finalUrl: page.url,
      itemId: job.itemId,
      kind: "read",
      playable: null,
      title: line(read.facts.title ?? oembed?.title ?? null),
      url: job.url,
    },
  };
};

export const readPage = async (ports: ReadPorts, job: FillJob): Promise<PageRead> => {
  const fetched = await ports.fetch({
    accept: PAGE_ACCEPT,
    maxBytes: FILL_LIMITS.pageBytes,
    overflow: "truncate",
    url: job.url,
  });
  if (!fetched.ok) {
    const failure = failureOf(fetched.failure);
    return failure.transient
      ? { kind: "retry", sentence: failure.sentence }
      : failed(job, failure.sentence);
  }
  const { page } = fetched;
  return sniffMedia(page.bytes) !== null || !isPageType(page.mediaType)
    ? await fileRead(ports, job, page)
    : await pageRead(ports, job, page);
};
