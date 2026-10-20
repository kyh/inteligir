// One fill of one link this phone saved, by the rules the Mac's fill writes with
// (@repo/notes/items/link-fill): the page read through the phone's own fetch, the reader run over it
// in the phone's page (@repo/page-reader, over the WebView's DOM), a media host's oEmbed asked, a
// cover kept, and the item written as ONE change set against the text it was composed from, with
// the highlights waiting on the stub placed in the same write. A fill only adds: it never writes
// `url` or `saved`, says a failure in the file, and never renames the stub, whose name another
// device may already hold. Platform-free: the scenario suite runs it under node with linkedom.

import { base64FromBytes } from "@repo/contract/cloud/bytes";
import type { FillAnswer, FillJob } from "@repo/mobile-editor/bridge-protocol";
import { placeQuotes, waitingQuotes } from "@repo/notes/annotations/place-quotes";
import { failureOf, fileOnlyLinked, TEXT_NOT_SAVED } from "@repo/notes/items/fill-sentences";
import { namesPrivateSpace } from "@repo/notes/items/host-names";
import { bodyOf } from "@repo/notes/items/item-body";
import { isItemStub, itemFactsOf } from "@repo/notes/items/item-frontmatter";
import { COVERS_DIR, contentAddressedName } from "@repo/notes/items/item-kind";
import { originalFileName } from "@repo/notes/items/item-name";
import { formatItemTime } from "@repo/notes/items/item-time";
import { kindForUrl } from "@repo/notes/items/item-url";
import {
  applyFillFailure,
  applyLinkFill,
  applyMediaFill,
  FILL_LIMITS,
  isPageType,
  playableKindOf,
  startsWithImage,
} from "@repo/notes/items/link-fill";
import type { LinkFill } from "@repo/notes/items/link-fill";
import {
  OEMBED_MAX_BYTES,
  oembedEndpoint,
  parseOEmbed,
  youTubeStills,
} from "@repo/notes/items/oembed";
import type { OEmbed } from "@repo/notes/items/oembed";
import { pixelSize, sniffMedia } from "@repo/notes/items/sniff-media";
import { DEFAULT_ATTACHMENTS_FOLDER, freeAssetPath } from "@repo/notes/knowledge/asset-name";
import { joinPath } from "@repo/notes/knowledge/vault-path";
import type { FillFile, NotesStore, PendingFill } from "../notes/notes-store";
import type { FetchedPage, PageFetch } from "./page-fetch";

const PAGE_ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
const COVER_ACCEPT = "image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.8,*/*;q=0.5";
const WRITE_TRIES = 3;

const COVER_EXTENSIONS = { "image/jpeg": "jpg", "image/png": "png" } as const;

export interface ShrunkCover {
  bytes: Uint8Array;
  mediaType: keyof typeof COVER_EXTENSIONS;
}

export interface LinkFillPorts {
  store: Pick<NotesStore, "heldFiles" | "readAnnotationStore" | "readNote" | "writeFill">;
  fetch: PageFetch;
  // the reader over a page's bytes: the phone's page in its reader mode, linkedom under node
  read: (job: FillJob) => Promise<FillAnswer>;
  // a picture at most FILL_LIMITS.coverEdge on its long edge, as a JPEG or (with transparency) a
  // PNG; null for one that cannot be decoded
  shrinkCover: (picture: { bytes: Uint8Array; mediaType: string }) => Promise<ShrunkCover | null>;
  sha256Hex: (bytes: Uint8Array) => Promise<string>;
  now: () => number;
}

export type LinkFillOutcome =
  | { kind: "written" }
  // a failure a later try may get past (offline, a timeout, a busy site), or a write that kept
  // meeting a newer text
  | { kind: "retry" }
  // nothing to fill: the stub is gone, or another device read its page first
  | { kind: "dropped" };

// what the fill writes, recomputed against the text the item holds at each try
type Writing =
  | { kind: "link"; fill: LinkFill }
  | { kind: "failure"; fetched: string; message: string }
  | { kind: "media"; media: { kind: "image" | "pdf"; fetched: string; original: string } };

const compose = (current: string, writing: Writing): string | null => {
  switch (writing.kind) {
    case "link": {
      return applyLinkFill(current, writing.fill);
    }
    case "failure": {
      return applyFillFailure(current, { ...writing, cover: null });
    }
    case "media": {
      return applyMediaFill(current, writing.media);
    }
    // no default
  }
};

interface Located {
  path: string;
  content: string;
}

