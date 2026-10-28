// The cloud's reading of the pages the library saved unread. A write that lands a link waiting for
// its page queues the reading in the same transaction, as a `fill` row of the jobs table, so a
// reading is never asked for a write that did not land and never lost by one that did; once the
// write commits the cell sends it to the fill queue (`../fill/fill-queues`), and the alarm sends
// again any row still waiting a minute later, a send that failed or a cell evicted before it sent.
// The consumer reads the page and hands it back (`../fill/fill-consumer`), and it lands here as a
// change set of its own: only the article and the facts a fill owns, so the person's note and
// fields are never touched, and only on an item still waiting for that reading at that address,
// so a message met twice lands once. One url, one item (R22): a page whose redirects end at an
// address another live item holds folds onto that item, unless the stub keeps highlights of its
// own, which its own text must hold.

import type { LibraryOp, ItemState } from "@repo/notes/library/block-ops";
import { applyOps } from "@repo/notes/library/block-ops";
import type { LibraryItemFields } from "@repo/notes/library/library-item";
import { readItemState } from "@repo/notes/library/library-queries";
import { runPlan } from "@repo/notes/library/library-sql";
import type { SqlStatements } from "@repo/notes/library/library-sql";
import { itemNameFromUrl } from "@repo/notes/items/item-name";
import { kindForUrl, urlKey } from "@repo/notes/items/item-url";
import { z } from "zod";

import type { FillLanded, FillLanding } from "../fill/fill-landing";
import type { CellActor } from "./cell-actor";
import { readAnnotationRows } from "./cell-annotations";
import { hurryUnnamed } from "./cell-blobs";
import type { CellCodec } from "./cell-codec";
import { placeQuotes } from "./cell-items";
import { deferJob, dueJobs, scheduleJob } from "./cell-jobs";
import type { DueJob } from "./cell-jobs";
import { urlHolder } from "./cell-landing";
import type { LandingScope, LiveItemRow } from "./cell-landing";
import { foldPage, quotesOf } from "./cell-saves";
import { landWrite } from "./cell-writes";

// who a page's reading is by, in History's words
export const FILL_ACTOR: CellActor = { kind: "fill", label: "Read from the web" };

// how long a sent reading's row waits before the alarm sends it again: long enough for the send
// that just went to have landed in the queue, which then holds it
const RESEND_AFTER_MS = 60_000;

interface FillRequest {
  readonly itemId: string;
  readonly url: string;
  readonly coverHint: string | null;
}

const fillJobId = (itemId: string): string => `fill:${itemId}`;

const requestSchema = z.strictObject({
  coverHint: z.string().nullable(),
  itemId: z.string(),
  url: z.string(),
});

// the reading of an item asked for in the write that made it wait: a second ask before the first
// was sent replaces it, since one reading of the page as it is now answers both
const queueFill = (sql: SqlStatements, request: FillRequest, now: number): void => {
  scheduleJob(
    sql,
    { id: fillJobId(request.itemId), kind: "fill", payload: JSON.stringify(request) },
    now,
  );
};

// the reading of an item a write left waiting for one: a link saved to read later, one refreshed,
// one an import brought
export const askFill = (
  scope: LandingScope,
  item: LiveItemRow,
  coverHint: string | null = null,
): void => {
  if (item.fields.fetchState === "pending" && item.fields.url !== null) {
    queueFill(scope.storage, { coverHint, itemId: item.id, url: item.fields.url }, scope.now);
  }
};

export interface ClaimedFill {
  readonly job: DueJob<"fill">;
  readonly request: FillRequest;
  // the time the row now waits for, which only this claim set
  readonly resendAt: number;
}

// the readings waiting to be sent, each put off a minute, so a send that never answers is sent
// again by the alarm and two commits in flight do not both send one
export const claimFills = (sql: SqlStatements, now: number): ClaimedFill[] =>
  dueJobs(sql, now, ["fill"]).map((job) => {
    const resendAt = now + RESEND_AFTER_MS;
    deferJob(sql, job.id, resendAt);
    return { job, request: requestSchema.parse(JSON.parse(job.payload)), resendAt };
  });

