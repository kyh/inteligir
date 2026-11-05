// A save from this browser: the tab read here, over the page as the person sees it, and saved
// through `items.save` with its facts, its article, its cover and the passage the person had
// selected, so the library holds it read from the first moment; a page the browser will not let
// it script (its own pages, the Web Store, the PDF viewer), or one past the capture's cap, is saved
// as its link, for the cloud's fill to read. Every save is queued before its first call (./save-queue),
// and one the cloud did not answer is sent again as its link. A link or a picture a right-click
// names is saved by its address, and a picture a page drew from its own bytes as a file of its own.

import { BLOB_MAX_BYTES } from "@repo/contract/cloud/library/library-blobs";
import { ANNOTATION_QUOTE_MAX } from "@repo/notes/annotations/store-schema";
import { fieldLine, savedFacts } from "@repo/notes/items/saved-facts";
import { coverPicture } from "@repo/notes/items/link-fill";
import { namesPrivateSpace } from "@repo/notes/items/host-names";
import { originalFileName } from "@repo/notes/items/item-name";
import { isWebUrl, kindForUrl } from "@repo/notes/items/item-url";
import { sniffMedia } from "@repo/notes/items/sniff-media";
import { uuidV7 } from "@repo/notes/library/uuid-v7";
import { readHtml } from "@repo/page-reader/read-html";
import type { ExtractedPageBlocks } from "@repo/page-reader/page-reading";

import type { CapturedPage } from "../capture/captured-page";
import type { Outcome } from "../messages";
import { failureOf } from "./cloud";
import type { Cloud, Saved } from "./cloud";
import type { Connection } from "./connection";
import { dropSave, keepSave, linkOf, markWaiting } from "./save-queue";
import type { QueuedSave } from "./save-queue";

export interface SaveDeps {
  readonly connection: () => Promise<Connection | null>;
  readonly cloud: (connection: Connection) => Cloud;
  // the tab's page, or null when the browser will not script it or it answered no page
  readonly capture: (tabId: number) => Promise<CapturedPage | null>;
  // a cover candidate's bytes, or null for one this browser could not read
  readonly fetchCover: (url: string) => Promise<Uint8Array<ArrayBuffer> | null>;
  readonly signedOut: () => Promise<void>;
  readonly now: () => number;
  readonly randomBytes: (length: number) => Uint8Array;
  readonly newBlockId: () => string;
}

export interface TabFacts {
  readonly id: number;
  readonly title: string | undefined;
  readonly url: string | undefined;
}

const refused = (reason: Extract<Outcome, { kind: "refused" }>["reason"]): Outcome => ({
  kind: "refused",
  reason,
});

const savedOutcome = (saved: Saved): Outcome => ({
  created: !saved.folded,
  kind: "saved",
  title: saved.item.fields.title,
});

// how a call that did not land ends the save it made
const settleFailure = async (
  deps: SaveDeps,
  queued: QueuedSave,
  cause: unknown,
): Promise<Outcome> => {
  const failure = failureOf(cause);
  switch (failure.kind) {
    case "unanswered": {
      await markWaiting(queued, deps.now());
      return { kind: "queued" };
    }
    case "signed-out": {
      await deps.signedOut();
      return refused("signed-out");
    }
    case "refused": {
      await dropSave(queued);
      return refused(failure.reason);
    }
    // no default
  }
};

// the page as the library's read item, or null when the reader found nothing to keep (no text and
// no name), which the cloud then reads from the address itself
const readCapture = (deps: SaveDeps, html: string, url: string): ExtractedPageBlocks | null => {
  const kind = kindForUrl(url);
  const prefer = kind === "video" || kind === "audio" ? "description" : "article";
  try {
    const read = readHtml({ html, prefer, url }, deps.newBlockId);
    return read.rung === null && read.facts.title === null && read.facts.description === null
      ? null
      : read;
  } catch {
    return null;
  }
};

// the first candidate this browser can read that is a picture of a cover's size, kept by its sha;
// one the cloud refused is no cover, and a call it never answered waits with the save. A page in
// private space may name a cover there, a public one never, so no page sends this browser into the
// person's network
const keepCover = async (
  deps: SaveDeps,
  cloud: Cloud,
  pageUrl: string,
  candidates: readonly string[],
): Promise<string | null> => {
  for (const candidate of new Set(candidates)) {
    if (!namesPrivateSpace(pageUrl) && namesPrivateSpace(candidate)) {
      continue;
    }
    const bytes = await deps.fetchCover(candidate);
    const cover = bytes === null ? null : coverPicture(bytes);
    if (bytes === null || cover === null) {
      continue;
    }
    try {
      return await cloud.putFile(bytes, cover.mime);
    } catch (error) {
      if (failureOf(error).kind !== "refused") {
        throw error;
      }
      return null;
    }
  }
  return null;
};

