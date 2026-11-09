// The cloud's reading of the pages the library saved unread. A write that lands a link waiting for
// its page queues the reading in the same transaction, as a `fill` row of the jobs table, so a
// reading is never asked for a write that did not land and never lost by one that did; once the
// write commits the cell sends it to the fill queue (`apps/web/fill-queues.ts`), and the alarm sends
// again any row still waiting a minute later, a send that failed or a cell evicted before it sent.
// The consumer reads the page and hands it back (`../fill/fill-consumer`), and it lands here as a
// change set of its own: only the article and the facts a fill owns, so the person's note and
// fields are never touched, and only on an item still waiting for that reading at that address,
// so a message met twice lands once. A page whose redirects end at another address is read into
// the item that waited for it, which keeps the address it was saved at.

import type { LibraryOp, ItemState } from "@repo/contract/library/block-ops";
import type { LibraryItemFields } from "@repo/contract/library/library-item";
import { readItemState } from "./library-queries";
import { runPlan } from "./library-sql";
import type { SqlStatements } from "./library-sql";
import { jsonTextSchema } from "./sql-value";
import { kindForUrl, urlKey } from "@repo/contract/items/item-url";
import { z } from "zod";

import type { FillLanded, FillLanding } from "../fill/fill-landing";
import type { CellActor } from "./cell-actor";
import { hurryUnnamed } from "./cell-blobs";
import { deferJob, dueJobs, scheduleJob } from "./cell-jobs";
import type { DueJob } from "./cell-jobs";
import type { LandingScope, LiveItemRow } from "./cell-landing";
import { changes, landRead, pageFieldOps, readOps } from "./cell-saves";
import { landWrite } from "./cell-writes";

// who a page's reading is by, in its change set's words
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

// a row the built-in agent's turn holds names its change set, and waits until the set seals
const requestSchema = z.strictObject({
  coverHint: z.string().nullable(),
  heldBy: z.string().nullable(),
  itemId: z.string(),
  url: z.string(),
});

// how long a held row waits before it is looked at again, should its turn somehow never seal: the
// seal re-times every row it holds to now
const HELD_MS = 24 * 60 * 60_000;

// the reading of an item asked for in the write that made it wait: a second ask before the first
// was sent replaces it, since one reading of the page as it is now answers both
const queueFill = (
  sql: SqlStatements,
  request: FillRequest & { readonly heldBy: string | null },
  at: number,
): void => {
  scheduleJob(
    sql,
    {
      id: fillJobId(request.itemId),
      kind: "fill",
      payload: JSON.stringify(requestSchema.parse(request)),
    },
    at,
  );
};

const waitsForFill = (
  item: LiveItemRow,
): item is LiveItemRow & {
  readonly fields: LiveItemRow["fields"] & { readonly url: string };
} =>
  item.fields.fetchState === "pending" &&
  item.fields.url !== null &&
  item.fields.deletedAt === null;

// the reading of an item a write left waiting for one: a link saved to read later, one refreshed,
// one an import brought, one back from Deleted. A deleted item asks nothing, since the queue would
// let the reading go, and its way back asks again
export const askFill = (
  scope: LandingScope,
  item: LiveItemRow,
  coverHint: string | null = null,
): void => {
  if (waitsForFill(item)) {
    queueFill(
      scope.storage,
      { coverHint, heldBy: null, itemId: item.id, url: item.fields.url },
      scope.now,
    );
  }
};

// the reading of a link the built-in agent saved, held until its turn seals (owner decision):
// within the turn the agent could otherwise save a page, read what it says and act on it, a web
// reader it was never given. The row names the turn's change set, which the seal re-times
export const askFillAfterTurn = (
  scope: LandingScope,
  item: LiveItemRow,
  changeSetId: string,
): void => {
  if (waitsForFill(item)) {
    queueFill(
      scope.storage,
      { coverHint: null, heldBy: changeSetId, itemId: item.id, url: item.fields.url },
      scope.now + HELD_MS,
    );
  }
};

const heldSchema = z.object({ id: z.string() });

// the readings a sealed turn held, due now
export const releaseHeldFills = (
  sql: SqlStatements,
  changeSetIds: readonly string[],
  now: number,
): void => {
  for (const changeSetId of changeSetIds) {
    for (const raw of sql.all(
      "SELECT id FROM jobs WHERE kind = 'fill' AND json_extract(payload, '$.heldBy') = ?",
      [changeSetId],
    )) {
      sql.run("UPDATE jobs SET next_at = ? WHERE id = ?", [now, heldSchema.parse(raw).id]);
    }
  }
};

const sealedSchema = z.object({ sealed_at: z.number().nullable() });

// whether a held row's turn has sealed: a set the library no longer keeps holds nothing
const turnSealed = (sql: SqlStatements, changeSetId: string): boolean => {
  const [row] = sql.all("SELECT sealed_at FROM change_sets WHERE id = ?", [changeSetId]);
  return row === undefined || sealedSchema.parse(row).sealed_at !== null;
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
  dueJobs(sql, now, ["fill"]).flatMap((job) => {
    const { heldBy, ...request } = jsonTextSchema.pipe(requestSchema).parse(job.payload);
    if (heldBy !== null && !turnSealed(sql, heldBy)) {
      deferJob(sql, job.id, now + HELD_MS);
      return [];
    }
    const resendAt = now + RESEND_AFTER_MS;
    deferJob(sql, job.id, resendAt);
    return [{ job, request, resendAt }];
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

const pageOf = (landing: Extract<FillLanding, { kind: "read" }>) => ({
  article: landing.article,
  coverSha: landing.coverSha,
  facts: landing.facts,
  title: landing.title ?? "",
});

// the fields a reading sets: a read page's, and the kind its address or its player shows it to be
const readFieldOps = (
  fields: LibraryItemFields,
  landing: Extract<FillLanding, { kind: "read" }>,
  now: number,
): LibraryOp[] => {
  const upgraded = kindForUrl(landing.finalUrl);
  const kind =
    fields.kind === "link"
      ? (landing.playable ?? (upgraded === "link" ? fields.kind : upgraded))
      : fields.kind;
  return [
    ...pageFieldOps(fields, pageOf(landing), now),
    ...(kind === fields.kind
      ? []
      : [{ base: fields.kind, field: "kind", op: "set", value: kind } as const]),
  ];
};

// whether the item still waits for this reading: live, unread, at the address it was asked at
const waiting = (state: ItemState | null, url: string): state is ItemState => {
  const held = state?.fields.url ?? null;
  return (
    state?.fields.deletedAt === null &&
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

export const landFill = (scope: LandingScope, landing: FillLanding): FillLanded => {
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
      landWrite(scope, { itemId: item.id, ops: ops.filter(changes) });
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
        ...readOps(fields, scope.now),
      ];
      landWrite(scope, { itemId: item.id, ops: ops.filter(changes) });
      return { kind: "filled" };
    }
    case "read": {
      landRead(scope, item, landing, readFieldOps(fields, landing, scope.now));
      return { kind: "filled" };
    }
    // no default
  }
};
