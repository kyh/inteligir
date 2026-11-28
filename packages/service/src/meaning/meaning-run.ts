import { db } from "@repo/db/drizzle-client";
import type { DbExecutor } from "@repo/db/drizzle-client";
import { item, itemMeaning, itemSearch } from "@repo/db/library-schema";
import { and, eq, isNull, ne, notInArray, or, sql } from "drizzle-orm";
import { z } from "zod";

import type { JobRun } from "../library/job-queue";
import { askMeaning, meaningJobSchema } from "../library/meaning-job";
import type { MeaningJob } from "../library/meaning-job";
import type { LibraryWriter } from "../library/library-store";
import { writeLibrary } from "../library/library-store";
import { anyOf } from "../library/set-sql";
import { embedTexts, MEANING_TEXT_MAX } from "./embedder";

const BATCH = 64;

const meaningText = sql<string>`left(${itemSearch.text}, ${MEANING_TEXT_MAX})`;

const textSha = sql<string>`encode(sha256(convert_to(${meaningText}, 'UTF8')), 'hex')`;

const unread = async (executor: DbExecutor, accountId: string) =>
  await executor
    .select({ id: itemSearch.itemId, sha: textSha, text: meaningText })
    .from(itemSearch)
    .innerJoin(item, and(eq(item.accountId, itemSearch.accountId), eq(item.id, itemSearch.itemId)))
    .leftJoin(
      itemMeaning,
      and(
        eq(itemMeaning.accountId, itemSearch.accountId),
        eq(itemMeaning.itemId, itemSearch.itemId),
      ),
    )
    .where(
      and(
        eq(itemSearch.accountId, accountId),
        isNull(item.deletedAt),
        notInArray(item.kind, ["folder", "list"]),
        sql`btrim(${itemSearch.text}) <> ''`,
        or(isNull(itemMeaning.textSha), ne(itemMeaning.textSha, textSha)),
      ),
    )
    .limit(BATCH);

interface Read {
  readonly id: string;
  readonly sha: string;
  readonly embedding: number[];
}

const keep = async (writer: LibraryWriter, read: readonly Read[], more: boolean) =>
  await writeLibrary(writer, { answer: z.number(), opId: undefined }, async (scope) => {
    const live = await scope.tx
      .select({ id: item.id })
      .from(item)
      .where(
        and(
          eq(item.accountId, scope.accountId),
          anyOf(
            item.id,
            read.map(({ id }) => id),
          ),
        ),
      );

    const held = new Set(live.map(({ id }) => id));
    const rows = read.filter(({ id }) => held.has(id));

    if (rows.length > 0) {
      await scope.tx
        .insert(itemMeaning)
        .values(
          rows.map(({ embedding, id, sha }) => ({
            accountId: scope.accountId,
            embedding,
            itemId: id,
            textSha: sha,
          })),
        )
        .onConflictDoUpdate({
          set: { embedding: sql`excluded.embedding`, textSha: sql`excluded.text_sha` },
          target: [itemMeaning.accountId, itemMeaning.itemId],
        });
    }

    if (more) {
      await askMeaning(scope, 0);
    }

    return rows.length;
  });

export const MEANING_RUN = {
  payload: meaningJobSchema,
  run: async (_job, { accountId }) => {
    const due = await unread(db, accountId);

    if (due.length === 0) {
      return "done";
    }

    let embeddings: number[][];

    try {
      embeddings = await embedTexts(due.map(({ text }) => text));
    } catch (error) {
      console.warn({ error: String(error), event: "meaning-unread" });

      return "retry";
    }

    const read = due.flatMap(({ id, sha }, at) => {
      const embedding = embeddings[at];

      return embedding === undefined ? [] : [{ embedding, id, sha }];
    });

    const writer = { accountId, actor: { kind: "fill" } } satisfies LibraryWriter;
    const kept = await keep(writer, read, due.length === BATCH);

    return !kept.ok && kept.refusal.kind === "busy" ? "retry" : "done";
  },
  tries: { kind: "until-done" },
} satisfies JobRun<MeaningJob>;
