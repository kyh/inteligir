// What housekeeping lets go of change sets and op answers over Postgres: each account's on its
// own clock, and none of an account a write holds.

import { randomUUID } from "node:crypto";

import { deferred } from "@repo/contract/deferred";
import { noteFixture } from "@repo/contract/test-support/library-items";
import { db } from "@repo/db/drizzle-client";
import { changeSet, changeSetFile, file, opAnswer } from "@repo/db/library-schema";
import { dbSuite } from "@repo/db/test-database";
import { and, asc, eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { z } from "zod";

import { openThread } from "../agent/agent-threads";
import {
  libraryAs,
  makeAccount,
  personalLibrary,
  seedFile,
  seedItem,
} from "../test-support/library-fixture";
import { sealTurnSet } from "./library-change-sets";
import { pruneChangeSets, pruneOpAnswers } from "./library-prunes";
import { mintLibraryId } from "./library-ids";
import { landItem } from "./library-landing";
import { readItem } from "./library-rows";
import { withAccountLock, writeLibrary } from "./library-store";

const DAY_MS = 24 * 60 * 60_000;
const SHA = "c".repeat(64);

const turnsOf = async (accountId: string) =>
  await db
    .select({ sealed: changeSet.sealedAt, turn: changeSet.turn })
    .from(changeSet)
    .where(eq(changeSet.accountId, accountId))
    .orderBy(asc(changeSet.turn));

const touchedAt = async (accountId: string): Promise<number | undefined> => {
  const [row] = await db
    .select({ touchedAt: file.touchedAt })
    .from(file)
    .where(and(eq(file.accountId, accountId), eq(file.sha256, SHA)));
  return row?.touchedAt;
};

const noteOf = (text: string) => ({
  blocks: [],
  folderId: null,
  id: mintLibraryId(Date.now()),
  savedAt: Date.now(),
  tags: [],
  title: text,
});

// an ended turn that took an item's cover away, so its set holds the cover's file
const coverTakenBy = async (accountId: string, threadId: string, turn: number) => {
  const actor = { kind: "agent", threadId, turn } as const;
  const held = await seedItem(accountId, { fields: noteFixture({ coverSha: SHA }) });
  const landed = await writeLibrary(
    { accountId, actor },
    { answer: z.object({}), opId: undefined },
    async (scope) => {
      const before = await readItem(scope.tx, accountId, held.id);
      if (before === null) {
        throw new Error("the seeded item is gone");
      }
      await landItem(scope, {
        before,
        body: null,
        fields: { ...before.fields, coverSha: null },
        itemId: held.id,
      });
      return {};
    },
  );
  expect(landed.ok).toBe(true);
  await sealTurnSet(db, accountId, { threadId, turn }, Date.now());
};

const prune = async (now: number): Promise<number> =>
  await db.transaction(async (tx) => await pruneChangeSets(tx, now));

dbSuite("housekeeping's prunes", () => {
  it("lets a set go seven days after its turn ended, and an ended set with nothing left at once, touching the files it held", async () => {
    const accountId = await makeAccount();
    await seedFile(accountId, SHA);
    const threadId = randomUUID();
    await coverTakenBy(accountId, threadId, 1);
    expect(
      await db.select().from(changeSetFile).where(eq(changeSetFile.accountId, accountId)),
    ).toHaveLength(1);
    // a turn whose one change was undone, so nothing of it is left
    const undone = libraryAs({ accountId, actor: { kind: "agent", threadId, turn: 2 } });
    await undone.items.create(noteOf("Undone."));
    await sealTurnSet(db, accountId, { threadId, turn: 2 }, Date.now());
    const person = libraryAs({
      accountId,
      actor: { door: "page", kind: "session", sessionId: randomUUID() },
    });
    await person.agent.undo({ threadId, turn: 2 });
    // a turn still open
    await libraryAs({ accountId, actor: { kind: "agent", threadId, turn: 3 } }).items.create(
      noteOf("Open."),
    );

    const now = Date.now();
    await expect(prune(now)).resolves.toBeGreaterThanOrEqual(1);
    await expect(turnsOf(accountId)).resolves.toMatchObject([
      { turn: 1 },
      { sealed: null, turn: 3 },
    ]);

    const later = now + 8 * DAY_MS;
    await prune(later);
    await expect(turnsOf(accountId)).resolves.toStrictEqual([{ sealed: null, turn: 3 }]);
    await expect(touchedAt(accountId)).resolves.toBe(later);
  });

  it("names a thread to every device once its turn's set goes past Undo's reach", async () => {
    const { accountId, library } = await personalLibrary();
    await seedFile(accountId, SHA);
    const threadId = randomUUID();
    await openThread(accountId, { id: threadId, now: Date.now(), title: "Tidy up" });
    await coverTakenBy(accountId, threadId, 1);
    await expect(library.agent.undoable({ threadId })).resolves.toStrictEqual({ turns: [1] });

    const { head } = await library.changes({});
    await prune(Date.now() + 8 * DAY_MS);
    const { moved } = await library.changes({ after: head });
    expect(moved?.threads).toStrictEqual([threadId]);
    await expect(library.agent.undoable({ threadId })).resolves.toStrictEqual({ turns: [] });
  });

  it("passes over an account a write holds, and takes it on its next run", async () => {
    const accountId = await makeAccount();
    await seedFile(accountId, SHA);
    await coverTakenBy(accountId, randomUUID(), 1);
    const later = Date.now() + 8 * DAY_MS;
    const holding = deferred();
    const held = deferred();
    const holder = withAccountLock(accountId, async () => {
      held.resolve();
      await holding.promise;
    });
    try {
      await held.promise;
      await prune(later);
      await expect(turnsOf(accountId)).resolves.toHaveLength(1);
    } finally {
      holding.resolve();
      await holder;
    }
    await prune(later);
    await expect(turnsOf(accountId)).resolves.toStrictEqual([]);
  });

  it("lets an op's answer go thirty days on, past any resend", async () => {
    const accountId = await makeAccount();
    const now = Date.now();
    await withAccountLock(accountId, async (tx) => {
      await tx.insert(opAnswer).values([
        { accountId, answer: {}, at: now - 31 * DAY_MS, opId: "old" },
        { accountId, answer: {}, at: now - 29 * DAY_MS, opId: "recent" },
      ]);
    });
    await expect(
      db.transaction(async (tx) => await pruneOpAnswers(tx, now)),
    ).resolves.toBeGreaterThanOrEqual(1);
    const left = await db
      .select({ opId: opAnswer.opId })
      .from(opAnswer)
      .where(eq(opAnswer.accountId, accountId));
    expect(left).toStrictEqual([{ opId: "recent" }]);
  });
});
