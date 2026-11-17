// A save from this browser: the tab read here, over the page as the person sees it, and saved
// through `items.save` with its facts, its article and its cover, so the library holds it read
// from the first moment; a web page the browser will not let
// it script (the Web Store, the PDF viewer), one past the capture's cap, one it read no text from,
// or one whose reading the cloud refuses as a call, is saved as its link, for the cloud's fill to
// read, and a page with no web address is refused. Every save is queued before its first call
// (./save-queue), and one the cloud did not answer is sent again as its link, as is one made while
// its account is signed out, once it signs in again, and one met as too old a build, once the
// browser updates the extension; one the library refuses stays queued, with the library's words,
// for the popup's Try again or Let it go. A link or a picture a right-click names is
// saved by its address, and a picture a page drew from its own bytes as a file of its own.

import { BLOB_MAX_BYTES } from "@repo/contract/library/library-blobs";
import { fieldLine, savedFacts } from "@repo/contract/items/saved-facts";
import { coverPicture, deviceKeepsReading, preferredText } from "@repo/contract/items/link-fill";
import { namesPrivateSpace } from "@repo/contract/items/host-names";
import { originalFileName } from "@repo/contract/items/item-name";
import { isWebUrl } from "@repo/contract/items/item-url";
import { sniffMedia } from "@repo/contract/items/sniff-media";
import { outcomeOf } from "@repo/contract/rpc/call-outcome";
import type { CallOutcome, WaitsFor } from "@repo/contract/rpc/call-outcome";
import { uuidV7 } from "@repo/contract/library/uuid-v7";
import { QuotaError } from "@repo/contract/rpc/v1-errors";
import { readHtml } from "@repo/page-reader/read-html";
import type { ExtractedPageBlocks } from "@repo/page-reader/page-facts";

import type { CapturedPage } from "../capture/captured-page";
import type { Outcome, OutcomeReason } from "../messages";
import { CAPTURE_DEADLINE_MS, COVER_TRIES } from "./capture-tab";
import { sendFile } from "./cloud";
import type { Cloud, Saved } from "./cloud";
import { accountGone, keepSave, linkOf, sendKept } from "./save-queue";
import type { QueuedSave } from "./save-queue";
import type { Session, SignIn } from "./sign-in";

export interface SaveDeps {
  readonly cloud: (session: Session) => Cloud;
  // who the browser is signed in as, for a save to go under
  readonly signIn: () => Promise<SignIn>;
  // the tab's page, or null when the browser will not script it or it answered no page
  readonly capture: (tabId: number) => Promise<CapturedPage | null>;
  // a cover candidate's bytes, or null for one this browser could not read
  readonly fetchCover: (url: string) => Promise<Uint8Array<ArrayBuffer> | null>;
  readonly now: () => number;
  readonly randomBytes: (length: number) => Uint8Array;
  readonly newBlockId: () => string;
}

export interface TabFacts {
  readonly id: number;
  readonly title: string | undefined;
  readonly url: string | undefined;
}

const refused = (reason: OutcomeReason): Outcome => ({ kind: "refused", reason });

const refusedByLibrary = (message: string): Outcome => ({
  kind: "refused",
  message,
  reason: "library",
});

// how a kept save's try left it, said to the person
const said = (outcome: CallOutcome<Saved>): Outcome => {
  switch (outcome.kind) {
    case "landed": {
      return {
        created: outcome.answer.created,
        kind: "saved",
        title: outcome.answer.item.card.title,
      };
    }
    case "wait": {
      return { kind: "queued", waitsFor: outcome.for };
    }
    case "refused": {
      return refusedByLibrary(outcome.message);
    }
    case "gone": {
      return refused("not-connected");
    }
    // no default
  }
};

// a save that waits for its account to sign in again, which the site's sign-in then sends
const waitsForSignIn = async (queued: QueuedSave): Promise<Outcome> => {
  await keepSave(queued);
  return { kind: "queued", waitsFor: "sign-in" };
};

