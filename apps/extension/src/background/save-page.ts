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
  readonly signIn: () => Promise<SignIn>;
  readonly capture: (tabId: number) => Promise<CapturedPage | null>;
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

const refused = (reason: OutcomeReason) => ({ kind: "refused", reason }) satisfies Outcome;

const refusedByLibrary = (message: string) =>
  ({
    kind: "refused",
    message,
    reason: "library",
  }) satisfies Outcome;

const said = (outcome: CallOutcome<Saved>) => {
  switch (outcome.kind) {
    case "landed": {
      return {
        created: outcome.answer.created,
        kind: "saved",
        title: outcome.answer.item.card.title,
      } satisfies Outcome;
    }

    case "wait": {
      return { kind: "queued", waitsFor: outcome.for } satisfies Outcome;
    }

    case "refused": {
      return refusedByLibrary(outcome.message);
    }

    case "gone": {
      return refused("not-connected");
    }

    default: {
      throw new Error(`unexpected ${String(outcome satisfies never)}`);
    }
  }
};

const waitsForSignIn = async (queued: QueuedSave) => {
  await keepSave(queued);

  return { kind: "queued", waitsFor: "sign-in" } satisfies Outcome;
};

const readCapture = (deps: SaveDeps, html: string, url: string) => {
  try {
    const read = readHtml({ html, prefer: preferredText(url), url }, deps.newBlockId);

    return deviceKeepsReading(read.article.blocks) ? read : null;
  } catch {
    return null;
  }
};

const refusesReading = (outcome: CallOutcome<Saved>) =>
  outcome.kind === "refused" && outcome.code !== QuotaError.code;

const NO_COVER = { answer: null, kind: "landed" } as const;

const keepCover = async (
  deps: SaveDeps,
  cloud: Cloud,
  pageUrl: string,
  candidates: readonly string[],
) => {
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

const queuedFor = (deps: SaveDeps, email: string, page: Omit<QueuedSave["payload"], "email">) => {
  const now = deps.now();

  return {
    id: uuidV7(now, deps.randomBytes(16)),
    opId: uuidV7(now, deps.randomBytes(16)),
    payload: { ...page, email },
    refused: null,
    savedAt: now,
  } satisfies QueuedSave;
};

export interface TabSave {
  readonly tab: TabFacts;
}

const captureInTime = async (deps: SaveDeps, tabId: number) => {
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

export const saveTab = async (deps: SaveDeps, args: TabSave) => {
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

  const outcome = await sendKept(queued, async () => {
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
          parentId: null,
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

export const saveAddress = async (deps: SaveDeps, url: string) => {
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

    default: {
      throw new Error(`unexpected ${String(signIn satisfies never)}`);
    }
  }
};

const PICTURE_WAITS = {
  connection: "needs-connection",
  "sign-in": "signed-out",
  update: "update-extension",
} as const satisfies Record<WaitsFor, OutcomeReason>;

export const savePicture = async (
  deps: SaveDeps,
  picture: { readonly bytes: Uint8Array<ArrayBuffer>; readonly pageUrl: string },
) => {
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
              parentId: null,
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
      return { created: true, kind: "saved", title: made.answer.item.card.title } satisfies Outcome;
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

    default: {
      throw new Error(`unexpected ${String(made satisfies never)}`);
    }
  }
};
