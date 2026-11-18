// The job table over Postgres: drains at once never share a row, a failed job waits longer each time,
// and an ask made while a job ran outlives that run.

import { deferred } from "@repo/contract/deferred";
import { db } from "@repo/db/drizzle-client";
import { job } from "@repo/db/library-schema";
import { dbSuite } from "@repo/db/test-database";
import { asc, eq } from "drizzle-orm";
import { expect, it } from "vitest";

import { makeAccount } from "../test-support/library-fixture";
import { askJobs, finishJob, leaseJobs, retryJob } from "./job-queue";
import type { JobAsk, Lease } from "./job-queue";

const SECOND = 1000;
const START = 1_700_000_000_000;

const sweepAsk = (accountId: string, at: number): JobAsk => ({
  accountId,
  id: `sweep:test:${String(at)}`,
  kind: "sweep",
  payload: { ids: [String(at)] },
});

const lotOf = (accountId: string, n: number): JobAsk[] =>
  Array.from({ length: n }, (_, at) => sweepAsk(accountId, at));

const leaseSweeps = async (accountId: string, now: number, limit = 1): Promise<Lease[]> =>
  await leaseJobs(db, { accountId, limit, now });

const leaseNext = async (accountId: string, now: number): Promise<Lease> => {
  const [lease] = await leaseSweeps(accountId, now);
  if (lease === undefined) {
    throw new Error("no job was due");
  }
  return lease;
};

const rowsOf = async (accountId: string) =>
  await db
    .select({ attempts: job.attempts, id: job.id, payload: job.payload, runAt: job.runAt })
    .from(job)
    .where(eq(job.accountId, accountId))
    .orderBy(asc(job.id));

dbSuite("the job table", () => {
  it("hands two drains leasing at once disjoint rows, passing over the rows the other holds", async () => {
    const accountId = await makeAccount();
    await askJobs(db, lotOf(accountId, 5), START);
    const holding = deferred();
    const held = deferred<readonly string[]>();
    const first = db.transaction(async (tx) => {
      const taken = await leaseJobs(tx, { accountId, limit: 3, now: START });
      held.resolve(taken.map(({ id }) => id));
      await holding.promise;
    });
    try {
      const firsts = await held.promise;
      const seconds = await leaseSweeps(accountId, START, 10);
      expect(firsts).toHaveLength(3);
      expect(seconds).toHaveLength(2);
      expect(new Set([...firsts, ...seconds.map(({ id }) => id)]).size).toBe(5);
    } finally {
      holding.resolve();
      await first;
    }
    const rows = await rowsOf(accountId);
    expect(rows.map(({ attempts }) => attempts)).toStrictEqual([1, 1, 1, 1, 1]);
    await expect(leaseSweeps(accountId, START + 299 * SECOND)).resolves.toStrictEqual([]);
    await expect(leaseSweeps(accountId, START + 300 * SECOND, 10)).resolves.toHaveLength(5);
  });

  it("leases only the account it is asked for", async () => {
    const mine = await makeAccount();
    const theirs = await makeAccount();
    await askJobs(db, [sweepAsk(mine, 0), sweepAsk(theirs, 0)], START);
    const leased = await leaseSweeps(mine, START, 10);
    expect(leased.map(({ accountId, id }) => ({ accountId, id }))).toStrictEqual([
      { accountId: mine, id: "sweep:test:0" },
    ]);
    await expect(rowsOf(theirs)).resolves.toMatchObject([{ attempts: 0 }]);
    await expect(rowsOf(mine)).resolves.toMatchObject([{ attempts: 1, id: "sweep:test:0" }]);
  });

  it("waits 30 s after a first failure, then 60 s, doubling to an hour at most", async () => {
    const accountId = await makeAccount();
    await askJobs(db, [sweepAsk(accountId, 0)], START);
    const runs: number[] = [];
    const waits: number[] = [];
    let now = START;
    for (let run = 1; run <= 9; run += 1) {
      const lease = await leaseNext(accountId, now);
      runs.push(lease.attempts);
      await retryJob(db, lease, now);
      const [row] = await rowsOf(accountId);
      const next = row?.runAt ?? now;
      await expect(leaseSweeps(accountId, next - 1)).resolves.toStrictEqual([]);
      waits.push((next - now) / SECOND);
      now = next;
    }
    expect(runs).toStrictEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(waits).toStrictEqual([30, 60, 120, 240, 480, 960, 1920, 3600, 3600]);
  });

  it("keeps an ask made while the job ran, which its run's end neither drops nor puts off", async () => {
    const accountId = await makeAccount();
    const asked = sweepAsk(accountId, 0);
    await askJobs(db, [asked], START);
    const lease = await leaseNext(accountId, START);
    const again = START + 10 * SECOND;
    await askJobs(db, [{ ...asked, payload: { ids: ["again"] } }], again);
    await finishJob(db, lease);
    await retryJob(db, lease, again);
    await expect(rowsOf(accountId)).resolves.toStrictEqual([
      { attempts: 0, id: asked.id, payload: { ids: ["again"] }, runAt: again },
    ]);

    // the ask's own run counts 1 again, as the first did, and still outlives the first's end
    const rerun = await leaseNext(accountId, again);
    expect(rerun).toMatchObject({ attempts: lease.attempts, payload: { ids: ["again"] } });
    await finishJob(db, lease);
    await expect(rowsOf(accountId)).resolves.toHaveLength(1);
    await finishJob(db, rerun);
    await expect(rowsOf(accountId)).resolves.toStrictEqual([]);
  });
});
