import { keepFile } from "../files/keep-file";
import type { JobRun } from "../library/job-queue";
import type { LibraryWriter } from "../library/library-store";
import { fillJobSchema } from "../library/fill-job";
import type { FillJob } from "../library/fill-job";
import { fillWaits, landFill } from "./fill-landing";
import { PAGE_UNREACHED } from "./fill-sentences";
import { fetchPage } from "./page-fetch";
import type { PageFetch } from "./page-fetch";
import { readPage } from "./read-page";
import type { ReadPorts } from "./read-page";

const FILL_TRIES = 4;

const fillWriter = (accountId: string) =>
  ({ accountId, actor: { kind: "fill" } }) satisfies LibraryWriter;

const keptSha = async (writer: LibraryWriter, file: Parameters<ReadPorts["keep"]>[0]) => {
  const kept = await keepFile(writer, file.bytes, file.mime);

  if (!kept.ok) {
    console.warn({ event: "fill-file-refused", refusal: kept.refusal.kind });
  }

  return kept.ok ? kept.value : null;
};

export const fillRun = (fetch: PageFetch) =>
  ({
    payload: fillJobSchema,
    run: async (job, { accountId, final }) => {
      if (!(await fillWaits(accountId, job))) {
        return "done";
      }

      const writer = fillWriter(accountId);
      const keep: ReadPorts["keep"] = async (file) => await keptSha(writer, file);
      const read = await readPage({ fetch, keep }, job);

      if (read.kind === "retry" && !final) {
        return "retry";
      }

      await landFill(
        writer,
        job,
        read.kind === "retry" ? { kind: "failed", sentence: read.sentence } : read.landing,
      );

      return "done";
    },
    tries: {
      exhausted: async (job, { accountId }) => {
        await landFill(fillWriter(accountId), job, { kind: "failed", sentence: PAGE_UNREACHED });
      },
      kind: "at-most",
      max: FILL_TRIES,
    },
  }) satisfies JobRun<FillJob>;

export const FILL_RUN = fillRun(fetchPage);
