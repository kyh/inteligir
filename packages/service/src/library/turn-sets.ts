import type { DbExecutor, Tx } from "@repo/db/drizzle-client";
import { changeSet } from "@repo/db/library-schema";
import { and, eq, isNull } from "drizzle-orm";

import { mintLibraryId } from "./library-ids";
import type { TurnActor } from "./library-principal";
import { refuse } from "./library-refusal";

type TurnKey = Pick<TurnActor, "threadId" | "turn">;

const turnIs = (accountId: string, turn: TurnKey) =>
  and(
    eq(changeSet.accountId, accountId),
    eq(changeSet.threadId, turn.threadId),
    eq(changeSet.turn, turn.turn),
  );

export const joinTurnSet = async (tx: Tx, accountId: string, turn: TurnKey, now: number) => {
  const [held] = await tx
    .select({ id: changeSet.id, sealedAt: changeSet.sealedAt })
    .from(changeSet)
    .where(turnIs(accountId, turn));

  if (held === undefined) {
    const id = mintLibraryId(now);
    await tx.insert(changeSet).values({ accountId, id, threadId: turn.threadId, turn: turn.turn });

    return id;
  }

  return held.sealedAt === null ? held.id : refuse({ kind: "turn-ended" });
};

export const sealTurnSet = async (
  db: DbExecutor,
  accountId: string,
  turn: TurnKey,
  now: number,
) => {
  await db
    .update(changeSet)
    .set({ sealedAt: now })
    .where(and(turnIs(accountId, turn), isNull(changeSet.sealedAt)));
};
