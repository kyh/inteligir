// The cloud's reading of the pages the library saved unread. A write that lands a link waiting for
// its page queues the reading in the same transaction, as a `fill` row of the jobs table, so a
// reading is never asked for a write that did not land and never lost by one that did. The row is
// due at once, so the write's commit sets the alarm for now, and the alarm alone sends it to the
// fill queue (`packages/service/fill-queues.ts`), again while the row still waits, later each
// time: a send that failed, or a cell evicted before the queue took it. The consumer reads the
// page and hands it back (`../fill/fill-consumer`), and it lands here: only the article and the
// facts a fill owns, so the person's note and fields are never touched, and only on an item still
// waiting for that reading at that address, so a message met twice lands once. A page whose
// redirects end at another address is read into the item that waited for it, which keeps the
// address it was saved at. An item whose note writes its body takes the article there
// (`./article-landing`).

import { and, eq, sql } from "drizzle-orm";

import { jobs } from "@repo/db/cell/schema";
import { readingOf, withReading } from "@repo/contract/library/item-reading";
import type { LibraryItemFields } from "@repo/contract/library/library-item";
import { readItem } from "./library-queries";
import type { StoredItem } from "./library-queries";
import { kindForUrl, urlKey } from "@repo/contract/items/item-url";

import { openTurnOf } from "../agent/turn-rows";
import { fillLandedSchema } from "../fill/fill-landing";
import type { FillLanded, FillLanding } from "../fill/fill-landing";
import type { NoteProjection } from "../note/note-wire";
import type { CellActor, TurnActor } from "./cell-actor";
import { hurryUnnamed } from "./cell-blobs";
import type { CellDb } from "./cell-db";
import { scheduleJob } from "./cell-jobs";
import type { Lease } from "./cell-jobs";
import type { ItemScope, LiveItemRow, WriteScope } from "./cell-landing";
import { landProjection } from "./cell-notes";
import type { CellResult } from "./cell-refusal";
import { landRead, withPage } from "./cell-saves";
import { foldReading } from "./change-sets";
import { landFields } from "./cell-writes";
import type { LibraryEngine } from "./library-engine";

export const FILL_ACTOR: CellActor = { kind: "fill" };

interface FillRequest {
  readonly itemId: string;
  readonly url: string;
  readonly coverHint: string | null;
}

const fillJobId = (itemId: string): string => `fill:${itemId}`;

// how long a held row waits before it is looked at again, should its turn somehow never seal: the
// seal re-times every row it holds to now
const HELD_MS = 24 * 60 * 60_000;

type HeldBy = Pick<TurnActor, "threadId" | "turn">;

// the reading of an item asked for in the write that made it wait: a second ask before the first
// was sent replaces it, since one reading of the page as it is now answers both
const queueFill = (
  db: CellDb,
  request: FillRequest & { readonly heldBy: HeldBy | null },
  at: number,
): void => {
  scheduleJob(
    db,
    {
      id: fillJobId(request.itemId),
      kind: "fill",
      payload: request,
    },
    at,
  );
};

const waitsForFill = (
  item: LiveItemRow,
): item is LiveItemRow & {
  readonly fields: LiveItemRow["fields"] & { readonly url: string };
} =>
  readingOf(item.fields).state === "pending" &&
  item.fields.url !== null &&
  item.fields.deletedAt === null;

// the reading of an item a write left waiting for one: a link saved to read later, one refreshed,
// one an import brought, one back from Deleted. A deleted item asks nothing, since the queue would
// let the reading go, and its way back asks again
export const askFill = (
  scope: WriteScope,
  item: LiveItemRow,
  coverHint: string | null = null,
): void => {
  if (waitsForFill(item)) {
    queueFill(
      scope.db,
      { coverHint, heldBy: null, itemId: item.id, url: item.fields.url },
      scope.now,
    );
  }
};

// the reading of a link the built-in agent saved, held until its turn seals (owner decision):
// within the turn the agent could otherwise save a page, read what it says and act on it, a web
// reader it was never given. The row names the turn, whose seal re-times it
export const askFillAfterTurn = (scope: WriteScope, item: LiveItemRow, turn: HeldBy): void => {
  if (waitsForFill(item)) {
    queueFill(
      scope.db,
      {
        coverHint: null,
        heldBy: { threadId: turn.threadId, turn: turn.turn },
        itemId: item.id,
        url: item.fields.url,
      },
      scope.now + HELD_MS,
    );
  }
};

// the readings a sealed turn held, due now
export const releaseHeldFills = (db: CellDb, turn: HeldBy, now: number): void => {
  db.update(jobs)
    .set({ nextAt: now })
    .where(
      and(
        eq(jobs.kind, "fill"),
        sql`json_extract(${jobs.payload}, '$.heldBy.threadId') = ${turn.threadId}`,
        sql`json_extract(${jobs.payload}, '$.heldBy.turn') = ${turn.turn}`,
      ),
    )
    .run();
};

