// A verb over a selection runs as sequential chunks under one progress toast: a move or a tag
// and a purge each call the cell once for each chunk its route takes.
// Stop ends after the chunk in flight; a chunk that fails stops the run at once and says how far it
// got. Each chunk answers how many of it landed, and only those are counted in the closing
// sentence, so a run where none landed says that, a failure among them, rather than a count of 0.

import { BULK_ITEMS_MAX } from "@repo/contract/library/library-wire";
import { refusalText } from "@repo/contract/refusal-text";
import { toast } from "@repo/ui/components/sonner";

import { formatCount } from "./item-labels";

// `items` in order, `size` at a time: as many as one cell call takes
export const chunksOf = <T>(items: readonly T[], size = BULK_ITEMS_MAX): T[][] => {
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    chunks.push(items.slice(start, start + size));
  }
  return chunks;
};

export interface BulkRun<T> {
  readonly items: readonly T[];
  // how many go in one call
  readonly chunk: number;
  // "Tagging": the toast reads "Tagging 1,200 of 8,512…"
  readonly verb: string;
  // "moved": a run where none landed reads "None of these 12 items could be moved."
  readonly past: string;
  // answers how many of the chunk landed
  readonly run: (chunk: readonly T[]) => Promise<number>;
  // the sentence once every chunk ran, given how many landed
  readonly done: (count: number) => string;
}

const noneLanded = (total: number, past: string): string =>
  total === 1
    ? `That item couldn't be ${past}.`
    : `None of these ${formatCount(total)} items could be ${past}.`;

// a run of one chunk needs no progress to watch and nothing to stop
export const runBulk = async <T>(job: BulkRun<T>): Promise<void> => {
  const total = job.items.length;
  if (total === 0) {
    return;
  }
  const size = Math.max(1, job.chunk);
  const shown = total > size;
  // one toast from the first progress to the outcome; a run of one chunk shows the outcome alone
  const id = `bulk-${String(Date.now())}-${String(Math.random())}`;
  // an update by id keeps what the toast held, so an outcome takes the run's Stop off it
  const outcome = (duration: number) => ({ action: undefined, duration, id });
  let stop = false;
  let done = 0;
  let landed = 0;
  const progress = (): void => {
    if (!shown) {
      return;
    }
    toast.loading(`${job.verb} ${formatCount(done)} of ${formatCount(total)}…`, {
      action: {
        label: "Stop",
        onClick: () => {
          stop = true;
        },
      },
      duration: Number.POSITIVE_INFINITY,
      id,
    });
  };
  progress();
  for (const chunk of chunksOf(job.items, size)) {
    if (stop) {
      toast.info(`Stopped after ${formatCount(landed)} of ${formatCount(total)}.`, outcome(4000));
      return;
    }
    try {
      landed += Math.min(chunk.length, Math.max(0, await job.run(chunk)));
    } catch (error) {
      const reached =
        landed === 0
          ? noneLanded(total, job.past)
          : `Stopped after ${formatCount(landed)} of ${formatCount(total)}.`;
      toast.error(`${reached} ${refusalText(error, "The library didn't answer.")}`, outcome(6000));
      return;
    }
    done += chunk.length;
    progress();
  }
  if (landed === 0) {
    toast.error(noneLanded(total, job.past), outcome(6000));
  } else {
    toast.success(job.done(landed), outcome(4000));
  }
};