// the stub where it is now: its path, else wherever its id went
const locate = async (ports: LinkFillPorts, row: PendingFill): Promise<Located | null> => {
  const read = await ports.store.readNote(row.path);
  if (read.ok) {
    return { content: read.content, path: row.path };
  }
  const moved = ports.store.heldFiles().find((file) => file.noteId === row.itemId);
  if (moved === undefined) {
    return null;
  }
  const found = await ports.store.readNote(moved.path);
  return found.ok ? { content: found.content, path: moved.path } : null;
};

const isRead = (content: string): boolean => {
  const facts = itemFactsOf(content);
  return facts.fetchedMs !== null && facts.fetchError === null;
};

// a page's claim may not lead the phone into the person's own network from a public page: a
// cover, a thumbnail or an oEmbed answer whose address names private space is skipped then
const mayFollow = (savedUrl: string, claimed: string): boolean =>
  namesPrivateSpace(savedUrl) || !namesPrivateSpace(claimed);

const encoder = new TextEncoder();

const jobOf = (
  bytes: Uint8Array,
  charset: string | null,
  url: string,
  prefer: FillJob["prefer"],
) => ({
  base64: base64FromBytes(bytes),
  charset,
  prefer,
  url,
});

const askOEmbed = async (
  ports: LinkFillPorts,
  url: string,
  discovered: string | null,
): Promise<OEmbed | null> => {
  const endpoint = oembedEndpoint(url, discovered);
  if (endpoint === null || !mayFollow(url, endpoint)) {
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

// the first candidate that is really a picture of a cover's size, kept by its bytes' hash
const keepCover = async (
  ports: LinkFillPorts,
  url: string,
  candidates: readonly string[],
): Promise<FillFile | null> => {
  for (const candidate of new Set(candidates)) {
    if (!mayFollow(url, candidate)) {
      continue;
    }
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
    const shrunk = await ports.shrinkCover({
      bytes: fetched.page.bytes,
      mediaType: sniffed.mediaType,
    });
    const size = shrunk === null ? null : pixelSize(shrunk.bytes, shrunk.mediaType);
    if (
      shrunk === null ||
      (size !== null && Math.max(size.width, size.height) < FILL_LIMITS.coverMinEdge)
    ) {
      continue;
    }
    const name = contentAddressedName(
      await ports.sha256Hex(shrunk.bytes),
      COVER_EXTENSIONS[shrunk.mediaType],
    );
    return { bytes: shrunk.bytes, path: joinPath(COVERS_DIR, name) };
  }
  return null;
};

interface Planned {
  writing: Writing;
  files: FillFile[];
}

const failed = (ports: LinkFillPorts, message: string): Planned => ({
  files: [],
  writing: { fetched: formatItemTime(ports.now()), kind: "failure", message },
});

// a link that answered with a picture or a PDF becomes that file's item; a video, a song or any
// other file keeps its link and is read as fetched
const mediaPlan = (ports: LinkFillPorts, page: FetchedPage, fetched: string): Planned => {
  const sniffed = sniffMedia(page.bytes);
  if (sniffed !== null && page.truncated) {
    return failed(ports, fileOnlyLinked(page.declaredBytes));
  }
  if (sniffed !== null) {
    const taken = ports.store.heldFiles().map((file) => file.path);
    const original = freeAssetPath(
      DEFAULT_ATTACHMENTS_FOLDER,
      originalFileName(page.url, sniffed.mediaType),
      taken,
    );
    return {
      files: [{ bytes: page.bytes, path: original }],
      writing: { kind: "media", media: { fetched, kind: sniffed.kind, original } },
    };
  }
  const kind = playableKindOf(page.mediaType);
  return {
    files: [],
    writing: {
      fill: {
        article: "",
        author: null,
        copy: null,
        cover: null,
        description: null,
        fetched,
        kind: kind ?? undefined,
        published: null,
        site: null,
      },
      kind: "link",
    },
  };
};

type ReadPage = Extract<FillAnswer, { kind: "read" }>;

// the article, or for a post whose page is an app shell (X) the words its oEmbed markup says
const articleOf = async (
  ports: LinkFillPorts,
  url: string,
  answer: ReadPage,
  oembed: OEmbed | null,
): Promise<string> => {
  if (answer.article !== "" || oembed?.html === null || oembed?.html === undefined) {
    return answer.article;
  }
  const fromEmbed = await ports.read(jobOf(encoder.encode(oembed.html), "utf-8", url, "article"));
  return fromEmbed.kind === "read" ? fromEmbed.article : answer.article;
};

const coverCandidates = (url: string, answer: ReadPage, oembed: OEmbed | null): string[] => [
  ...answer.facts.images,
  ...(oembed === null || oembed.thumbnail === null ? [] : [oembed.thumbnail]),
  ...youTubeStills(url),
];

// what a read page makes of the item: its facts, the article, the cover
const linkFillOf = (
  page: { url: string; fetched: string; stubKind: string },
  read: { answer: ReadPage; oembed: OEmbed | null; article: string; cover: string | null },
): LinkFill => {
  const { answer, oembed } = read;
  const upgraded = kindForUrl(page.url);
  return {
    article: read.article,
    author: answer.facts.author ?? oembed?.author ?? null,
    copy: null,
    cover: read.cover,
    description: answer.facts.description,
    fetched: page.fetched,
    // a link that turned out to be a video or a song says so; nothing is ever downgraded
    kind: page.stubKind === "link" && upgraded !== "link" ? upgraded : undefined,
    published: answer.facts.published,
    site: answer.facts.site ?? oembed?.provider ?? null,
  };
};

const pagePlan = async (
  ports: LinkFillPorts,
  row: PendingFill,
  stub: Located,
  page: FetchedPage,
  fetched: string,
): Promise<Planned> => {
  const stubKind = itemFactsOf(stub.content).kind;
  const prefer = stubKind === "video" || stubKind === "audio" ? "description" : "article";
  const html = page.bytes.subarray(0, FILL_LIMITS.htmlBytes);
  const answer = await ports.read(jobOf(html, page.charset, page.url, prefer));
  if (answer.kind === "failed") {
    return failed(ports, TEXT_NOT_SAVED);
  }
  const oembed = await askOEmbed(ports, row.url, answer.facts.oembed);
  const article = await articleOf(ports, row.url, answer, oembed);
  const cover = startsWithImage(bodyOf(stub.content))
    ? null
    : await keepCover(ports, row.url, coverCandidates(row.url, answer, oembed));
  return {
    files: cover === null ? [] : [cover],
    writing: {
      fill: linkFillOf(
        { fetched, stubKind, url: page.url },
        { answer, article, cover: cover?.path ?? null, oembed },
      ),
      kind: "link",
    },
  };
};

// the waiting highlights placed in the composed text, the ones with no passage under Highlights;
// a store that cannot be read places none, and the fill's own write still lands
const withHighlights = async (
  ports: LinkFillPorts,
  current: Located,
  composed: string,
): Promise<string> => {
  if (!isItemStub(itemFactsOf(current.content))) {
    return composed;
  }
  const store = await ports.store.readAnnotationStore(current);
  if (!store.ok) {
    return composed;
  }
  const pending = waitingQuotes(store.entries, composed);
  return pending.length === 0 ? composed : placeQuotes(composed, pending, { final: true }).content;
};

// the write, against the text the item holds at each try: a fill that began on a stub gives way
// to another device's read of the page, unless it read the page too, which lands as a refresh would
const land = async (
  ports: LinkFillPorts,
  row: PendingFill,
  planned: Planned,
): Promise<LinkFillOutcome> => {
  for (let attempt = 0; attempt < WRITE_TRIES; attempt += 1) {
    const current = await locate(ports, row);
    if (current === null || (planned.writing.kind !== "link" && isRead(current.content))) {
      return { kind: "dropped" };
    }
    const composed = compose(current.content, planned.writing);
    if (composed === null) {
      return { kind: "dropped" };
    }
    const content = await withHighlights(ports, current, composed);
    const written = await ports.store.writeFill(
      current.path,
      content,
      current.content,
      planned.files,
    );
    if (written.kind === "written") {
      return written;
    }
    if (written.kind === "missing") {
      return { kind: "dropped" };
    }
  }
  return { kind: "retry" };
};

export const fillLink = async (
  ports: LinkFillPorts,
  row: PendingFill,
  mayRetry: boolean,
): Promise<LinkFillOutcome> => {
  const stub = await locate(ports, row);
  if (stub === null || !isItemStub(itemFactsOf(stub.content))) {
    return { kind: "dropped" };
  }
  const read = await ports.fetch({
    accept: PAGE_ACCEPT,
    maxBytes: FILL_LIMITS.pageBytes,
    overflow: "truncate",
    url: row.url,
  });
  const fetched = formatItemTime(ports.now());
  if (!read.ok) {
    const failure = failureOf(read.failure);
    if (failure.transient && mayRetry) {
      return { kind: "retry" };
    }
    return await land(ports, row, failed(ports, failure.sentence));
  }
  const { page } = read;
  const planned =
    sniffMedia(page.bytes) !== null || !isPageType(page.mediaType)
      ? mediaPlan(ports, page, fetched)
      : await pagePlan(ports, row, stub, page, fetched);
  return await land(ports, row, planned);
};
