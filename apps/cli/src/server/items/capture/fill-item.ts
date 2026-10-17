// one fill of one saved link: read its page through the guard (or take the page a browser handed
// over), extract it in the worker, ask a media host's oEmbed, keep a cover and, when asked, a copy
// of the page, rename a provisional stub of this Mac's own to the page's title, and write it all in
// one compare-and-swap against the bytes the file holds then, with the item's waiting highlights
// placed in the same write. A fill that cannot land (the file gone and not found by its id, or a
// block that does not parse) takes back the covers and copies it wrote and leaves the file alone.

import type { ItemFill } from "@repo/contract/local/items/items-schema";
import { bodyOf } from "@repo/notes/items/item-body";
import { isItemStub, itemFactsOf } from "@repo/notes/items/item-frontmatter";
import { itemNameFromTitle, itemNameFromUrl } from "@repo/notes/items/item-name";
import { formatItemTime } from "@repo/notes/items/item-time";
import { kindForUrl } from "@repo/notes/items/item-url";
import { docStem } from "@repo/notes/knowledge/doc-file";
import { dirnamePath } from "@repo/notes/knowledge/vault-path";

import type { AnnotationsService } from "../../annotations/annotations-service";
import type { KnowledgeRuntime } from "../../knowledge/knowledge-runtime";
import type { ImageDownscale } from "../../media/image-downscale";
import type { ItemCore } from "../item-core";
import type { Reach } from "./address-guard";
import type { CaptureClock } from "./capture-ports";
import { findCover } from "./cover";
import { decodeText } from "./decode-text";
import type { PageFacts } from "./fill-protocol";
import type { FillRunner } from "./fill-runner";
import { COPY_TOO_BIG, failureOf, fileOnlyLinked, TEXT_NOT_SAVED } from "./fill-sentences";
import type { FetchedResponse, GuardedFetch } from "./guarded-fetch";
import { applyFillFailure, applyLinkFill, applyMediaFill, startsWithImage } from "./link-fill";
import type { FillText, LinkFill } from "./link-fill";
import { fetchOEmbed, youTubeStills } from "./oembed";
import type { OEmbed } from "./oembed";
import { keepPageCopy } from "./page-copy";
import type { FillOrigin } from "./pending-fills-store";
import { sniffMedia } from "./sniff-media";

const MiB = 1024 * 1024;
const PAGE_MAX_BYTES = 10 * MiB;
const HTML_MAX_BYTES = 5 * MiB;
const CAS_TRIES = 3;
const PAGE_ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";

export interface FillContext {
  core: ItemCore;
  knowledge: Pick<KnowledgeRuntime, "pathForNoteId">;
  annotations: Pick<AnnotationsService, "placeWaiting">;
  fetcher: GuardedFetch;
  runner: FillRunner;
  downscale: ImageDownscale;
  clock: CaptureClock;
  debug: (line: string) => void;
}

export interface FillTarget {
  // the frontmatter id the item is followed by and its highlights are keyed by; null for a link
  // note an opened folder held, refreshed on request
  itemId: string | null;
  path: string;
  url: string;
  origin: FillOrigin | "refresh";
  keepCopy: boolean;
  coverHint: string | null;
  text: FillText;
  // the page a browser handed over, read at `at`: it is never requested
  supplied: { html: string; at: number } | null;
  // a transient failure leaves the stub for a later try rather than saying it in the file
  mayRetry: boolean;
  signal: AbortSignal;
  // where the item went, as the fill renames it or finds it by its id
  onMoved: (path: string) => void;
}

export type FillOutcome =
  | { kind: "written"; path: string; fill: ItemFill; wrote: string[] }
  | { kind: "retry"; path: string; wrote: string[] }
  | { kind: "dropped"; path: string | null; wrote: string[] }
  | { kind: "aborted" };

const FILLED: ItemFill = { state: "filled" };

// what the fill will write, recomputed against the file's bytes at each try
type Writing =
  | { kind: "link"; fill: LinkFill; text: FillText }
  | { kind: "failure"; fetched: string; message: string; cover: string | null }
  | { kind: "media"; media: { kind: "image" | "pdf"; fetched: string; original: string } };

const compose = (current: string, writing: Writing): string | null => {
  switch (writing.kind) {
    case "link": {
      return applyLinkFill(current, writing.fill, writing.text);
    }
    case "failure": {
      return applyFillFailure(current, writing);
    }
    case "media": {
      return applyMediaFill(current, writing.media);
    }
    default: {
      const exhaustive: never = writing;
      return exhaustive;
    }
  }
};

const fillOf = (writing: Writing): ItemFill =>
  writing.kind === "failure" ? { message: writing.message, state: "failed" } : FILLED;