// the readings the queue took; a row asked for again since its claim stays for its own send
export const sentFills = (sql: SqlStatements, claimed: readonly ClaimedFill[]): void => {
  for (const fill of claimed) {
    sql.run("DELETE FROM jobs WHERE id = ? AND next_at = ? AND payload = ?", [
      fill.job.id,
      fill.resendAt,
      fill.job.payload,
    ]);
  }
};

// what a page says of itself, each set only where it said anything
const FACT_FIELDS = ["author", "description", "lang", "published", "site"] as const;

const changes = (op: LibraryOp): boolean => op.op !== "set" || op.base !== op.value;

// the fields a reading sets: what the page said of itself where it said anything (a value it did
// not give never removes one an import gave), its cover, the reading's own state, and a title in
// place of the address the item was named by while unread
const readFieldOps = (
  fields: LibraryItemFields,
  landing: Extract<FillLanding, { kind: "read" }>,
  now: number,
): LibraryOp[] => {
  const { facts } = landing;
  const placeholder = fields.url !== null && fields.title === itemNameFromUrl(fields.url);
  const upgraded = kindForUrl(landing.finalUrl);
  const kind =
    fields.kind === "link"
      ? (landing.playable ?? (upgraded === "link" ? fields.kind : upgraded))
      : fields.kind;
  const ops: LibraryOp[] = [];
  for (const field of FACT_FIELDS) {
    const value = facts[field];
    if (value !== null) {
      ops.push({ base: fields[field], field, op: "set", value });
    }
  }
  if (landing.coverSha !== null) {
    ops.push({ base: fields.coverSha, field: "coverSha", op: "set", value: landing.coverSha });
  }
  ops.push(
    { base: fields.kind, field: "kind", op: "set", value: kind },
    { base: fields.fetchError, field: "fetchError", op: "set", value: null },
    { base: fields.fetchState, field: "fetchState", op: "set", value: "filled" },
    { base: fields.fetchedAt, field: "fetchedAt", op: "set", value: now },
  );
  if (placeholder && landing.title !== null) {
    ops.push({ base: fields.title, field: "title", op: "set", value: landing.title });
  }
  return ops.filter(changes);
};

// the item's article replaced by the page's, unless the page held none, which leaves the item's
const articleOps = (state: ItemState, landing: Extract<FillLanding, { kind: "read" }>) =>
  landing.article.length === 0
    ? []
    : [
        ...[...state.blocks.values()]
          .filter((stored) => stored.section === "article")
          .map((stored): LibraryOp => ({
            baseHash: stored.hash,
            blockId: stored.block.id,
            op: "drop",
          })),
        ...landing.article.map(({ block, ord }): LibraryOp => ({
          block,
          op: "insert",
          ord,
          section: "article",
        })),
      ];

// the page read into the item, its highlights placed again in the article by their quotes, since
// the markers the old article held went with it; one the note holds stays where it is
const landRead = (
  scope: LandingScope,
  codec: CellCodec,
  item: { readonly id: string; readonly state: ItemState },
  landing: Extract<FillLanding, { kind: "read" }>,
): void => {
  const ops = [
    ...articleOps(item.state, landing),
    ...readFieldOps(item.state.fields, landing, scope.now),
  ];
  const quotes =
    landing.article.length === 0 ? [] : quotesOf(readAnnotationRows(scope.storage, item.id));
  const read = quotes.length === 0 ? null : applyOps(item.state, ops);
  if (read?.kind === "applied") {
    ops.push(...placeQuotes(read.state, codec, quotes).ops);
  }
  landWrite(scope, FILL_ACTOR, { itemId: item.id, ops });
};

