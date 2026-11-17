// The markdown codec's ports over the library's rows, read in one round inside the write that
// uses them (`@repo/editor/headless/codec/one-round-lookup`): a `[[Title]]` names the one live
// item filed under that title or an alias, a page link an item by its id, its card's title the
// words a link shows, and `assets/<sha>` the library's own file under that sha, its kind read off
// the type it was uploaded as.

import { randomUUID } from "node:crypto";

import { fileKindOfMime } from "@repo/contract/items/item-kind";
import type { BodyBlock } from "@repo/contract/library/derive-item";
import type { DbExecutor } from "@repo/db/drizzle-client";
import { file, item } from "@repo/db/library-schema";
import { libraryLinks } from "@repo/editor/headless/codec/library-links";
import { readInOneRound } from "@repo/editor/headless/codec/one-round-lookup";
import type { LookupAnswers, LookupAsks } from "@repo/editor/headless/codec/one-round-lookup";
import { readBody } from "@repo/editor/headless/codec/read-body";
import { and, arrayOverlaps, eq, inArray, isNull, or } from "drizzle-orm";

import { errorFields } from "../log";
import { refuse } from "./library-refusal";
import type { WriteScope } from "./library-store";

// each asked key's one live item, by its title or an alias: a key two items answer to names
// neither, since a link by that title reaches neither
const titledOf = async (
  db: DbExecutor,
  accountId: string,
  keys: readonly string[],
): Promise<LookupAnswers["titled"]> => {
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
  );
};

// each asked id's card title, an item in Deleted included, since a link to it still shows its name
const titlesOf = async (
  db: DbExecutor,
  accountId: string,
  ids: readonly string[],
): Promise<LookupAnswers["titles"]> => {
  const rows =
    ids.length === 0
      ? []
      : await db
          .select({ card: item.card, id: item.id })
          .from(item)
          .where(and(eq(item.accountId, accountId), inArray(item.id, [...ids])));
  const held = new Map(rows.map((row) => [row.id, row.card.title]));
  return new Map(ids.map((id) => [id, held.get(id) ?? null]));
};

const fileKindsOf = async (
  db: DbExecutor,
  accountId: string,
  shas: readonly string[],
): Promise<LookupAnswers["fileKinds"]> => {
  const rows =
    shas.length === 0
      ? []
      : await db
          .select({ mime: file.mime, sha256: file.sha256 })
          .from(file)
          .where(and(eq(file.accountId, accountId), inArray(file.sha256, [...shas])));
  const held = new Map(rows.map((row) => [row.sha256, fileKindOfMime(row.mime)]));
  return new Map(shas.map((sha) => [sha, held.get(sha) ?? null]));
};

const answerOf =
  (db: DbExecutor, accountId: string) =>
  async (asks: LookupAsks): Promise<LookupAnswers> => {
    const [titled, titles, fileKinds] = await Promise.all([
      titledOf(db, accountId, [...asks.titleKeys]),
      titlesOf(db, accountId, [...asks.itemIds]),
      fileKindsOf(db, accountId, [...asks.shas]),
    ]);
    return { fileKinds, titled, titles };
  };

// a codec that asks past its round reads those links as text, which only a change to the codec's
// own reads can cause
const logUnanswered = (asks: LookupAsks): void => {
  const count = asks.titleKeys.size + asks.itemIds.size + asks.shas.size;
  if (count > 0) {
    console.error({ count, event: "codec-asked-past-its-round" });
  }
};

// A person's or an agent's markdown as note blocks, every block of it or none: text past what the
// codec reads, or holding a block no body can store, is refused as too large. A rule that failed
// reading it is the codec's fault and not the text's, so it is said here
export const noteBlocksOf = async (
  scope: Pick<WriteScope, "accountId" | "tx">,
  markdown: string,
): Promise<readonly BodyBlock[]> => {
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
    return refuse({ kind: "too-large" });
  }
  return read.blocks.map((block) => ({ block, section: "note" }));
};