interface Located {
  path: string;
  content: string;
  hash: string;
}

// the item where it is now: its path, else wherever its id is
const locate = async (context: FillContext, target: FillTarget): Promise<Located | null> => {
  const read = await context.core.read(target.path);
  if (read !== null) {
    return { ...read, path: target.path };
  }
  if (target.itemId === null) {
    return null;
  }
  const moved = await context.knowledge.pathForNoteId(target.itemId, target.path);
  if (moved === null || moved === target.path) {
    return null;
  }
  const found = await context.core.read(moved);
  if (found === null) {
    return null;
  }
  target.path = moved;
  target.onMoved(moved);
  return { ...found, path: moved };
};

const MEDIA_EXTENSIONS = {
  "application/pdf": "pdf",
  "image/avif": "avif",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/svg+xml": "svg",
  "image/webp": "webp",
} as const;

// a file found at a link keeps its own name when the address names one with the right extension
const originalName = (url: string, mediaType: keyof typeof MEDIA_EXTENSIONS): string => {
  const ext = MEDIA_EXTENSIONS[mediaType];
  let segment = "";
  try {
    segment = decodeURIComponent(
      new URL(url).pathname.split("/").findLast((part) => part !== "") ?? "",
    );
  } catch {
    segment = "";
  }
  const dot = segment.lastIndexOf(".");
  const stem = dot > 0 ? segment.slice(0, dot) : segment;
  const given = dot > 0 ? segment.slice(dot + 1).toLowerCase() : "";
  const sameKind = given === ext || (ext === "jpg" && given === "jpeg");
  return `${itemNameFromTitle(stem) ?? "File"}.${sameKind ? given : ext}`;
};

const isHtmlType = (mediaType: string | null): boolean =>
  mediaType === null || mediaType === "text/html" || mediaType === "application/xhtml+xml";

const mediaKindOf = (mediaType: string | null): "video" | "audio" | null => {
  if (mediaType?.startsWith("video/") === true) {
    return "video";
  }
  return mediaType?.startsWith("audio/") === true ? "audio" : null;
};

// a provisional stem: the one a save names a stub by when it has no title yet, or its " N" twin
const isProvisionalStem = (path: string, url: string): boolean => {
  const stem = docStem(path);
  const provisional = itemNameFromUrl(url);
  return (
    stem === provisional ||
    (stem.startsWith(`${provisional} `) && /^\d+$/u.test(stem.slice(provisional.length + 1)))
  );
};

interface Page {
  html: string;
  url: string;
  reach: Reach | null;
  fetched: string;
}

type PageRead =
  | { kind: "page"; page: Page }
  | { kind: "media"; response: FetchedResponse; fetched: string }
  | { kind: "failure"; message: string; transient: boolean };

const readPage = async (context: FillContext, target: FillTarget): Promise<PageRead> => {
  if (target.supplied !== null) {
    const reach = await context.fetcher.reachOf(target.url, target.signal);
    return {
      kind: "page",
      page: {
        fetched: formatItemTime(target.supplied.at),
        html: target.supplied.html,
        reach: reach.ok ? reach.reach : null,
        url: target.url,
      },
    };
  }
  const fetched = await context.fetcher.fetch({
    accept: PAGE_ACCEPT,
    maxBytes: PAGE_MAX_BYTES,
    overflow: "truncate",
    reach: null,
    signal: target.signal,
    url: target.url,
  });
  const at = formatItemTime(context.clock.now());
  if (!fetched.ok) {
    const failure = failureOf(fetched.failure);
    return { kind: "failure", message: failure.sentence, transient: failure.transient };
  }
  const { response } = fetched;
  if (sniffMedia(response.bytes) !== null || !isHtmlType(response.mediaType)) {
    return { fetched: at, kind: "media", response };
  }
  const bytes = response.bytes.subarray(0, HTML_MAX_BYTES);
  return {
    kind: "page",
    page: {
      fetched: at,
      html: decodeText(bytes, response.charset),
      reach: response.reach,
      url: response.url,
    },
  };
};

interface Extracted {
  facts: PageFacts;
  article: string;
  oembed: OEmbed | null;
}

