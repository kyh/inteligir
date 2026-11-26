import { RELEASE_RUN } from "../files/file-release";
import { PDF_TEXT_RUN } from "../files/pdf-text-run";
import { FILL_RUN } from "../fill/fill-run";
import { SWEEP_RUN } from "../library/library-sweeps";
import { MEANING_RUN } from "../meaning/meaning-run";
import type { JobKind, JobOutcome, JobRun, Lease } from "../library/job-queue";

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
  meaning: leasedRun(MEANING_RUN),
  "pdf-text": leasedRun(PDF_TEXT_RUN),
  sweep: leasedRun(SWEEP_RUN),
};
