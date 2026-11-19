import type { z } from "zod";

import { RELEASE_RUN } from "../files/file-release";
import { FILL_RUN } from "../fill/fill-run";
import { SWEEP_RUN } from "../library/library-sweeps";
import type { JobKind, Lease } from "./job-queue";

type JobOutcome = "done" | "retry";

type JobAttempt = Pick<Lease, "accountId" | "attempts">;

type Tries<P> =
  | { readonly kind: "until-done" }
  | {
      readonly kind: "at-most";
      readonly max: number;
      readonly exhausted: (payload: P, job: JobAttempt) => Promise<void>;
    };

export interface JobRun<P> {
  readonly payload: z.ZodType<P>;
  readonly tries: Tries<P>;
  readonly run: (payload: P, job: JobAttempt & { readonly final: boolean }) => Promise<JobOutcome>;
}

type LeasedRun = (lease: Lease) => Promise<JobOutcome | "unreadable">;

export const leasedRun = <P>({ payload, run, tries }: JobRun<P>) =>
  (async ({ accountId, attempts, payload: stored }) => {
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
  }) satisfies LeasedRun;

export type JobRuns = { readonly [K in JobKind]: LeasedRun };

export const JOB_RUNS: JobRuns = {
  "file-release": leasedRun(RELEASE_RUN),
  fill: leasedRun(FILL_RUN),
  sweep: leasedRun(SWEEP_RUN),
};
