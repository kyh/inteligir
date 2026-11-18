// The drain over Postgres, with runs of the suite's own: each due job run once and ended, a failure
// put off, an unreadable payload dropped, a job past its tries handed to `exhausted` once, and every
// account's due jobs taken by the cron's drain.

import { db } from "@repo/db/drizzle-client";
import { job } from "@repo/db/library-schema";
import { dbSuite } from "@repo/db/test-database";
import { eq } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { z } from "zod";

import { makeAccount } from "../test-support/library-fixture";
import { drainJobs } from "./drain-jobs";
import { JOB_RUNS, leasedRun } from "./job-kinds";
import type { JobRun, JobRuns } from "./job-kinds";
import { askJobs } from "./job-queue";

const BUDGET_MS = 10_000;

const lotSchema = z.object({ ids: z.array(z.string()) });
type Lot = z.output<typeof lotSchema>;

const UNTIL_DONE: JobRun<Lot>["tries"] = { kind: "until-done" };

// a run of sweep jobs that keeps what it was handed and answers as `outcome` says
const sweepsBy = (
  outcome: (
    lot: Lot,
    job: { readonly attempts: number; readonly final: boolean },
  ) => "done" | "retry",
  tries: JobRun<Lot>["tries"] = UNTIL_DONE,
) => {
  const seen: { accountId: string; attempts: number; final: boolean; ids: string[] }[] = [];
  const run: JobRun<Lot> = {
    payload: lotSchema,
    run: async (lot, attempt) => {
      seen.push({ ...attempt, ids: lot.ids });
      return await Promise.resolve(outcome(lot, attempt));
    },
    tries,
  };
  const runs: JobRuns = { ...JOB_RUNS, sweep: leasedRun(run) };
  return { runs, seen };
};

const askSweeps = async (accountId: string, lots: readonly string[]) => {
  await askJobs(
    db,
    lots.map((lot) => ({
      accountId,
      id: `sweep:${lot}`,
      kind: "sweep" as const,
      payload: { ids: [lot] },
    })),
    Date.now(),
  );
};

const rowsOf = async (accountId: string) =>
  await db
    .select({ attempts: job.attempts, id: job.id, runAt: job.runAt })
    .from(job)
    .where(eq(job.accountId, accountId));

// every waiting job of the account due now, as if its backoff had passed
const dueNow = async (accountId: string) => {
  await db.update(job).set({ runAt: Date.now() }).where(eq(job.accountId, accountId));
};

dbSuite("the drain", () => {
  it("runs each due job of the account once and ends it", async () => {
    const accountId = await makeAccount();
    await askSweeps(accountId, ["a", "b", "c"]);
    const { runs, seen } = sweepsBy(() => "done");
    await expect(drainJobs({ accountId, budgetMs: BUDGET_MS, runs })).resolves.toStrictEqual({
      dropped: 0,
      failed: 0,
      ran: 3,
    });
    expect(seen.map(({ ids }) => ids.join(",")).toSorted()).toStrictEqual(["a", "b", "c"]);
    expect(seen.every((each) => each.accountId === accountId && each.attempts === 1)).toBe(true);
    await expect(rowsOf(accountId)).resolves.toStrictEqual([]);
  });

  it("puts off a job whose run throws or asks to be tried again, by its backoff", async () => {
    const accountId = await makeAccount();
    await askSweeps(accountId, ["throws", "again"]);
    const failed = vi.spyOn(console, "error").mockImplementation(() => {});
    const { runs } = sweepsBy(({ ids }) => {
      if (ids.includes("throws")) {
        throw new Error("the store is down");
      }
      return "retry";
    });
    const before = Date.now();
    try {
      await expect(drainJobs({ accountId, budgetMs: BUDGET_MS, runs })).resolves.toStrictEqual({
        dropped: 0,
        failed: 2,
        ran: 0,
      });
      expect(failed).toHaveBeenCalledWith(expect.objectContaining({ event: "job-failed" }));
    } finally {
      failed.mockRestore();
    }
    const rows = await rowsOf(accountId);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.attempts).toBe(1);
      expect(row.runAt).toBeGreaterThanOrEqual(before + 30_000);
      expect(row.runAt).toBeLessThanOrEqual(Date.now() + 30_000);
    }
  });

  it("drops a job whose payload its kind no longer reads", async () => {
    const accountId = await makeAccount();
    await askJobs(
      db,
      [{ accountId, id: "sweep:old", kind: "sweep", payload: { verb: "an older shape" } }],
      Date.now(),
    );
    const unread = vi.spyOn(console, "error").mockImplementation(() => {});
    const { runs, seen } = sweepsBy(() => "done");
    try {
      await expect(drainJobs({ accountId, budgetMs: BUDGET_MS, runs })).resolves.toStrictEqual({
        dropped: 1,
        failed: 0,
        ran: 0,
      });
      expect(unread).toHaveBeenCalledWith(expect.objectContaining({ event: "job-unreadable" }));
    } finally {
      unread.mockRestore();
    }
    expect(seen).toStrictEqual([]);
    await expect(rowsOf(accountId)).resolves.toStrictEqual([]);
  });

  it("tells a job's last try it is the last, and hands a job past its tries to exhausted once", async () => {
    const accountId = await makeAccount();
    await askSweeps(accountId, ["stuck"]);
    const exhausted = vi.fn(async () => {
      await Promise.resolve();
    });
    const { runs, seen } = sweepsBy(() => "retry", { exhausted, kind: "at-most", max: 2 });
    for (let drain = 1; drain <= 4; drain += 1) {
      await drainJobs({ accountId, budgetMs: BUDGET_MS, runs });
      await dueNow(accountId);
    }
    expect(seen.map(({ attempts, final }) => ({ attempts, final }))).toStrictEqual([
      { attempts: 1, final: false },
      { attempts: 2, final: true },
    ]);
    expect(exhausted).toHaveBeenCalledOnce();
    expect(exhausted).toHaveBeenCalledWith({ ids: ["stuck"] }, { accountId, attempts: 3 });
    await expect(rowsOf(accountId)).resolves.toStrictEqual([]);
  });

  it("leases nothing once its budget is spent", async () => {
    const accountId = await makeAccount();
    await askSweeps(accountId, ["later"]);
    const { runs } = sweepsBy(() => "done");
    await expect(drainJobs({ accountId, budgetMs: 0, runs })).resolves.toStrictEqual({
      dropped: 0,
      failed: 0,
      ran: 0,
    });
    await expect(rowsOf(accountId)).resolves.toMatchObject([{ attempts: 0 }]);
  });

  it("takes every account's due jobs when it names none, as the cron's does", async () => {
    const mine = await makeAccount();
    const theirs = await makeAccount();
    await askSweeps(mine, ["mine"]);
    await askSweeps(theirs, ["theirs"]);
    const { runs, seen } = sweepsBy(() => "done");
    await drainJobs({ accountId: null, budgetMs: BUDGET_MS, runs });
    const ours = seen.filter(({ accountId }) => accountId === mine || accountId === theirs);
    expect(ours.map(({ ids }) => ids.join(",")).toSorted()).toStrictEqual(["mine", "theirs"]);
    await expect(rowsOf(mine)).resolves.toStrictEqual([]);
    await expect(rowsOf(theirs)).resolves.toStrictEqual([]);
  });
});