const queuedFor = (
  deps: SaveDeps,
  connection: Connection,
  save: Pick<QueuedSave, "selection" | "title" | "url">,
): QueuedSave => {
  const now = deps.now();
  return {
    ...save,
    deviceId: connection.deviceId,
    id: uuidV7(now, deps.randomBytes(16)),
    opId: uuidV7(now, deps.randomBytes(16)),
    savedAt: now,
    waitingSince: null,
  };
};

// a save kept before its call, sent, and let go once it landed or can never land
const sendKept = async (
  deps: SaveDeps,
  queued: QueuedSave,
  call: () => Promise<Saved>,
): Promise<Outcome> => {
  await keepSave(queued);
  try {
    const saved = await call();
    await dropSave(queued);
    return savedOutcome(saved);
  } catch (error) {
    return await settleFailure(deps, queued, error);
  }
};

export interface TabSave {
  readonly tab: TabFacts;
  // the browser's own reading of the selection a right-click named, for a page it will not script
  readonly selectionText?: string | undefined;
}

export const saveTab = async (deps: SaveDeps, args: TabSave): Promise<Outcome> => {
  const connection = await deps.connection();
  if (connection === null) {
    return refused("not-connected");
  }
  const { tab } = args;
  if (tab.url === undefined || !isWebUrl(tab.url)) {
    return refused("unsupported-page");
  }
  const page = await deps.capture(tab.id);
  const url = page !== null && isWebUrl(page.url) ? page.url : tab.url;
  const given = args.selectionText?.trim().slice(0, ANNOTATION_QUOTE_MAX) || null;
  const queued = queuedFor(deps, connection, {
    selection: page?.selection ?? given,
    title: fieldLine(page?.title ?? null) ?? fieldLine(tab.title ?? null) ?? "",
    url,
  });
  const html = page?.html ?? null;
  const read = html === null ? null : readCapture(deps, html, url);
  const cloud = deps.cloud(connection);
  return await sendKept(deps, queued, async () => {
    if (read === null) {
      return await cloud.saveLink(linkOf(queued));
    }
    return await cloud.save({
      article: read.article.blocks.map(({ block, ord }) => ({ block, ord })),
      coverSha: await keepCover(deps, cloud, queued.url, read.facts.images),
      facts: savedFacts(read.facts),
      folderId: null,
      id: queued.id,
      opId: queued.opId,
      savedAt: queued.savedAt,
      selection: queued.selection,
      tags: [],
      title: fieldLine(read.facts.title) ?? queued.title,
      url: queued.url,
    });
  });
};

// a link or a web picture a right-click names, saved by its address for the cloud to read: a
// picture's address answers with its bytes, which the cloud keeps as a picture of its own
export const saveAddress = async (deps: SaveDeps, url: string): Promise<Outcome> => {
  const connection = await deps.connection();
  if (connection === null) {
    return refused("not-connected");
  }
  const queued = queuedFor(deps, connection, { selection: null, title: "", url });
  const cloud = deps.cloud(connection);
  return await sendKept(deps, queued, async () => await cloud.saveLink(linkOf(queued)));
};

// a picture a page drew from its own bytes (a data: address) has no address to save, so its
// bytes go, named after the page it was on; they are never queued, so one the cloud did not take
// says it needs a connection
export const savePicture = async (
  deps: SaveDeps,
  picture: { readonly bytes: Uint8Array<ArrayBuffer>; readonly pageUrl: string },
): Promise<Outcome> => {
  const connection = await deps.connection();
  if (connection === null) {
    return refused("not-connected");
  }
  if (picture.bytes.length > BLOB_MAX_BYTES) {
    return refused("too-large");
  }
  const sniffed = sniffMedia(picture.bytes);
  if (sniffed?.kind !== "image") {
    return refused("unsupported-page");
  }
  const cloud = deps.cloud(connection);
  const now = deps.now();
  try {
    const sha = await cloud.putFile(picture.bytes, sniffed.mediaType);
    const made = await cloud.createFile({
      folderId: null,
      id: uuidV7(now, deps.randomBytes(16)),
      name: originalFileName(picture.pageUrl, sniffed.mediaType),
      opId: uuidV7(now, deps.randomBytes(16)),
      savedAt: now,
      sha,
      tags: [],
    });
    return { created: true, kind: "saved", title: made.item.fields.title };
  } catch (error) {
    const failure = failureOf(error);
    if (failure.kind === "signed-out") {
      await deps.signedOut();
      return refused("signed-out");
    }
    return refused(failure.kind === "refused" ? failure.reason : "needs-connection");
  }
};