// a stub whose page turned out to be another item's: the page lands on that item as a save of it
// would, the stub's tags and note go with it, and the stub goes to Deleted, where it can be
// restored. The fold is one change set of the fill's, both items in it
const foldOnto = (
  scope: LandingScope,
  codec: CellCodec,
  stub: { readonly id: string; readonly state: ItemState },
  holderId: string,
  landing: Extract<FillLanding, { kind: "read" }>,
): void => {
  const held = runPlan(scope.storage, readItemState(holderId));
  if (held === null) {
    return;
  }
  foldPage(
    scope,
    FILL_ACTOR,
    codec,
    { ...held, id: holderId },
    readAnnotationRows(scope.storage, holderId),
    {
      article: landing.article,
      copySha: null,
      coverSha: landing.coverSha,
      facts: landing.facts,
      folderId: null,
      title: landing.title ?? "",
      tags: stub.state.fields.tags,
    },
    null,
    [...stub.state.blocks.values()].filter((stored) => stored.section === "note"),
  );
  landWrite(scope, FILL_ACTOR, {
    itemId: stub.id,
    ops: [{ base: stub.state.fields.deletedAt, field: "deletedAt", op: "set", value: scope.now }],
  });
};

// whether the item still waits for this reading: live, unread, at the address it was asked at
const waiting = (state: ItemState | null, url: string): state is ItemState => {
  const held = state?.fields.url ?? null;
  return (
    state !== null &&
    state.fields.deletedAt === null &&
    state.fields.fetchState === "pending" &&
    held !== null &&
    urlKey(held) === urlKey(url)
  );
};

// whether an item still waits for a reading of `url`, so a consumer reads no page nobody waits for
export const fillWaits = (sql: SqlStatements, itemId: string, url: string): boolean =>
  waiting(runPlan(sql, readItemState(itemId)), url);

// the files a reading kept in the library on its way (`../fill/store-file`)
export const readingFiles = (landing: FillLanding): string[] => {
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

export const landFill = (
  scope: LandingScope,
  codec: CellCodec,
  landing: FillLanding,
): FillLanded => {
  const state = runPlan(scope.storage, readItemState(landing.itemId));
  if (!waiting(state, landing.url)) {
    // nobody waits for this reading, so the alarm lets go at once what it kept that no item names
    hurryUnnamed(scope.storage, readingFiles(landing), scope.now);
    return { kind: "stale" };
  }
  const item = { id: landing.itemId, state };
  const { fields } = state;
  switch (landing.kind) {
    case "failed": {
      const ops: LibraryOp[] = [
        { base: fields.fetchState, field: "fetchState", op: "set", value: "failed" },
        { base: fields.fetchError, field: "fetchError", op: "set", value: landing.sentence },
        { base: fields.fetchedAt, field: "fetchedAt", op: "set", value: scope.now },
      ];
      landWrite(scope, FILL_ACTOR, { itemId: item.id, ops: ops.filter(changes) });
      return { kind: "failed" };
    }
    case "file": {
      const ops: LibraryOp[] = [
        { base: fields.kind, field: "kind", op: "set", value: landing.fileKind },
        {
          base: fields.coverSha,
          field: "coverSha",
          op: "set",
          value: landing.fileKind === "image" ? landing.originalSha : fields.coverSha,
        },
        { base: fields.originalSha, field: "originalSha", op: "set", value: landing.originalSha },
        {
          base: fields.originalName,
          field: "originalName",
          op: "set",
          value: landing.originalName,
        },
        { base: fields.fetchError, field: "fetchError", op: "set", value: null },
        { base: fields.fetchState, field: "fetchState", op: "set", value: "filled" },
        { base: fields.fetchedAt, field: "fetchedAt", op: "set", value: scope.now },
      ];
      landWrite(scope, FILL_ACTOR, { itemId: item.id, ops: ops.filter(changes) });
      return { kind: "filled" };
    }
    case "read": {
      const finalKey = urlKey(landing.finalUrl);
      const holder =
        finalKey === null || finalKey === urlKey(landing.url)
          ? null
          : urlHolder(scope.storage, finalKey, item.id);
      if (holder !== null && readAnnotationRows(scope.storage, item.id).size === 0) {
        foldOnto(scope, codec, item, holder.id, landing);
        return { intoId: holder.id, kind: "folded" };
      }
      landRead(scope, codec, item, landing);
      return { kind: "filled" };
    }
    // no default
  }
};
