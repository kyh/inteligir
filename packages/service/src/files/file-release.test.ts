import { randomUUID } from "node:crypto";

import { deferred } from "@repo/contract/deferred";
import { noteFixture } from "@repo/contract/test-support/library-items.test-utils";
import { db } from "@repo/db/drizzle-client";
import {
  changeSet,
  changeSetFile,
  changeSetItem,
  file,
  itemFile,
  job,
  libraryState,
} from "@repo/db/library-schema";
import { dbSuite } from "@repo/db/test-database";
import { and, asc, eq } from "drizzle-orm";
import { expect, it, vi } from "vitest";

import { drainJobs } from "../jobs/drain-jobs";
import { withAccountLock } from "../library/library-store";
import { fileOf } from "../test-support/file-uploads.test-utils";
import { makeAccount, seedFile, seedItem } from "../test-support/library.fixture";
import { RELEASE_RUN, releaseUnnamedFiles } from "./file-release";
import { FILE_STORE } from "./file-store-of";
import { keepFile } from "./keep-file";

const HOUR_MS = 60 * 60_000;
const NOW = Date.now();
const OLD = NOW - 25 * HOUR_MS;

const libraryOf = async () => {
  const accountId = await makeAccount();
  await db.insert(libraryState).values({ accountId });

  return accountId;
};

const releaseTries = () => {
  const { tries } = RELEASE_RUN;

  if (tries.kind !== "at-most") {
    throw new Error("a release is tried until it is done");
  }

  return tries.max;
};

const release = async (now = NOW) =>
  await db.transaction(async (tx) => await releaseUnnamedFiles(tx, now));

const heldShas = async (accountId: string) => {
  const rows = await db
    .select({ sha256: file.sha256 })
    .from(file)
    .where(eq(file.accountId, accountId))
    .orderBy(asc(file.sha256));

  return rows.map(({ sha256 }) => sha256);
};

const pathnameOf = async (accountId: string, sha: string) => {
  const [row] = await db
    .select({ pathname: file.pathname })
    .from(file)
    .where(and(eq(file.accountId, accountId), eq(file.sha256, sha)));

  if (row === undefined) {
    throw new Error("the account holds no such file");
  }

  return row.pathname;
};

const named = async (accountId: string, sha: string) => {
  const { id } = await seedItem(accountId, { fields: noteFixture() });
  await db.insert(itemFile).values({ accountId, itemId: id, sha256: sha });
};

const heldBySet = async (accountId: string, sha: string) => {
  const { id: itemId } = await seedItem(accountId, { fields: noteFixture() });
  const changeSetId = randomUUID();
  await db
    .insert(changeSet)
    .values({ accountId, id: changeSetId, threadId: randomUUID(), turn: 1 });
  await db.insert(changeSetItem).values({ accountId, changeSetId, inverse: [], itemId });
  await db.insert(changeSetFile).values({ accountId, changeSetId, itemId, sha256: sha });
};

dbSuite("housekeeping's file release", () => {
  it("lets go a file unnamed past a day and asks its object's removal, keeping a named, held or recent one", async () => {
    const accountId = await libraryOf();
    const [unnamed, itemNamed, setHeld, recent] = ["a", "b", "c", "d"].map((hex) => hex.repeat(64));

    if (
      unnamed === undefined ||
      itemNamed === undefined ||
      setHeld === undefined ||
      recent === undefined
    ) {
      throw new Error("four shas were made");
    }

    for (const sha of [unnamed, itemNamed, setHeld]) {
      await seedFile(accountId, sha, { touchedAt: OLD });
    }

    await seedFile(accountId, recent, { touchedAt: NOW - 23 * HOUR_MS });
    await named(accountId, itemNamed);
    await heldBySet(accountId, setHeld);
    const gone = await pathnameOf(accountId, unnamed);

    await expect(release()).resolves.toBeGreaterThanOrEqual(1);
    await expect(heldShas(accountId)).resolves.toStrictEqual([itemNamed, setHeld, recent]);

    const asked = await db
      .select({ id: job.id, kind: job.kind, payload: job.payload })
      .from(job)
      .where(eq(job.accountId, accountId));

    expect(asked).toStrictEqual([
      { id: `release:${gone}`, kind: "file-release", payload: { pathname: gone } },
    ]);
  });

  it("passes over an account a write holds, and takes it on its next run", async () => {
    const accountId = await libraryOf();
    const sha = "e".repeat(64);
    await seedFile(accountId, sha, { touchedAt: OLD });
    const holding = deferred();
    const held = deferred();

    const holder = withAccountLock(accountId, async () => {
      held.resolve();
      await holding.promise;
    });

    try {
      await held.promise;
      await release();
      await expect(heldShas(accountId)).resolves.toStrictEqual([sha]);
    } finally {
      holding.resolve();
      await holder;
    }

    await release();
    await expect(heldShas(accountId)).resolves.toStrictEqual([]);
  });

  it("removes the object from the store by the job the release asked", async () => {
    const accountId = await makeAccount();
    const { bytes, sha } = fileOf("a cover no item names any more");
    const kept = await keepFile({ accountId, actor: { kind: "fill" } }, bytes, "image/png");
    expect(kept).toStrictEqual({ ok: true, value: sha });
    const pathname = await pathnameOf(accountId, sha);
    await expect(FILE_STORE.head(pathname)).resolves.not.toBeNull();

    await db.update(file).set({ touchedAt: OLD }).where(eq(file.accountId, accountId));
    await release(Date.now());
    await expect(drainJobs({ accountId, budgetMs: 10_000 })).resolves.toStrictEqual({
      dropped: 0,
      failed: 0,
      ran: 1,
    });
    await expect(FILE_STORE.head(pathname)).resolves.toBeNull();
    await expect(db.select().from(job).where(eq(job.accountId, accountId))).resolves.toStrictEqual(
      [],
    );
  });

  it("stops asking a removal the store keeps refusing after its tries, logged once", async () => {
    const accountId = await makeAccount();
    const { bytes, sha } = fileOf("a cover the store won't let go");
    await keepFile({ accountId, actor: { kind: "fill" } }, bytes, "image/png");
    const pathname = await pathnameOf(accountId, sha);
    await db.update(file).set({ touchedAt: OLD }).where(eq(file.accountId, accountId));
    await release(Date.now());

    const tries = releaseTries();
    const remove = vi.spyOn(FILE_STORE, "remove").mockRejectedValue(new Error("the store is down"));
    const logged = vi.spyOn(console, "error");

    try {
      for (let drain = 0; drain <= tries; drain += 1) {
        await drainJobs({ accountId, budgetMs: 10_000 });
        await db.update(job).set({ runAt: Date.now() }).where(eq(job.accountId, accountId));
      }

      expect(remove).toHaveBeenCalledTimes(tries);
      expect(logged.mock.calls).toStrictEqual([
        ...Array.from({ length: tries }, () => [expect.objectContaining({ event: "job-failed" })]),
        [{ event: "file-release-exhausted", pathname, tries }],
      ]);
    } finally {
      remove.mockRestore();
      logged.mockRestore();
    }

    await expect(db.select().from(job).where(eq(job.accountId, accountId))).resolves.toStrictEqual(
      [],
    );
    await expect(FILE_STORE.head(pathname)).resolves.not.toBeNull();
  });
});
