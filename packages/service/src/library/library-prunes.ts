// What housekeeping lets go of each account's library (`../jobs/housekeeping`): change sets past
// Undo's reach, and op answers past a resend's, each of an account no write holds now
// (`./idle-accounts`), so a prune never races a write.

import { agentThread } from "@repo/db/agent-schema";
import type { Tx } from "@repo/db/drizzle-client";
import { changeSet, changeSetFile, changeSetItem, file, opAnswer } from "@repo/db/library-schema";
import { and, eq, inArray, isNotNull, isNull, lt, notExists, sql } from "drizzle-orm";

import { idleAccounts } from "./idle-accounts";
import { takeLibraryHead } from "./library-store";
import { anyOf } from "./set-sql";

const DAY_MS = 24 * 60 * 60_000;
// how far back Undo reaches: a set goes this long after its turn ended
const UNDO_REACH_MS = 7 * DAY_MS;
// an op's id answers a resend for this long
const OP_ANSWER_MS = 30 * DAY_MS;

// The live threads whose turns' sets went past Undo's reach, each account's stamped with its
// library's next sequence, so every open panel drops those turns' Undo; a set left with nothing
// showed none
const stampExpiredThreads = async (
  tx: Tx,
  expired: readonly { readonly accountId: string; readonly threadId: string }[],
): Promise<void> => {
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

// Every set whose turn ended past Undo's reach, gone with its entries and its threads stamped, and
// every ended set left with nothing to take back, of each account no write holds; the files only
// those sets named are touched, so each is let go a day on. Callable inside the caller's
// transaction; answers how many sets went
export const pruneChangeSets = async (tx: Tx, now: number): Promise<number> => {
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

// every op's answer kept past a resend's reach, of each account no write holds; callable inside the
// caller's transaction, it answers how many went
export const pruneOpAnswers = async (tx: Tx, now: number): Promise<number> => {
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