// the page as the library's read item, or null when it held no text the reader could keep (a shell
// its scripts have yet to draw, words in shadow roots a clone leaves behind), which the cloud reads
// from its address
const readCapture = (deps: SaveDeps, html: string, url: string): ExtractedPageBlocks | null => {
  try {
    const read = readHtml({ html, prefer: preferredText(url), url }, deps.newBlockId);
    return deviceKeepsReading(read.article.blocks) ? read : null;
  } catch {
    return null;
  }
};

// a reading the cloud will not take as a call, such as a list past the blocks one write holds: its
// address may still land, where a full library or a build too old would be refused the link too
const refusesReading = (outcome: CallOutcome<Saved>): boolean =>
  outcome.kind === "refused" && outcome.code !== QuotaError.code;

const NO_COVER = { answer: null, kind: "landed" } as const;

// the first candidate this browser can read that is a picture of a cover's size, kept by its sha;
// one the cloud refused is no cover, and a call that met no answer or an ended session settles the
// save with it. A page in private space may name a cover there, a public one never, so no page
// sends this browser into the person's network. No more than COVER_TRIES are fetched, which bounds
// how long a first try runs
const keepCover = async (
  deps: SaveDeps,
  cloud: Cloud,
  pageUrl: string,
  candidates: readonly string[],
): Promise<CallOutcome<string | null>> => {
  for (const candidate of [...new Set(candidates)].slice(0, COVER_TRIES)) {
    if (!namesPrivateSpace(pageUrl) && namesPrivateSpace(candidate)) {
      continue;
    }
    const bytes = await deps.fetchCover(candidate);
    const cover = bytes === null ? null : coverPicture(bytes);
    if (bytes === null || cover === null) {
      continue;
    }
    const kept = await sendFile(cloud, bytes, cover.mime);
    return kept.kind === "refused" ? NO_COVER : kept;
  }
  return NO_COVER;
};

// a save as the queue keeps it, its ids minted here, once, for every try
const queuedFor = (
  deps: SaveDeps,
  email: string,
  page: Omit<QueuedSave["payload"], "email">,
): QueuedSave => {
  const now = deps.now();
  return {
    id: uuidV7(now, deps.randomBytes(16)),
    opId: uuidV7(now, deps.randomBytes(16)),
    payload: { ...page, email },
    refused: null,
    savedAt: now,
  };
};

export interface TabSave {
  readonly tab: TabFacts;
}

// the tab's page, or null once the capture is past its deadline, so a tab that never answers is
// saved as its link for the cloud's fill to read rather than holding the save open
const captureInTime = async (deps: SaveDeps, tabId: number): Promise<CapturedPage | null> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  // oxlint-disable-next-line promise/avoid-new -- a timer answers through a callback, which only a promise hands to the race
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      resolve(null);
    }, CAPTURE_DEADLINE_MS);
  });
  try {
    return await Promise.race([deps.capture(tabId), late]);
  } finally {
    clearTimeout(timer);
  }
};

