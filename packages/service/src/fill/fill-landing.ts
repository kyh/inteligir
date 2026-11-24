import { kindForUrl, urlKey } from "@repo/contract/items/item-url";
import type { BodyBlock } from "@repo/contract/library/derive-item";
import { withPage, withReading } from "@repo/contract/library/item-reading";
import type { ReadPage } from "@repo/contract/library/item-reading";
import type { LibraryItemFields } from "@repo/contract/library/library-item";
import type { LibraryBlock } from "@repo/contract/library/library-nodes";
import { db } from "@repo/db/drizzle-client";
import { z } from "zod";

import { withArticle } from "../library/article-body";
import { foldReading } from "../library/library-change-sets";
import { landItem } from "../library/library-landing";
import { readItemRow, readItemWhole } from "../library/library-rows";
import type { StoredItem } from "../library/library-rows";
import type { LibraryWriter, WriteScope } from "../library/library-store";
import { writeLibrary } from "../library/library-store";
import type { FillJob } from "../library/fill-job";
import { TEXT_NOT_SAVED } from "./fill-sentences";

export type FillLanding =
  | {
      readonly kind: "read";
      readonly article: readonly LibraryBlock[];
      readonly coverSha: string | null;
      readonly facts: ReadPage["facts"];
      readonly finalUrl: string;
      readonly playable: "video" | "audio" | null;
      readonly title: string | null;
    }
  | {
      readonly kind: "file";
      readonly fileKind: "image" | "pdf";
      readonly originalName: string;
      readonly originalSha: string;
    }
  | { readonly kind: "failed"; readonly sentence: string };

const filledSchema = z.enum(["filled", "failed", "stale"]);

const waiting = (item: StoredItem | null, url: string): item is StoredItem => {
  const held = item?.fields.url ?? null;

  return (
    item?.fields.deletedAt === null &&
    item.fields.reading.state === "pending" &&
    held !== null &&
    urlKey(held) === urlKey(url)
  );
};

export const fillWaits = async (accountId: string, job: FillJob) => {
  const held = await readItemRow(db, accountId, job.itemId);

  return waiting(held?.item ?? null, job.url);
};

const readFields = (
  fields: LibraryItemFields,
  landing: Extract<FillLanding, { kind: "read" }>,
  now: number,
) => {
  const upgraded = kindForUrl(landing.finalUrl);

  const kind =
    fields.kind === "link"
      ? (landing.playable ?? (upgraded === "link" ? fields.kind : upgraded))
      : fields.kind;

  const page = { coverSha: landing.coverSha, facts: landing.facts, title: landing.title ?? "" };

  return { ...withPage(fields, page, now), kind } satisfies LibraryItemFields;
};

const landedOn = (
  { blocks, item }: { readonly blocks: readonly BodyBlock[]; readonly item: StoredItem },
  landing: FillLanding,
  now: number,
) => {
  const { fields } = item;

  switch (landing.kind) {
    case "failed": {
      return {
        body: null,
        fields: withReading(fields, { at: now, error: landing.sentence, kind: "failed" }),
      };
    }

    case "file": {
      const file: LibraryItemFields = {
        ...fields,
        coverSha: landing.fileKind === "image" ? landing.originalSha : fields.coverSha,
        kind: landing.fileKind,
        originalName: landing.originalName,
        originalSha: landing.originalSha,
      };

      return { body: null, fields: withReading(file, { at: now, kind: "read" }) };
    }

    case "read": {
      return {
        body: landing.article.length === 0 ? null : withArticle(blocks, landing.article),
        fields: readFields(fields, landing, now),
      };
    }

    default: {
      throw new Error(`unexpected ${String(landing satisfies never)}`);
    }
  }
};

const landOnce = async (writer: LibraryWriter, job: FillJob, landing: FillLanding) =>
  await writeLibrary(
    writer,
    { answer: filledSchema, opId: undefined },
    async (scope: WriteScope) => {
      const whole = await readItemWhole(scope.tx, scope.accountId, job.itemId);

      if (whole === null || !waiting(whole.item, job.url)) {
        return "stale";
      }

      const { body, fields } = landedOn(whole, landing, scope.now);
      await landItem(scope, { before: whole.item, body, fields, itemId: job.itemId });
      await foldReading(scope, {
        after: fields,
        before: whole.item.fields,
        itemId: job.itemId,
        versionAfter: body === null ? whole.bodyVersion : whole.bodyVersion + 1,
        versionBefore: whole.bodyVersion,
      });

      return landing.kind === "failed" ? "failed" : "filled";
    },
  );

export const landFill = async (writer: LibraryWriter, job: FillJob, landing: FillLanding) => {
  const landed = await landOnce(writer, job, landing);

  if (landed.ok || landed.refusal.kind === "gone") {
    return;
  }

  const { kind } = landed.refusal;

  if (kind === "busy" || kind === "blob-missing") {
    throw new Error(`the reading's landing was refused (${kind}), so it is tried again`);
  }

  if (landing.kind === "failed") {
    console.error({ event: "fill-failure-refused", refusal: kind });

    return;
  }

  console.warn({ event: "fill-landing-refused", refusal: kind });
  await landFill(writer, job, { kind: "failed", sentence: TEXT_NOT_SAVED });
};
