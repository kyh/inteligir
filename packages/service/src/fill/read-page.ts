import { fieldLine, savedFacts } from "@repo/contract/items/saved-facts";
import type { ExtractedPageBlocks } from "@repo/page-reader/page-facts";
import type { ReadHtml } from "@repo/page-reader/read-html";
import { originalFileName } from "@repo/contract/items/item-name";
import { ITEM_FIELD_CAPS } from "@repo/contract/items/item-field-caps";
import {
  coverPicture,
  FILL_LIMITS,
  fillKeepsReading,
  isPage,
  playableKindOf,
  preferredText,
} from "@repo/contract/items/link-fill";
import { sniffMedia } from "@repo/contract/items/sniff-media";

import { decodeText } from "./decode-text";
import type { FillJob } from "./fill-job";
import type { FillLanding } from "./fill-landing";
import { failureOf, fileOnlyLinked, PAGE_UNREACHED, TEXT_NOT_SAVED } from "./fill-sentences";
import { OEMBED_MAX_BYTES, oembedEndpoint, parseOEmbed, youTubeStills } from "./oembed";
import type { OEmbed } from "./oembed";
import type { FetchedPage, PageFetch } from "./page-fetch";

const PAGE_ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";

const COVER_ACCEPT =
  "image/avif,image/webp,image/png,image/jpeg,image/gif,image/svg+xml;q=0.8,*/*;q=0.5";

export interface ReadPorts {
  readonly fetch: PageFetch;
  readonly keep: (file: {
    readonly bytes: Uint8Array;
    readonly mime: string;
  }) => Promise<string | null>;
}

export type PageRead =
  | { readonly kind: "landing"; readonly landing: FillLanding }
  | { readonly kind: "retry"; readonly sentence: string };

const failed = (sentence: string) =>
  ({
    kind: "landing",
    landing: { kind: "failed", sentence },
  }) satisfies PageRead;

const askOEmbed = async (
  ports: ReadPorts,
  saved: string,
  landed: string,
  discovered: string | null,
) => {
  const endpoint = oembedEndpoint(saved, oembedEndpoint(landed, discovered));

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

const keepCover = async (ports: ReadPorts, candidates: readonly string[]) => {
  for (const candidate of new Set(candidates)) {
    const fetched = await ports.fetch({
      accept: COVER_ACCEPT,
      maxBytes: FILL_LIMITS.coverBytes,
      overflow: "refuse",
      url: candidate,
    });

    const cover = fetched.ok ? coverPicture(fetched.page.bytes) : null;

    if (!fetched.ok || cover === null) {
      continue;
    }

    const sha = await ports.keep({ bytes: fetched.page.bytes, mime: cover.mime });

    if (sha !== null) {
      return sha;
    }
  }

  return null;
};

const finalAddress = (job: FillJob, page: FetchedPage) =>
  page.url.length > ITEM_FIELD_CAPS.url ? job.url : page.url;

const fileRead = async (ports: ReadPorts, job: FillJob, page: FetchedPage) => {
  const sniffed = sniffMedia(page.bytes);

  if (sniffed !== null && page.truncated) {
    return failed(fileOnlyLinked(page.declaredBytes));
  }

  if (sniffed === null) {
    return {
      kind: "landing",
      landing: {
        article: [],
        coverSha: null,
        facts: { author: null, description: null, lang: null, published: null, site: null },
        finalUrl: finalAddress(job, page),
        kind: "read",
        playable: playableKindOf(page.mediaType),
        title: null,
      },
    } satisfies PageRead;
  }

  const sha = await ports.keep({ bytes: page.bytes, mime: sniffed.mediaType });

  return (
    sha === null
      ? { kind: "retry", sentence: PAGE_UNREACHED }
      : {
          kind: "landing",
          landing: {
            fileKind: sniffed.kind,
            kind: "file",
            originalName: originalFileName(page.url, sniffed.mediaType),
            originalSha: sha,
          },
        }
  ) satisfies PageRead;
};

const coverCandidates = (
  job: FillJob,
  landed: string,
  images: readonly string[],
  oembed: OEmbed | null,
) => [
  ...images,
  ...(oembed?.thumbnail === null || oembed === null ? [] : [oembed.thumbnail]),
  ...youTubeStills(job.url),
  ...youTubeStills(landed),
  ...(job.coverHint === null ? [] : [job.coverHint]),
];

const newBlockId = () => crypto.randomUUID();

const loadReader = async () => {
  const reader = await import("@repo/page-reader/read-html");

  return reader.readHtml;
};

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

const factsOf = (facts: ExtractedPageBlocks["facts"], oembed: OEmbed | null) =>
  savedFacts({
    ...facts,
    author: facts.author ?? oembed?.author ?? null,
    site: facts.site ?? oembed?.provider ?? null,
  });

const pageRead = async (ports: ReadPorts, job: FillJob, page: FetchedPage) => {
  const html = decodeText(page.bytes.subarray(0, FILL_LIMITS.htmlBytes), page.charset);
  const readHtml = await loadReader();
  const landed = finalAddress(job, page);

  const read = readHtml(
    { html, prefer: preferredText(job.url, landed), url: page.url },
    newBlockId,
  );

  if (!fillKeepsReading(read)) {
    return failed(TEXT_NOT_SAVED);
  }

  const oembed = await askOEmbed(ports, job.url, landed, read.facts.oembed);
  const article = articleOf(readHtml, read, oembed, job.url);

  if (article.refused > 0) {
    console.warn({ event: "fill-blocks-refused", refused: article.refused });
  }

  const coverSha = await keepCover(ports, coverCandidates(job, landed, read.facts.images, oembed));

  return {
    kind: "landing",
    landing: {
      article: [...article.blocks],
      coverSha,
      facts: factsOf(read.facts, oembed),
      finalUrl: landed,
      kind: "read",
      playable: null,
      title: fieldLine(read.facts.title ?? oembed?.title ?? null),
    },
  } satisfies PageRead;
};

export const readPage = async (ports: ReadPorts, job: FillJob) => {
  const fetched = await ports.fetch({
    accept: PAGE_ACCEPT,
    maxBytes: FILL_LIMITS.pageBytes,
    overflow: "truncate",
    url: job.url,
  });

  if (!fetched.ok) {
    const failure = failureOf(fetched.failure);

    return (
      failure.transient ? { kind: "retry", sentence: failure.sentence } : failed(failure.sentence)
    ) satisfies PageRead;
  }

  const { page } = fetched;

  return isPage(page) ? await pageRead(ports, job, page) : await fileRead(ports, job, page);
};
