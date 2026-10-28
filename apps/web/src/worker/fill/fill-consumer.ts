// The fill queue's consumer: each message one page the cloud reads for one account's item
// (`./fill-job`), handled one at a time and settled on its own, so a slow page holds up no other
// message's answer. A message is read only while its item still waits for it; the reading
// (`./read-page`) keeps its files in the library as it goes and lands in one awaited call to the
// account's cell, which lands it once however often the message comes. A page a later try may get
// past (a timeout, a site saying it is busy) is asked again, later each time, until the queue's
// retries are spent, and then said in the item; a message whose handling threw goes back to the
// queue, and one the retries could not handle reaches the dead-letter queue, whose consumer says
// the failure in the item, so no link waits unread for good.

import { failureOf, TEXT_NOT_SAVED } from "@repo/notes/items/fill-sentences";

import { libraryCell } from "../library/library-cell";
import type { LibraryDO } from "../library/library-do";
import { errorFields } from "../log";
import { fillJobSchema } from "./fill-job";
import type { FillJob } from "./fill-job";
import type { FillLanding } from "./fill-landing";
import { FILL_FAILED_QUEUE, FILL_RETRIES } from "./fill-queues";
import { fetchPage } from "./page-fetch";
import { readPage } from "./read-page";
import { storeFile } from "./store-file";

const RETRY_BASE_SECONDS = 30;
const RETRY_MAX_SECONDS = 15 * 60;

// the wait before a message's next delivery, doubling from 30 s with each it has had
const retryDelaySeconds = (attempts: number): number =>
  Math.min(RETRY_MAX_SECONDS, RETRY_BASE_SECONDS * 2 ** Math.max(0, attempts - 1));

const failedLanding = (job: FillJob, sentence: string): FillLanding => ({
  itemId: job.itemId,
  kind: "failed",
  sentence,
  url: job.url,
});

// what the dead-letter queue says in an item the retries could not read
const UNREACHED = failureOf({ kind: "unreachable", transient: false }).sentence;

type Cell = DurableObjectStub<LibraryDO>;

// the reading landed; one naming a file the library let go before it landed is read again, as an
// outbox uploads a file the cell says is missing, and one the cell could not keep (the library full,
// the article past what an item holds) is said as a page whose text couldn't be saved
const land = async (cell: Cell, job: FillJob, landing: FillLanding): Promise<void> => {
  const landed = await cell.landFill(landing);
  if (landed.ok || landed.refusal.kind === "gone" || landing.kind === "failed") {
    return;
  }
  if (landed.refusal.kind === "blob-missing") {
    throw new Error("a file the reading kept left the library before the reading landed");
  }
  console.warn({ event: "fill-landing-refused", refusal: landed.refusal.kind });
  await cell.landFill(failedLanding(job, TEXT_NOT_SAVED));
};

const consumeOne = async (
  env: Env,
  exports: Cloudflare.Exports,
  message: Message,
  job: FillJob,
  deadLetter: boolean,
): Promise<void> => {
  const cell = libraryCell(exports, job.accountId);
  if (deadLetter) {
    await land(cell, job, failedLanding(job, UNREACHED));
    message.ack();
    return;
  }
  const wanted = await cell.fillWanted(job.itemId, job.url);
  if (!wanted.ok || !wanted.value) {
    message.ack();
    return;
  }
  const read = await readPage(
    {
      fetch: fetchPage,
      keep: async (file) => await storeFile(env.BLOBS, cell, job.accountId, file),
    },
    job,
  );
  if (read.kind === "retry" && message.attempts <= FILL_RETRIES) {
    message.retry({ delaySeconds: retryDelaySeconds(message.attempts) });
    return;
  }
  await land(cell, job, read.kind === "retry" ? failedLanding(job, read.sentence) : read.landing);
  message.ack();
};

// the queue handler the Worker exports (`../server.ts`), for the fill queue and its dead letters
export const consumeFills = async (
  batch: MessageBatch,
  env: Env,
  ctx: ExecutionContext,
): Promise<void> => {
  const deadLetter = batch.queue === FILL_FAILED_QUEUE;
  for (const message of batch.messages) {
    const job = fillJobSchema.safeParse(message.body);
    if (!job.success) {
      // a message no deploy of this Worker sends: nothing names an item to say it in
      console.error({ event: "fill-job-malformed", id: message.id, queue: batch.queue });
      message.ack();
      continue;
    }
    try {
      await consumeOne(env, ctx.exports, message, job.data, deadLetter);
    } catch (error) {
      console.error({
        attempts: message.attempts,
        event: "fill-failed",
        queue: batch.queue,
        ...errorFields(error),
      });
      message.retry({ delaySeconds: retryDelaySeconds(message.attempts) });
    }
  }
};
