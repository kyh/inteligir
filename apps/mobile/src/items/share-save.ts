// A share from another app, saved: a page the share sheet hands over is read on this phone, as the
// extension reads the page it is on, and saved through `items.save` with its facts, its article
// and its cover, so the library holds it read from the first moment; a page this phone cannot read
// now (offline, no page at the address, a reader that broke) or read no text from is saved as its
// link, which the cloud's fill reads once it lands. Either way the words shared beside it are kept.
// Text alone is a thought. The page is fetched by the phone itself, each redirect judged by its
// spelling, and read by the reader in the headless page.
// Platform-free: the scenario suite runs it under node over the reader's own code.

import { base64FromBytes } from "@repo/contract/cloud/bytes";
import type { FillAnswer, FillJob } from "@repo/editor-bridge/protocol";
import type { LibraryReplica, Made, PageInput } from "@repo/library-replica/library-replica";
import { namesPrivateSpace } from "@repo/notes/items/host-names";
import {
  coverPicture,
  deviceKeepsReading,
  FILL_LIMITS,
  isPageType,
  preferredText,
} from "@repo/notes/items/link-fill";
import { fieldLine, savedFacts } from "@repo/notes/items/saved-facts";
import type { PageFetch } from "./page-fetch";
import { createPhoneSaves } from "./phone-saves";
import type { SavedItem, SaveTarget } from "./phone-saves";
import { unreadLink } from "./share-payload";
import type { SharedSave } from "./share-payload";

export interface ShareReadPorts {
  readonly fetch: PageFetch;
  // the reader in the headless page
  readonly read: (job: FillJob) => Promise<FillAnswer>;
}

const PAGE_ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
const COVER_ACCEPT = "image/webp,image/png,image/jpeg,image/gif;q=0.8,*/*;q=0.5";

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
    const cover = coverPicture(bytes);
    if (cover !== null) {
      return { bytes: new Uint8Array(bytes), mime: cover.mime };
    }
  }
  return null;
};

// what this phone read of a shared page, or null when the cloud's fill is to read it: a page that
// did not answer, an answer that is no page, a reader that broke, or a reading with no article
const readSharedPage = async (
  ports: ShareReadPorts,
  shared: Extract<SharedSave, { kind: "link" }>,
  target: SaveTarget,
): Promise<PageInput | null> => {
  const fetched = await ports.fetch({
    accept: PAGE_ACCEPT,
    maxBytes: FILL_LIMITS.htmlBytes,
    overflow: "truncate",
    // a redirect reaches private space only from an address that names it itself
    reachesPrivate: namesPrivateSpace(shared.url),
    url: shared.url,
  });
  if (!fetched.ok || !isPageType(fetched.page.mediaType)) {
    return null;
  }
  let answer: FillAnswer;
  try {
    answer = await ports.read({
      base64: base64FromBytes(fetched.page.bytes),
      charset: fetched.page.charset,
      prefer: preferredText(shared.url),
      url: fetched.page.url,
    });
  } catch {
    return null;
  }
  if (answer.kind !== "read" || !deviceKeepsReading(answer.article)) {
    return null;
  }
  const title = fieldLine(answer.facts.title) ?? fieldLine(shared.title) ?? "";
  const page: PageInput = {
    article: answer.article,
    cover: await coverOf(ports, shared.url, answer.facts.images),
    facts: savedFacts(answer.facts),
    folderId: target.folderId,
    selection: null,
    tags: [],
    title,
    url: shared.url,
  };
  // words that only say the page's own title again add nothing to its note
  return shared.note === null || shared.note === title ? page : { ...page, note: shared.note };
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
        return await saves.saveLink(unreadLink(shared), target);
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
