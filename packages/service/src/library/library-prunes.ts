import { agentThread } from "@repo/db/agent-schema";
import type { Tx } from "@repo/db/drizzle-client";
import { changeSet, changeSetFile, changeSetItem, file, opAnswer } from "@repo/db/library-schema";
import { and, eq, inArray, isNotNull, isNull, lt, notExists, sql } from "drizzle-orm";

import { idleAccounts } from "./idle-accounts";
import { takeLibraryHead } from "./library-store";
import { anyOf } from "./set-sql";

const DAY_MS = 24 * 60 * 60_000;
const UNDO_REACH_MS = 7 * DAY_MS;
const OP_ANSWER_MS = 30 * DAY_MS;

const stampExpiredThreads = async (
  tx: Tx,
  expired: readonly { readonly accountId: string; readonly threadId: string }[],
) => {
  const byAccount = new Map<string, Set<string>>();

  for (const { accountId, threadId } of expired) {
    byAccount.set(accountId, (byAccount.get(accountId) ?? new Set()).add(threadId));
  }

  for (const [accountId, threadIds] of byAccount) {
    const seq = await takeLibraryHead(tx, accountId);
    await tx
      .update(agentThread)
      .set({ seq })
      .where(
        and(
          eq(agentThread.accountId, accountId),
          isNull(agentThread.deletedAt),
          anyOf(agentThread.id, [...threadIds]),
        ),
      );
  }
};

export const pruneChangeSets = async (tx: Tx, now: number) => {
  const reach = now - UNDO_REACH_MS;

  const past = and(
    inArray(
      changeSet.accountId,
      idleAccounts(
        tx,
        tx
          .selectDistinct({ accountId: changeSet.accountId })
          .from(changeSet)
          .where(isNotNull(changeSet.sealedAt)),
      ),
    ),
    isNotNull(changeSet.sealedAt),
  );

  const expired = and(past, lt(changeSet.sealedAt, reach));
  await tx
    .update(file)
    .set({ touchedAt: now })
    .where(
      sql`(${file.accountId}, ${file.sha256}) in ${tx
        .select({ accountId: changeSetFile.accountId, sha256: changeSetFile.sha256 })
        .from(changeSetFile)
        .innerJoin(
          changeSet,
          and(
            eq(changeSet.accountId, changeSetFile.accountId),
            eq(changeSet.id, changeSetFile.changeSetId),
          ),
        )
        .where(expired)}`,
    );

  const gone = await tx
    .delete(changeSet)
    .where(
      sql`${expired} or (${past} and ${notExists(
        tx
          .select({ held: sql`1` })
          .from(changeSetItem)
          .where(
            and(
              eq(changeSetItem.accountId, changeSet.accountId),
              eq(changeSetItem.changeSetId, changeSet.id),
            ),
          ),
      )})`,
    )
    .returning({
      accountId: changeSet.accountId,
      sealedAt: changeSet.sealedAt,
      threadId: changeSet.threadId,
    });

  await stampExpiredThreads(
    tx,
    gone.filter(({ sealedAt }) => sealedAt !== null && sealedAt < reach),
  );

  return gone.length;
};

export const pruneOpAnswers = async (tx: Tx, now: number) => {
  const reach = now - OP_ANSWER_MS;

  const gone = await tx
    .delete(opAnswer)
    .where(
      and(
        lt(opAnswer.at, reach),
        inArray(
          opAnswer.accountId,
          idleAccounts(
            tx,
            tx
              .selectDistinct({ accountId: opAnswer.accountId })
              .from(opAnswer)
              .where(lt(opAnswer.at, reach)),
          ),
        ),
      ),
    )
    .returning({ opId: opAnswer.opId });

  return gone.length;
};
