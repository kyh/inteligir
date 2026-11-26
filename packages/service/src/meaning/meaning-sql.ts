import type { DbExecutor } from "@repo/db/drizzle-client";
import { item, itemMeaning } from "@repo/db/library-schema";
import { CONTAINER_KINDS } from "@repo/contract/items/item-kind";
import { and, asc, cosineDistance, eq, inArray, isNull, lt, ne, not } from "drizzle-orm";

import { embedTexts } from "./embedder";

const NEAR_DISTANCE_MAX = 0.75;

interface Near {
  readonly limit: number;
  readonly except: string | null;
}

const nearestIds = async (
  db: DbExecutor,
  accountId: string,
  embedding: readonly number[],
  { except, limit }: Near,
) => {
  const distance = cosineDistance(itemMeaning.embedding, [...embedding]);

  const rows = await db
    .select({ id: item.id })
    .from(itemMeaning)
    .innerJoin(
      item,
      and(eq(item.accountId, itemMeaning.accountId), eq(item.id, itemMeaning.itemId)),
    )
    .where(
      and(
        eq(itemMeaning.accountId, accountId),
        isNull(item.deletedAt),
        not(inArray(item.kind, [...CONTAINER_KINDS])),
        except === null ? undefined : ne(item.id, except),
        lt(distance, NEAR_DISTANCE_MAX),
      ),
    )
    .orderBy(asc(distance), asc(item.id))
    .limit(limit);

  return rows.map(({ id }) => id);
};

export const nearItem = async (db: DbExecutor, accountId: string, id: string, limit: number) => {
  const [own] = await db
    .select({ embedding: itemMeaning.embedding })
    .from(itemMeaning)
    .where(and(eq(itemMeaning.accountId, accountId), eq(itemMeaning.itemId, id)));

  return own === undefined
    ? []
    : await nearestIds(db, accountId, own.embedding, { except: id, limit });
};

export const nearWords = async (
  db: DbExecutor,
  accountId: string,
  words: string,
  limit: number,
) => {
  const [embedding] = await embedTexts([words]);

  return embedding === undefined
    ? []
    : await nearestIds(db, accountId, embedding, { except: null, limit });
};
