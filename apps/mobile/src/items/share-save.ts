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
import { ReplicaClosedError } from "@repo/library-replica/library-replica";
import type { LibraryReplica, Made, PageInput } from "@repo/library-replica/library-replica";
import { kindForUrl, urlKey } from "@repo/notes/items/item-url";
import {
  coverPicture,
  deviceKeepsReading,
  FILL_LIMITS,
  isPage,
  preferredText,
} from "@repo/notes/items/link-fill";
import { fieldLine, savedFacts } from "@repo/notes/items/saved-facts";
import { ITEM_FIELD_CAPS } from "@repo/notes/library/library-item";
import type { PageFetch } from "./page-fetch";
import { createPhoneSaves } from "./phone-saves";
import type { SavedItem, SaveTarget } from "./phone-saves";
import type { SharedLink, SharedSave } from "./share-payload";

export interface ShareReadPorts {
  readonly fetch: PageFetch;
  // the reader in the headless page
  readonly read: (job: FillJob) => Promise<FillAnswer>;
}

const PAGE_ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
const COVER_ACCEPT = "image/webp,image/png,image/jpeg,image/gif;q=0.8,*/*;q=0.5";

// the first candidate that is really a picture of a cover's size, kept whole as the site served it;
// the fetch judges each by the page that named it, which is where the walk ended
const coverOf = async (
  ports: ShareReadPorts,
  pageUrl: string,
  candidates: readonly string[],
): Promise<PageInput["cover"]> => {
  for (const url of new Set(candidates)) {
    const fetched = await ports.fetch({
      accept: COVER_ACCEPT,
      from: pageUrl,
      maxBytes: FILL_LIMITS.coverBytes,
      overflow: "refuse",
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

// whether an item can take a page this phone read after a move: one the cloud has yet to read, or
// could not, and that holds no article, since Read the page again leaves the article on an item
// that waits; a body still to come may hold one
const takesARead = async (replica: LibraryReplica, itemId: string): Promise<boolean> => {
  const item = await replica.item(itemId);
  return (
    item !== null &&
    item.bodyHeld &&
    (item.fields.fetchState === "pending" || item.fields.fetchState === "failed") &&
    !item.blocks.some(({ section }) => section === "article")
  );
};

// where a page read after a move is saved; null when it is not, the item at the shared address
// taking the share as its link. A move can end anywhere, a sign-in wall included, so that item
// comes first and keeps its article, and with none there the item keeps the shared address unless
// the end is surely the page: the library holds it, so the save joins that item as the fill's fold
// does, or a link turned out a video or a song, as the fill's kind does. An end past what an item's
// address holds stays shared, as the fill's does
const movedAddress = async (
  replica: LibraryReplica,
  shared: string,
  landed: string,
): Promise<string | null> => {
  const holder = await replica.holderOf(shared);
  if (holder !== null) {
    return (await takesARead(replica, holder)) ? shared : null;
  }
  if (landed.length > ITEM_FIELD_CAPS.url) {
    return shared;
  }
  const namesItsKind = kindForUrl(shared) === "link" && kindForUrl(landed) !== "link";
  return namesItsKind || (await replica.holderOf(landed)) !== null ? landed : shared;
};

// the page this phone read of a share; null leaves the share its link: a page that did not answer,
// an answer that is no page, a move the item at the shared address takes as its link, a reader that
// broke or a reading with no article
const readSharedPage = async (
  ports: ShareReadPorts,
  replica: LibraryReplica,
  shared: SharedLink,
  target: SaveTarget,
): Promise<PageInput | null> => {
  const fetched = await ports.fetch({
    accept: PAGE_ACCEPT,
    from: shared.url,
    maxBytes: FILL_LIMITS.htmlBytes,
    overflow: "truncate",
    url: shared.url,
  });
  if (!fetched.ok || !isPage(fetched.page)) {
    return null;
  }
  const landed = fetched.page.url;
  const moved = urlKey(landed) !== urlKey(shared.url);
  const url = moved ? await movedAddress(replica, shared.url, landed) : shared.url;
  if (url === null) {
    return null;
  }
  let answer: FillAnswer;
  try {
    answer = await ports.read({
      base64: base64FromBytes(fetched.page.bytes),
      charset: fetched.page.charset,
      prefer: preferredText(shared.url, landed),
      url: landed,
    });
  } catch {
    return null;
  }
  if (answer.kind !== "read" || !deviceKeepsReading(answer.article)) {
    return null;
  }
  const readTitle = fieldLine(answer.facts.title);
  // a move that stayed at the shared address may have ended at a wall, which names itself
  const title =
    (moved && url === shared.url ? (shared.title ?? readTitle) : (readTitle ?? shared.title)) ?? "";
  const page: PageInput = {
    article: answer.article,
    cover: await coverOf(ports, landed, answer.facts.images),
    facts: savedFacts(answer.facts),
    folderId: target.folderId,
    selection: null,
    tags: [],
    title,
    url,
  };
  // words that only say the page's own title again add nothing to its note
  const note = shared.note === title ? null : shared.note;
  return note === null ? page : { ...page, note };
};

// what became of a share: saved, refused, or its library gone under it, a sign-out landing while
// the page was read, which saved nothing and leaves the share to the next sign-in
type SharedOutcome = SavedItem | { readonly kind: "left" };

// a share saved however it can be: read here, else as its link, else as text; null for a share
// that held nothing to save
export const saveShared = async (
  args: {
    readonly replica: LibraryReplica;
    readonly ports: ShareReadPorts;
    readonly newBlockId: () => string;
  },
  shared: SharedSave,
): Promise<SharedOutcome | null> => {
  const target: SaveTarget = { folderId: null };
  const saves = createPhoneSaves({ newBlockId: args.newBlockId, replica: args.replica });
  try {
    switch (shared.kind) {
      case "link": {
        const page = await readSharedPage(args.ports, args.replica, shared, target);
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
  } catch (error) {
    if (error instanceof ReplicaClosedError) {
      return { kind: "left" };
    }
    throw error;
  }
};
