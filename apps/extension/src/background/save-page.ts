// A save from this browser: the tab read here, over the page as the person sees it, and saved
// through `items.save` with its facts, its article and its cover, so the library holds it read
// from the first moment; a web page the browser will not let
// it script (the Web Store, the PDF viewer), one past the capture's cap, one it read no text from,
// or one whose reading the cloud refuses as a call, is saved as its link, for the cloud's fill to
// read, and a page with no web address is refused. Every save is queued before its first call
// (./save-queue), and one the cloud did not answer is sent again as its link, as is one made while
// its account is signed out, once it signs in again, and one met as too old a build, once the
// browser updates the extension. A link or a picture a right-click names is
// saved by its address, and a picture a page drew from its own bytes as a file of its own.

import { BLOB_MAX_BYTES } from "@repo/contract/library/library-blobs";
import { fieldLine, savedFacts } from "@repo/contract/items/saved-facts";
import { coverPicture, deviceKeepsReading, preferredText } from "@repo/contract/items/link-fill";
import { namesPrivateSpace } from "@repo/contract/items/host-names";
import { originalFileName } from "@repo/contract/items/item-name";
import { isWebUrl } from "@repo/contract/items/item-url";
import { sniffMedia } from "@repo/contract/items/sniff-media";
import { uuidV7 } from "@repo/contract/library/uuid-v7";
import { QuotaError } from "@repo/contract/v1/errors";
import { readHtml } from "@repo/page-reader/read-html";
import type { ExtractedPageBlocks } from "@repo/page-reader/page-reading";

import type { CapturedPage } from "../capture/captured-page";
import type { Outcome, OutcomeReason, WaitsFor } from "../messages";
import { CAPTURE_DEADLINE_MS, COVER_TRIES } from "./capture-tab";
import { sendFile, sent } from "./cloud";
import type { Cloud, Saved, Sent } from "./cloud";
import { accountGone, keepSave, linkOf, settle, settledBy } from "./save-queue";
import type { QueuedSave, Settled } from "./save-queue";
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

const refused = (reason: Extract<Outcome, { kind: "refused" }>["reason"]): Outcome => ({
  kind: "refused",
  reason,
});

// how a kept save's try left it, said to the person
const outcomeOf = (settled: Settled<Saved>): Outcome => {
  switch (settled.kind) {
    case "landed": {
      return {
        created: settled.answer.created,
        kind: "saved",
        title: settled.answer.item.fields.title,
      };
    }
    case "waiting": {
      return { kind: "queued", waitsFor: settled.for };
    }
    case "dropped": {
      return refused(settled.reason);
    }
    case "gone": {
      return refused("not-connected");
    }
    // no default
  }
};

// a save that waits for its account to sign in again, which the alarm then sends
const waitsForSignIn = async (queued: QueuedSave): Promise<Outcome> => {
  await keepSave({ ...queued, firstTry: false });
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
const refusesReading = (answer: Sent<Saved>): boolean =>
  answer.kind === "malformed" || (answer.kind === "refused" && answer.code !== QuotaError.code);

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
): Promise<Sent<string | null>> => {
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

const queuedFor = (
  deps: SaveDeps,
  email: string,
  save: Pick<QueuedSave, "title" | "url">,
): QueuedSave => {
  const now = deps.now();
  return {
    ...save,
    email,
    firstTry: true,
    id: uuidV7(now, deps.randomBytes(16)),
    opId: uuidV7(now, deps.randomBytes(16)),
    savedAt: now,
  };
};

// a save kept before its call goes, then settled by the call's answer as every resend is
const sendKept = async (queued: QueuedSave, send: () => Promise<Sent<Saved>>): Promise<Outcome> => {
  await keepSave(queued);
  return outcomeOf(await settle(queued, send));
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
  const saveLink = async () => await sent(async () => await cloud.saveLink(linkOf(queued)));
  return await sendKept(queued, async () => {
    if (read === null) {
      return await saveLink();
    }
    const cover = await keepCover(deps, cloud, queued.url, read.facts.images);
    if (cover.kind !== "landed") {
      return cover;
    }
    const reading = await sent(
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
          title: fieldLine(read.facts.title) ?? queued.title,
          url: queued.url,
        }),
    );
    return refusesReading(reading) ? await saveLink() : reading;
  });
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
      return await sendKept(
        queued,
        async () => await sent(async () => await cloud.saveLink(linkOf(queued))),
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
      ? await sent(
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
  const settled = settledBy(made);
  switch (settled.kind) {
    case "landed": {
      return { created: true, kind: "saved", title: settled.answer.item.fields.title };
    }
    case "waiting": {
      return refused(PICTURE_WAITS[settled.for]);
    }
    case "dropped": {
      return refused(settled.reason);
    }
    case "gone": {
      await accountGone(session.email);
      return refused("not-connected");
    }
    // no default
  }
};