const turnOpen = (db: CellDb, turn: HeldBy): boolean =>
  openTurnOf(db, turn.threadId)?.turn === turn.turn;

// a leased reading to send: its job, and its ask as the queue's message carries it
interface FillSend {
  readonly job: Lease<"fill">;
  readonly request: FillRequest;
}

// of the readings the alarm leased, those to send now; one its turn still holds waits a day more
export const fillsToSend = (db: CellDb, now: number, lot: readonly Lease<"fill">[]): FillSend[] =>
  lot.flatMap((job) => {
    const { heldBy, ...request } = job.payload;
    if (heldBy !== null && turnOpen(db, heldBy)) {
      scheduleJob(db, job, now + HELD_MS);
      return [];
    }
    return [{ job, request }];
  });

const pageOf = (landing: Extract<FillLanding, { kind: "read" }>) => ({
  article: landing.article,
  coverSha: landing.coverSha,
  facts: landing.facts,
  title: landing.title ?? "",
});

// the fields a reading leaves: a read page's, and the kind its address or its player shows it to be
const readFields = (
  fields: LibraryItemFields,
  landing: Extract<FillLanding, { kind: "read" }>,
  now: number,
): LibraryItemFields => {
  const upgraded = kindForUrl(landing.finalUrl);
  const kind =
    fields.kind === "link"
      ? (landing.playable ?? (upgraded === "link" ? fields.kind : upgraded))
      : fields.kind;
  return { ...withPage(fields, pageOf(landing), now), kind };
};

// whether the item still waits for this reading: live, unread, at the address it was asked at
const waiting = (item: StoredItem | null, url: string): item is StoredItem => {
  const held = item?.fields.url ?? null;
  return (
    item?.fields.deletedAt === null &&
    readingOf(item.fields).state === "pending" &&
    held !== null &&
    urlKey(held) === urlKey(url)
  );
};

// whether an item still waits for a reading of `url`, so a consumer reads no page nobody waits for
export const fillWaits = (db: CellDb, itemId: string, url: string): boolean =>
  waiting(readItem(db, itemId), url);

// the files a reading kept in the library on its way (`../fill/store-file`)
const readingFiles = (landing: FillLanding): string[] => {
  switch (landing.kind) {
    case "read": {
      return landing.coverSha === null ? [] : [landing.coverSha];
    }
    case "file": {
      return [landing.originalSha];
    }
    case "failed": {
      return [];
    }
    // no default
  }
};

// the reading landed on the item that waited for it
const landOn = (
  scope: ItemScope,
  item: StoredItem,
  landing: FillLanding,
  articleInNote: boolean,
): LiveItemRow => {
  const { fields } = item;
  switch (landing.kind) {
    case "failed": {
      return landFields(
        scope,
        item,
        withReading(fields, { at: scope.now, error: landing.sentence, kind: "failed" }),
      );
    }
    case "file": {
      const file: LibraryItemFields = {
        ...fields,
        coverSha: landing.fileKind === "image" ? landing.originalSha : fields.coverSha,
        kind: landing.fileKind,
        originalName: landing.originalName,
        originalSha: landing.originalSha,
      };
      return landFields(scope, item, withReading(file, { at: scope.now, kind: "read" }));
    }
    case "read": {
      return landRead(
        scope,
        item,
        { article: landing.article, articleInNote },
        readFields(fields, landing, scope.now),
      );
    }
    // no default
  }
};

const landFill = (scope: ItemScope, landing: FillLanding, articleInNote: boolean): FillLanded => {
  const item = readItem(scope.db, landing.itemId);
  if (!waiting(item, landing.url)) {
    // nobody waits for this reading, so the alarm lets go at once what it kept that no item names
    hurryUnnamed(scope.db, readingFiles(landing), scope.now);
    return { kind: "stale" };
  }
  const landed = landOn(scope, item, landing, articleInNote);
  foldReading(scope.db, { after: landed.fields, before: item.fields, itemId: item.id });
  return { kind: landing.kind === "failed" ? "failed" : "filled" };
};

// A page the cloud read, folded into the change set that made its item; an article its note
// already took lands as the note's projection. When the library would not take it, the alarm lets
// go at once what it kept that no item names; a reading its note is yet to take lands again.
export const landReading = (
  library: LibraryEngine,
  landing: FillLanding,
  inNote: NoteProjection | null,
): CellResult<FillLanded> => {
  const landed = library.land(
    FILL_ACTOR,
    { answer: fillLandedSchema, opId: undefined },
    (scope) => {
      const filled = landFill(scope, landing, inNote !== null);
      if (inNote !== null) {
        landProjection(scope, landing.itemId, inNote);
      }
      return filled;
    },
  );
  if (!landed.ok && landed.refusal.kind !== "gone" && landed.refusal.kind !== "note-opened") {
    library.rows((db, now) => {
      hurryUnnamed(db, readingFiles(landing), now);
    });
  }
  return landed;
};
