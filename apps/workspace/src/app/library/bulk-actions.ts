// A verb over a selection runs as sequential chunks under one progress toast, so eight thousand
// items are eight thousand small writes the server takes one batch at a time, never one request
// it would refuse or a burst it would queue. Stop ends after the chunk in flight; a transport
// error stops at once and says how many were done. Each chunk answers how many of it landed, and
// only those are counted in the closing sentence: an item a move or a tag refused (and said why
// in its own message) is never reported done, and a run where none landed says nothing more.

import { toast } from "@repo/ui/components/sonner";

import { formatCount } from "./item-labels";

export interface BulkRun<T> {
  readonly items: readonly T[];
  // how many go in one call
  readonly chunk: number;
  // "Tagging": the toast reads "Tagging 1,200 of 8,512…"
  readonly verb: string;
  // answers how many of the chunk landed
  readonly run: (chunk: readonly T[]) => Promise<number>;
  // the sentence once every chunk ran, given how many landed
  readonly done: (count: number) => string;
}

export type BulkOutcome =
  | { kind: "done"; count: number }
  | { kind: "stopped"; count: number }
  | { kind: "failed"; count: number; error: unknown };

// a run of one chunk needs no progress to watch and nothing to stop
export const runBulk = async <T>(job: BulkRun<T>): Promise<BulkOutcome> => {
  const total = job.items.length;
  const size = Math.max(1, job.chunk);
  const shown = total > size;
  // one toast from the first progress to the outcome; a run of one chunk shows the outcome alone
  const id = `bulk-${String(Date.now())}-${String(Math.random())}`;
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
  for (let start = 0; start < total; start += size) {
    if (stop) {
      toast.info(`Stopped after ${formatCount(done)} of ${formatCount(total)}.`, {
        duration: 4000,
        id,
      });
      return { count: done, kind: "stopped" };
    }
    const chunk = job.items.slice(start, start + size);
    try {
      landed += Math.min(chunk.length, Math.max(0, await job.run(chunk)));
    } catch (error) {
      toast.error(
        `Stopped after ${formatCount(done)} of ${formatCount(total)}: the library didn't answer.`,
        { duration: 6000, id },
      );
      return { count: done, error, kind: "failed" };
    }
    done += chunk.length;
    progress();
  }
  if (landed === 0) {
    toast.dismiss(id);
  } else {
    toast.success(job.done(landed), { duration: 4000, id });
  }
  return { count: landed, kind: "done" };
};
