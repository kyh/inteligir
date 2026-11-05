// A share from another app, saved: a page the share sheet hands over is read on this phone, as the
// extension reads the page it is on, and saved through `items.save` with its facts, its article
// and its cover, so the library holds it read from the first moment; a page this phone cannot read
// now (offline, no page at the address, a reader that broke) is saved as its link, which the
// cloud's fill reads once it lands. Text alone is a thought. The page is fetched by the phone
// itself, each redirect judged by its spelling, and read by the reader in the headless page.
// Platform-free: the scenario suite runs it under node over the reader's own code.

import { base64FromBytes } from "@repo/contract/cloud/bytes";
import type { FillAnswer, FillJob } from "@repo/editor-bridge/protocol";
import type { LibraryReplica, Made, PageInput } from "@repo/library-replica/library-replica";
import { namesPrivateSpace } from "@repo/notes/items/host-names";
import { FILL_LIMITS, isPageType } from "@repo/notes/items/link-fill";
import { pixelSize, sniffMedia } from "@repo/notes/items/sniff-media";
import { ITEM_FIELD_CAPS } from "@repo/notes/library/library-item";
import type { PageFetch } from "./page-fetch";
import { createPhoneSaves } from "./phone-saves";
import type { SavedItem, SaveTarget } from "./phone-saves";
import type { SharedSave } from "./share-payload";

export interface ShareReadPorts {
  readonly fetch: PageFetch;
  // the reader in the headless page
  readonly read: (job: FillJob) => Promise<FillAnswer>;
}

const PAGE_ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
const COVER_ACCEPT = "image/webp,image/png,image/jpeg,image/gif;q=0.8,*/*;q=0.5";

// a picture whose header says it is at most this many pixels: a small file can name a bitmap of
// gigabytes, which drawing its thumbnail would decode
const DECODE_MAX_PIXELS = 40_000_000;

type ReadAnswer = Extract<FillAnswer, { kind: "read" }>;

// a fact fitted to the field that keeps it
const line = (value: string | null): string | null => {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed.slice(0, ITEM_FIELD_CAPS.line);
};

const factsOf = (facts: ReadAnswer["facts"]): PageInput["facts"] => ({
  author: line(facts.author),
  description: facts.description?.trim().slice(0, ITEM_FIELD_CAPS.description) || null,
  lang: line(facts.lang),
  published: line(facts.published),
  site: line(facts.site),
});

// the first candidate that is really a picture of a cover's size, kept whole as the site served it;
// a page in private space may name a cover there, a public one never
const coverOf = async (
  ports: ShareReadPorts,
  pageUrl: string,
  candidates: readonly string[],
): Promise<PageInput["cover"]> => {
  for (const url of new Set(candidates)) {
    if (!namesPrivateSpace(pageUrl) && namesPrivateSpace(url)) {
      continue;
    }
    const fetched = await ports.fetch({
      accept: COVER_ACCEPT,
      maxBytes: FILL_LIMITS.coverBytes,
      overflow: "refuse",
      reachesPrivate: namesPrivateSpace(pageUrl),
      url,
    });
    if (!fetched.ok) {
      continue;
    }
    const { bytes } = fetched.page;
    const sniffed = sniffMedia(bytes);
    const size = sniffed === null ? null : pixelSize(bytes, sniffed.mediaType);
    if (
      sniffed?.kind === "image" &&
      size !== null &&
      size.width * size.height <= DECODE_MAX_PIXELS &&
      Math.max(size.width, size.height) >= FILL_LIMITS.coverMinEdge
    ) {
      return { bytes: new Uint8Array(bytes), mime: sniffed.mediaType };
    }
  }
  return null;
};

// what this phone read of a shared page, or null when it read nothing the cloud should not read
// again: a page that did not answer, an answer that is no page, or a reader that broke
export const readSharedPage = async (
  ports: ShareReadPorts,
  shared: Extract<SharedSave, { kind: "link" }>,
  target: SaveTarget,
): Promise<PageInput | null> => {
  let fetched: Awaited<ReturnType<PageFetch>>;
  try {
    fetched = await ports.fetch({
      accept: PAGE_ACCEPT,
      maxBytes: FILL_LIMITS.htmlBytes,
      overflow: "truncate",
      // a redirect reaches private space only from an address that names it itself
      reachesPrivate: namesPrivateSpace(shared.url),
      url: shared.url,
    });
  } catch {
    return null;
  }
  if (!fetched.ok || !isPageType(fetched.page.mediaType)) {
    return null;
  }
  let answer: FillAnswer;
  try {
    answer = await ports.read({
      base64: base64FromBytes(fetched.page.bytes),
      charset: fetched.page.charset,
      prefer: "article",
      url: fetched.page.url,
    });
  } catch {
    return null;
  }
  if (answer.kind !== "read" || (answer.rung === null && answer.facts.title === null)) {
    return null;
  }
  return {
    article: answer.article,
    copy: null,
    cover: await coverOf(ports, shared.url, answer.facts.images),
    facts: factsOf(answer.facts),
    folderId: target.folderId,
    selection: null,
    tags: [],
    title: line(answer.facts.title) ?? line(shared.title) ?? "",
    url: shared.url,
  };
};

// a share saved however it can be: read here, else as its link, else as text; null for a share
// that held nothing to save
export const saveShared = async (
  args: {
    readonly replica: LibraryReplica;
    readonly ports: ShareReadPorts;
    readonly newBlockId: () => string;
  },
  shared: SharedSave,
): Promise<SavedItem | null> => {
  const target: SaveTarget = { folderId: null };
  const saves = createPhoneSaves({ newBlockId: args.newBlockId, replica: args.replica });
  switch (shared.kind) {
    case "link": {
      const page = await readSharedPage(args.ports, shared, target);
      if (page === null) {
        return await saves.saveLink(shared, target);
      }
      const made: Made = await args.replica.savePage(page);
      return { kind: "saved", made };
    }
    case "text": {
      return await saves.saveText(shared.text, target);
    }
    case "nothing": {
      return null;
    }
    // no default
  }
};