const extract = async (
  context: FillContext,
  target: FillTarget,
  page: Page,
  kind: string,
): Promise<Extracted | null> => {
  const prefer = kind === "video" || kind === "audio" ? "description" : "article";
  const result = await context.runner.run({
    html: page.html,
    kind: "extract",
    prefer,
    url: page.url,
  });
  if (result.kind !== "extracted") {
    context.debug(
      `extract failed for ${target.path}: ${result.kind === "failed" ? result.reason : result.kind}`,
    );
    return null;
  }
  const oembed =
    page.reach === null
      ? null
      : await fetchOEmbed({
          discovered: result.facts.oembed,
          fetcher: context.fetcher,
          reach: page.reach,
          signal: target.signal,
          url: target.url,
        });
  let { article } = result;
  // a post whose page is an app shell (X) says its words only in the oEmbed markup
  if (article === "" && oembed?.html !== null && oembed?.html !== undefined) {
    const fromEmbed = await context.runner.run({
      html: oembed.html,
      kind: "extract",
      prefer: "article",
      url: target.url,
    });
    if (fromEmbed.kind === "extracted") {
      ({ article } = fromEmbed);
    }
  }
  return { article, facts: result.facts, oembed };
};

// the stub moved to the page's title, when it is this Mac's own, still untracked and still named
// after its url; a rename that fails leaves it where it is
const renameToTitle = async (
  context: FillContext,
  target: FillTarget,
  title: string | null,
  wrote: string[],
): Promise<void> => {
  if (target.origin !== "own" || title === null || !isProvisionalStem(target.path, target.url)) {
    return;
  }
  const name = itemNameFromTitle(title);
  if (
    name === null ||
    name === docStem(target.path) ||
    (await context.core.isTracked(target.path))
  ) {
    return;
  }
  try {
    const to = await context.core.freePath(dirnamePath(target.path), name);
    const moved = await context.core.rename(target.path, to);
    wrote.push(target.path, moved.path, ...moved.rewritten);
    target.path = moved.path;
    target.onMoved(moved.path);
  } catch (error) {
    context.debug(
      `rename of ${target.path} skipped: ${error instanceof Error ? error.message : "failed"}`,
    );
  }
};

const coverCandidates = (target: FillTarget, extracted: Extracted | null): string[] => [
  ...(extracted?.facts.images ?? []),
  ...(extracted?.oembed?.thumbnail === null || extracted?.oembed?.thumbnail === undefined
    ? []
    : [extracted.oembed.thumbnail]),
  ...youTubeStills(target.url),
  ...(target.coverHint === null ? [] : [target.coverHint]),
];

const keepCover = async (
  context: FillContext,
  target: FillTarget,
  candidates: readonly string[],
  reach: Reach | null,
  added: string[],
): Promise<string | null> => {
  if (reach === null || candidates.length === 0) {
    return null;
  }
  const cover = await findCover({
    candidates,
    core: context.core,
    downscale: context.downscale,
    fetcher: context.fetcher,
    reach,
    signal: target.signal,
  });
  if (cover?.wrote === true) {
    added.push(cover.path);
  }
  return cover?.path ?? null;
};

// the cover a hint alone can give a link whose page failed (an import's Raindrop cover)
const hintCover = async (
  context: FillContext,
  target: FillTarget,
  added: string[],
): Promise<string | null> => {
  if (target.coverHint === null) {
    return null;
  }
  const reach = await context.fetcher.reachOf(target.url, target.signal);
  return await keepCover(
    context,
    target,
    [target.coverHint],
    reach.ok ? reach.reach : "public",
    added,
  );
};

// the write, under the file's own compare-and-swap; null when it could not land
const land = async (
  context: FillContext,
  target: FillTarget,
  writing: Writing,
): Promise<Located | null> => {
  for (let attempt = 0; attempt < CAS_TRIES; attempt += 1) {
    const current = await locate(context, target);
    if (current === null) {
      return null;
    }
    const composed = compose(current.content, writing);
    if (composed === null) {
      return null;
    }
    const placed =
      target.itemId === null
        ? { content: composed }
        : await context.annotations.placeWaiting({
            content: composed,
            final: true,
            itemId: target.itemId,
            path: current.path,
          });
    const outcome = await context.core.write(current.path, placed.content, current.hash);
    if (outcome === "written") {
      return { content: placed.content, hash: "", path: current.path };
    }
  }
  return null;
};

const linkWriting = (
  target: FillTarget,
  page: Page,
  extracted: Extracted,
  parts: { cover: string | null; copy: string | null; kind: string },
): Writing => {
  const { facts, oembed } = extracted;
  const upgraded = kindForUrl(page.url);
  return {
    fill: {
      article: extracted.article,
      author: facts.author ?? oembed?.author ?? null,
      copy: parts.copy,
      cover: parts.cover,
      description: facts.description,
      fetched: page.fetched,
      // a link that turned out to be a video or a song says so; nothing is ever downgraded
      kind: parts.kind === "link" && upgraded !== "link" ? upgraded : undefined,
      published: facts.published,
      site: facts.site ?? oembed?.provider ?? null,
    },
    kind: "link",
    text: target.text,
  };
};

