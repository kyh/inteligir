import { shownFileSha } from "@repo/contract/library/library-item";
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
import { fileTextJobSchema } from "../library/file-text-job";
import type { FileTextJob } from "../library/file-text-job";
import { FILE_STORE } from "./file-store-of";
import { imageParagraphs } from "./image-text";
import { pdfParagraphs } from "./pdf-text";

const landedSchema = z.enum(["landed", "stale"]);

const waits = (
  whole: { readonly item: StoredItem; readonly blocks: readonly BodyBlock[] } | null,
  job: FileTextJob,
): whole is { readonly item: StoredItem; readonly blocks: readonly BodyBlock[] } =>
  whole !== null &&
  whole.item.fields.deletedAt === null &&
  (whole.item.fields.kind === "pdf" || whole.item.fields.kind === "image") &&
  shownFileSha(whole.item.fields) === job.sha &&
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

const landText = async (
  writer: LibraryWriter,
  job: FileTextJob,
  article: readonly LibraryBlock[],
) =>
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

const paragraphsOf = async (kind: "image" | "pdf", bytes: Uint8Array) =>
  kind === "pdf" ? await pdfParagraphs(bytes) : await imageParagraphs(bytes);

export const FILE_TEXT_RUN = {
  payload: fileTextJobSchema,
  run: async (job, { accountId }) => {
    const whole = await readItemWhole(db, accountId, job.itemId);

    if (!waits(whole, job)) {
      return "done";
    }

    const { kind } = whole.item.fields;
    const bytes = await bytesOf(accountId, job.sha);

    const paragraphs =
      bytes === null || (kind !== "pdf" && kind !== "image") ? [] : await paragraphsOf(kind, bytes);

    if (paragraphs.length === 0) {
      return "done";
    }

    const writer = { accountId, actor: { kind: "fill" } } satisfies LibraryWriter;
    const landed = await landText(writer, job, articleOf(paragraphs));

    if (!landed.ok && landed.refusal.kind === "busy") {
      return "retry";
    }

    if (!landed.ok && landed.refusal.kind !== "gone") {
      console.warn({ event: "file-text-refused", refusal: landed.refusal.kind });
    }

    return "done";
  },
  tries: { kind: "until-done" },
} satisfies JobRun<FileTextJob>;
