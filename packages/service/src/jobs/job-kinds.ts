// What a job of each kind runs, by the kind its row names (`./job-queue`): its payload's schema, how
// often it is tried and its run, written beside its area's code and closed over its payload's type
// here, so the drain holds every kind alike and a kind the table names with no entry fails to
// compile.

import type { z } from "zod";

import { RELEASE_RUN } from "../files/file-release";
import { FILL_RUN } from "../fill/fill-run";
import { SWEEP_RUN } from "../library/library-sweeps";
import type { JobKind, Lease } from "./job-queue";

type JobOutcome = "done" | "retry";

// a leased job as its run sees it: its account, and which run of it this is
type JobAttempt = Pick<Lease, "accountId" | "attempts">;

type Tries<P> =
  // run until it is done, each failure waiting longer, an hour at most
  | { readonly kind: "until-done" }
  // run `max` times, the last told it is; past them the job goes to `exhausted`, which ends it
  | {
      readonly kind: "at-most";
      readonly max: number;
      readonly exhausted: (payload: P, job: JobAttempt) => Promise<void>;
    };

export interface JobRun<P> {
  readonly payload: z.ZodType<P>;
  readonly tries: Tries<P>;
  // "retry" puts the job off by its backoff, as a throw does
  readonly run: (payload: P, job: JobAttempt & { readonly final: boolean }) => Promise<JobOutcome>;
}

// a kind's run as the drain holds it: "unreadable" for a payload its kind no longer reads
type LeasedRun = (lease: Lease) => Promise<JobOutcome | "unreadable">;

export const leasedRun =
  <P>({ payload, run, tries }: JobRun<P>): LeasedRun =>
  async ({ accountId, attempts, payload: stored }) => {
    const read = payload.safeParse(stored);
    if (!read.success) {
      return "unreadable";
    }
    const job = { accountId, attempts };
    if (tries.kind === "until-done") {
      return await run(read.data, { ...job, final: false });
    }
    if (attempts > tries.max) {
      await tries.exhausted(read.data, job);
      return "done";
    }
    return await run(read.data, { ...job, final: attempts === tries.max });
  };

export type JobRuns = { readonly [K in JobKind]: LeasedRun };

export const JOB_RUNS: JobRuns = {
  "file-release": leasedRun(RELEASE_RUN),
  fill: leasedRun(FILL_RUN),
  sweep: leasedRun(SWEEP_RUN),
};