const mediaWriting = async (
  context: FillContext,
  target: FillTarget,
  read: { response: FetchedResponse; fetched: string },
  added: string[],
): Promise<Writing> => {
  const sniffed = sniffMedia(read.response.bytes);
  if (sniffed !== null && read.response.truncated) {
    return {
      cover: null,
      fetched: read.fetched,
      kind: "failure",
      message: fileOnlyLinked(read.response.bytes.byteLength + 1),
    };
  }
  if (sniffed !== null) {
    const original = await context.core.writeOriginal(
      target.path,
      originalName(read.response.url, sniffed.mediaType),
      read.response.bytes,
    );
    added.push(original.path);
    return {
      kind: "media",
      media: { fetched: read.fetched, kind: sniffed.kind, original: original.path },
    };
  }
  // a video, a song or anything else a page is not: its link is kept, and it is read as fetched
  const kind = mediaKindOf(read.response.mediaType);
  return {
    fill: {
      article: "",
      author: null,
      copy: null,
      cover: null,
      description: null,
      fetched: read.fetched,
      kind: kind ?? undefined,
      published: null,
      site: null,
    },
    kind: "link",
    text: "keep",
  };
};

const keepCopyOf = async (
  context: FillContext,
  target: FillTarget,
  page: Page,
  added: string[],
): Promise<string | null> => {
  if (!target.keepCopy || page.reach === null) {
    return null;
  }
  const copy = await keepPageCopy(
    { core: context.core, fetcher: context.fetcher, runner: context.runner },
    {
      html: page.html,
      reach: page.reach,
      savedOn: page.fetched.slice(0, 10),
      signal: target.signal,
      url: page.url,
    },
  );
  if (copy.kind !== "copy") {
    context.debug(
      `no copy of ${target.path}: ${copy.kind === "too-big" ? COPY_TOO_BIG : "the copy failed"}`,
    );
    return null;
  }
  if (copy.wrote) {
    added.push(copy.path);
  }
  return copy.path;
};

// the files a fill added that no write now points at
const takeBack = async (context: FillContext, added: readonly string[]): Promise<void> => {
  for (const path of added) {
    await context.core.remove(path);
  }
};

export const fillItem = async (context: FillContext, target: FillTarget): Promise<FillOutcome> => {
  const start = await locate(context, target);
  if (start === null) {
    return { kind: "dropped", path: null, wrote: [] };
  }
  const startFacts = itemFactsOf(start.content);
  if (target.origin !== "refresh" && !isItemStub(startFacts)) {
    return { kind: "dropped", path: start.path, wrote: [] };
  }
  const read = await readPage(context, target);
  if (target.signal.aborted) {
    return { kind: "aborted" };
  }
  // what a fill added (covers, copies, an original), taken back if nothing ends up pointing at it
  const added: string[] = [];
  const wrote: string[] = [];
  let writing: Writing;
  if (read.kind === "failure") {
    if (read.transient && target.mayRetry) {
      return { kind: "retry", path: target.path, wrote: [] };
    }
    writing = {
      cover: await hintCover(context, target, added),
      fetched: formatItemTime(context.clock.now()),
      kind: "failure",
      message: read.message,
    };
  } else if (read.kind === "media") {
    writing = await mediaWriting(context, target, read, added);
  } else {
    const extracted = await extract(context, target, read.page, startFacts.kind);
    if (extracted === null) {
      writing = {
        cover: await hintCover(context, target, added),
        fetched: read.page.fetched,
        kind: "failure",
        message: TEXT_NOT_SAVED,
      };
    } else {
      const first = startFacts.fetchedMs === null || startFacts.fetchError !== null;
      const wantsCover =
        target.text === "replace" || !first || !startsWithImage(bodyOf(start.content));
      const cover = wantsCover
        ? await keepCover(
            context,
            target,
            coverCandidates(target, extracted),
            read.page.reach,
            added,
          )
        : null;
      const copy = await keepCopyOf(context, target, read.page, added);
      await renameToTitle(
        context,
        target,
        extracted.facts.title ?? extracted.oembed?.title ?? null,
        wrote,
      );
      writing = linkWriting(target, read.page, extracted, { copy, cover, kind: startFacts.kind });
    }
  }
  if (target.signal.aborted) {
    await takeBack(context, added);
    return { kind: "aborted" };
  }
  const landed = await land(context, target, writing);
  if (landed === null) {
    await takeBack(context, added);
    return { kind: "dropped", path: target.path, wrote };
  }
  return {
    fill: fillOf(writing),
    kind: "written",
    path: landed.path,
    wrote: [...wrote, ...added, landed.path],
  };
};