// a tab saved while its account is signed out waits as its address and title, read by the cloud's
// fill once it lands, so the tab is not scripted for a reading no call would carry
export const saveTab = async (deps: SaveDeps, args: TabSave): Promise<Outcome> => {
  const signIn = await deps.signIn();
  if (signIn.kind === "none") {
    return refused("not-connected");
  }
  const { tab } = args;
  if (tab.url === undefined || !isWebUrl(tab.url)) {
    return refused("unsupported-page");
  }
  if (signIn.kind === "signed-out") {
    return await waitsForSignIn(
      queuedFor(deps, signIn.email, { title: fieldLine(tab.title ?? null) ?? "", url: tab.url }),
    );
  }
  const { session } = signIn;
  const page = await captureInTime(deps, tab.id);
  const url = page !== null && isWebUrl(page.url) ? page.url : tab.url;
  const queued = queuedFor(deps, session.email, {
    title: fieldLine(page?.title ?? null) ?? fieldLine(tab.title ?? null) ?? "",
    url,
  });
  const html = page?.html ?? null;
  const read = html === null ? null : readCapture(deps, html, url);
  const cloud = deps.cloud(session);
  const saveLink = async () => await outcomeOf(async () => await cloud.saveLink(linkOf(queued)));
  const outcome = await sendKept(queued, async (): Promise<CallOutcome<Saved>> => {
    if (read === null) {
      return await saveLink();
    }
    const cover = await keepCover(deps, cloud, url, read.facts.images);
    if (cover.kind !== "landed") {
      return cover;
    }
    const reading = await outcomeOf(
      async () =>
        await cloud.save({
          article: [...read.article.blocks],
          coverSha: cover.answer,
          facts: savedFacts(read.facts),
          folderId: null,
          id: queued.id,
          opId: queued.opId,
          savedAt: queued.savedAt,
          tags: [],
          title: fieldLine(read.facts.title) ?? queued.payload.title,
          url,
        }),
    );
    return refusesReading(reading) ? await saveLink() : reading;
  });
  return said(outcome);
};

// a link or a web picture a right-click names, saved by its address for the cloud to read: a
// picture's address answers with its bytes, which the cloud keeps as a picture of its own
export const saveAddress = async (deps: SaveDeps, url: string): Promise<Outcome> => {
  const signIn = await deps.signIn();
  switch (signIn.kind) {
    case "none": {
      return refused("not-connected");
    }
    case "signed-out": {
      return await waitsForSignIn(queuedFor(deps, signIn.email, { title: "", url }));
    }
    case "signed-in": {
      const queued = queuedFor(deps, signIn.session.email, { title: "", url });
      const cloud = deps.cloud(signIn.session);
      return said(
        await sendKept(
          queued,
          async () => await outcomeOf(async () => await cloud.saveLink(linkOf(queued))),
        ),
      );
    }
    // no default
  }
};

// a picture's bytes wait in no queue, so what would keep a save waiting refuses a picture
const PICTURE_WAITS = {
  connection: "needs-connection",
  "sign-in": "signed-out",
  update: "update-extension",
} as const satisfies Record<WaitsFor, OutcomeReason>;

// a picture a page drew from its own bytes (a data: address) has no address to save, so its
// bytes go, named after the page it was on; they are never queued, so one the cloud did not take
// says it needs a connection, a sign-in or an update
export const savePicture = async (
  deps: SaveDeps,
  picture: { readonly bytes: Uint8Array<ArrayBuffer>; readonly pageUrl: string },
): Promise<Outcome> => {
  const signIn = await deps.signIn();
  if (signIn.kind === "none") {
    return refused("not-connected");
  }
  if (signIn.kind === "signed-out") {
    return refused("signed-out");
  }
  const { session } = signIn;
  if (picture.bytes.length > BLOB_MAX_BYTES) {
    return refused("too-large");
  }
  const sniffed = sniffMedia(picture.bytes);
  if (sniffed?.kind !== "image") {
    return refused("unsupported-page");
  }
  const cloud = deps.cloud(session);
  const now = deps.now();
  const stored = await sendFile(cloud, picture.bytes, sniffed.mediaType);
  const made =
    stored.kind === "landed"
      ? await outcomeOf(
          async () =>
            await cloud.createFile({
              folderId: null,
              id: uuidV7(now, deps.randomBytes(16)),
              name: originalFileName(picture.pageUrl, sniffed.mediaType),
              opId: uuidV7(now, deps.randomBytes(16)),
              savedAt: now,
              sha: stored.answer,
              tags: [],
            }),
        )
      : stored;
  switch (made.kind) {
    case "landed": {
      return { created: true, kind: "saved", title: made.answer.item.card.title };
    }
    case "wait": {
      return refused(PICTURE_WAITS[made.for]);
    }
    case "refused": {
      return refusedByLibrary(made.message);
    }
    case "gone": {
      await accountGone(session.email);
      return refused("not-connected");
    }
    // no default
  }
};
