import { randomUUID } from "node:crypto";

import { fileKindOfMime } from "@repo/contract/items/item-kind";
import type { BodyBlock } from "@repo/contract/library/derive-item";
import type { DbExecutor } from "@repo/db/drizzle-client";
import { file, item, itemLink } from "@repo/db/library-schema";
import { editItemView } from "@repo/editor/headless/codec/item-edit";
import type { ViewEdit } from "@repo/editor/headless/codec/item-edit";
import { libraryLinks } from "@repo/editor/headless/codec/library-links";
import { readInOneRound } from "@repo/editor/headless/codec/one-round-lookup";
import type { LookupAnswers, LookupAsks } from "@repo/editor/headless/codec/one-round-lookup";
import { readBody } from "@repo/editor/headless/codec/read-body";
import { and, arrayOverlaps, eq, inArray, isNull, or } from "drizzle-orm";

import { errorFields } from "../log";
import { refuse } from "./library-refusal";
import type { WriteScope } from "./library-store";

const titledOf = async (db: DbExecutor, accountId: string, keys: readonly string[]) => {
  const rows =
    keys.length === 0
      ? []
      : await db
          .select({
            aliasKeys: item.aliasKeys,
            card: item.card,
            id: item.id,
            titleKey: item.titleKey,
          })
          .from(item)
          .where(
            and(
              eq(item.accountId, accountId),
              isNull(item.deletedAt),
              or(inArray(item.titleKey, [...keys]), arrayOverlaps(item.aliasKeys, [...keys])),
            ),
          );

  return new Map(
    keys.map((key) => {
      const [only, ...others] = rows.filter(
        (row) => row.titleKey === key || row.aliasKeys.includes(key),
      );

      return [
        key,
        only === undefined || others.length > 0
          ? null
          : { itemId: only.id, title: only.card.title },
      ];
    }),
  ) satisfies LookupAnswers["titled"];
};

const titlesOf = async (db: DbExecutor, accountId: string, ids: readonly string[]) => {
  const rows =
    ids.length === 0
      ? []
      : await db
          .select({ card: item.card, id: item.id })
          .from(item)
          .where(and(eq(item.accountId, accountId), inArray(item.id, [...ids])));

  const held = new Map(rows.map((row) => [row.id, row.card.title]));

  return new Map(ids.map((id) => [id, held.get(id) ?? null])) satisfies LookupAnswers["titles"];
};

const linkedTitlesOf = async (db: DbExecutor, accountId: string, sourceId: string) => {
  const rows = await db
    .select({ card: item.card, id: item.id })
    .from(itemLink)
    .innerJoin(item, and(eq(item.accountId, itemLink.accountId), eq(item.id, itemLink.targetId)))
    .where(and(eq(itemLink.accountId, accountId), eq(itemLink.sourceId, sourceId)));

  return new Map(rows.map((row) => [row.id, row.card.title])) satisfies LookupAnswers["titles"];
};

const fileKindsOf = async (db: DbExecutor, accountId: string, shas: readonly string[]) => {
  const rows =
    shas.length === 0
      ? []
      : await db
          .select({ mime: file.mime, sha256: file.sha256 })
          .from(file)
          .where(and(eq(file.accountId, accountId), inArray(file.sha256, [...shas])));

  const held = new Map(rows.map((row) => [row.sha256, fileKindOfMime(row.mime)]));

  return new Map(
    shas.map((sha) => [sha, held.get(sha) ?? null]),
  ) satisfies LookupAnswers["fileKinds"];
};

const answerOf = (db: DbExecutor, accountId: string) => async (asks: LookupAsks) => {
  const [titled, titles, fileKinds] = await Promise.all([
    titledOf(db, accountId, [...asks.titleKeys]),
    titlesOf(db, accountId, [...asks.itemIds]),
    fileKindsOf(db, accountId, [...asks.shas]),
  ]);

  return { fileKinds, titled, titles } satisfies LookupAnswers;
};

const logUnanswered = (asks: LookupAsks) => {
  const count = asks.titleKeys.size + asks.itemIds.size + asks.shas.size;

  if (count > 0) {
    console.error({ count, event: "codec-asked-past-its-round" });
  }
};

export const noteBlocksOf: (
  scope: Pick<WriteScope, "accountId" | "tx">,
  markdown: string,
) => Promise<readonly BodyBlock[]> = async (
  scope: Pick<WriteScope, "accountId" | "tx">,
  markdown: string,
) => {
  const { unanswered, value: read } = await readInOneRound(
    (lookup) => {
      const links = libraryLinks(lookup);

      return readBody(markdown, { links, newBlockId: randomUUID, wiki: links.wiki });
    },
    answerOf(scope.tx, scope.accountId),
  );

  logUnanswered(unanswered);

  if (!read.ok && read.reason.kind === "failed") {
    console.error({ event: "markdown-read-failed", ...errorFields(read.reason.error) });
  }

  if (!read.ok || read.refused > 0) {
    const fault = !read.ok && read.reason.kind === "too-deep" ? "too-deep" : "unstorable";

    return refuse({ fault, kind: "markdown-refused" });
  }

  return read.blocks.map((block) => ({ block, section: "note" }));
};

export const editOutcomeOf = async (
  db: DbExecutor,
  accountId: string,
  edit: {
    readonly itemId: string;
    readonly blocks: readonly BodyBlock[];
    readonly edits: readonly ViewEdit[];
  },
) => {
  const known: LookupAnswers = {
    fileKinds: new Map(),
    titled: new Map(),
    titles: await linkedTitlesOf(db, accountId, edit.itemId),
  };

  const { unanswered, value } = await readInOneRound(
    (lookup) => editItemView(edit.blocks, edit.edits, { ...lookup, newBlockId: randomUUID }),
    answerOf(db, accountId),
    known,
  );

  logUnanswered(unanswered);

  if (value.kind === "failed") {
    console.error({ event: "markdown-read-failed", ...errorFields(value.error) });
  }

  return value;
};
