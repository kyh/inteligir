// The `fill` job's run (`../jobs/job-kinds`): one page the cloud reads for one account's item, run
// once its write commits, at once by the drain the save's door kicked. A job is read only while its
// item still waits for it; the reading (`./read-page`) keeps its files in the library as it goes
// (`../files/keep-file`) and lands in one write (`./fill-landing`), which lands it once however
// often the job runs. A page a later try may get past (a timeout, a site saying it is busy) is put
// off by the job's backoff until its last try, which says the page's own failure in the item; a
// run that threw is tried again, and past its tries the item says the page couldn't be reached, so
// no link waits unread for good.

import { keepFile } from "../files/keep-file";
import type { JobRun } from "../jobs/job-kinds";
import type { LibraryWriter } from "../library/library-store";
import { fillJobSchema } from "./fill-job";
import type { FillJob } from "./fill-job";
import { fillWaits, landFill } from "./fill-landing";
import { PAGE_UNREACHED } from "./fill-sentences";
import { fetchPage } from "./page-fetch";
import type { PageFetch } from "./page-fetch";
import { readPage } from "./read-page";
import type { ReadPorts } from "./read-page";

// one try and three more, 30 s, 60 s and 120 s apart by the job's backoff
const FILL_TRIES = 4;

const fillWriter = (accountId: string): LibraryWriter => ({ accountId, actor: { kind: "fill" } });

// bytes kept as a library file, or null when the library refused them (full, or the account gone)
const keptSha = async (
  writer: LibraryWriter,
  file: Parameters<ReadPorts["keep"]>[0],
): Promise<string | null> => {
  const kept = await keepFile(writer, file.bytes, file.mime);
  if (!kept.ok) {
    console.warn({ event: "fill-file-refused", refusal: kept.refusal.kind });
  }
  return kept.ok ? kept.value : null;
};

// the run over `fetch`, the guarded web's in production and a suite's web in its own
export const fillRun = (fetch: PageFetch): JobRun<FillJob> => ({
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
});

export const FILL_RUN = fillRun(fetchPage);
