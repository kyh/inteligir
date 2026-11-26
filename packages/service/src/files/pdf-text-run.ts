import type { BodyBlock } from "@repo/contract/library/derive-item";
import type { LibraryBlock } from "@repo/contract/library/library-nodes";
import { db } from "@repo/db/drizzle-client";
import { z } from "zod";

import { withArticle } from "../library/article-body";
import { fileOf } from "../library/file-names";
import { foldReading } from "../library/library-change-sets";
import type { JobRun } from "../library/job-queue";
import { landItem } from "../library/library-landing";
import { readItemWhole } from "../library/library-rows";
import type { StoredItem } from "../library/library-rows";
import type { LibraryWriter, WriteScope } from "../library/library-store";
import { writeLibrary } from "../library/library-store";
import { pdfTextJobSchema } from "../library/pdf-text-job";
import type { PdfTextJob } from "../library/pdf-text-job";
import { FILE_STORE } from "./file-store-of";
import { pdfParagraphs } from "./pdf-text";

const landedSchema = z.enum(["landed", "stale"]);

const waits = (
  whole: { readonly item: StoredItem; readonly blocks: readonly BodyBlock[] } | null,
  job: PdfTextJob,
): whole is { readonly item: StoredItem; readonly blocks: readonly BodyBlock[] } =>
  whole !== null &&
  whole.item.fields.deletedAt === null &&
  whole.item.fields.kind === "pdf" &&
  whole.item.fields.originalSha === job.sha &&
  (job.again || !whole.blocks.some(({ section }) => section === "article"));

const bytesOf = async (accountId: string, sha: string) => {
  const held = await fileOf(db, accountId, sha);
  const read = held === null ? null : await FILE_STORE.read(held.pathname, null);

  return read === null ? null : new Uint8Array(await new Response(read.body).arrayBuffer());
};

const articleOf = (paragraphs: readonly string[]) =>
  paragraphs.map(
    (text) => ({ children: [{ text }], id: crypto.randomUUID(), type: "p" }) satisfies LibraryBlock,
  );

const landText = async (writer: LibraryWriter, job: PdfTextJob, article: readonly LibraryBlock[]) =>
  await writeLibrary(
    writer,
    { answer: landedSchema, opId: undefined },
    async (scope: WriteScope) => {
      const whole = await readItemWhole(scope.tx, scope.accountId, job.itemId);

      if (!waits(whole, job)) {
        return "stale";
      }

      const { fields } = whole.item;
      const body = withArticle(whole.blocks, article);
      await landItem(scope, { before: whole.item, body, fields, itemId: job.itemId });
      await foldReading(scope, {
        after: fields,
        before: fields,
        itemId: job.itemId,
        versionAfter: whole.bodyVersion + 1,
        versionBefore: whole.bodyVersion,
      });

      return "landed";
    },
  );

export const PDF_TEXT_RUN = {
  payload: pdfTextJobSchema,
  run: async (job, { accountId }) => {
    if (!waits(await readItemWhole(db, accountId, job.itemId), job)) {
      return "done";
    }

    const bytes = await bytesOf(accountId, job.sha);
    const paragraphs = bytes === null ? [] : await pdfParagraphs(bytes);

    if (paragraphs.length === 0) {
      return "done";
    }

    const writer = { accountId, actor: { kind: "fill" } } satisfies LibraryWriter;
    const landed = await landText(writer, job, articleOf(paragraphs));

    if (!landed.ok && landed.refusal.kind === "busy") {
      return "retry";
    }

    if (!landed.ok && landed.refusal.kind !== "gone") {
      console.warn({ event: "pdf-text-refused", refusal: landed.refusal.kind });
    }

    return "done";
  },
  tries: { kind: "until-done" },
} satisfies JobRun<PdfTextJob>;
