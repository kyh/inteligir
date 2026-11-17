// CLAUDE.md § A verb that makes several calls is one run, under one toast with Stop. A move, a tag, a
// pin, a delete, a restore and a purge call the cell once for each chunk its route takes, and a save
// once for each link or file. Stop ends after the call in flight; a call that fails stops the run at
// once and says how far it got. Each call answers how many of it landed, and only those are counted
// in the closing sentence, so a run where none landed says that, a failure among them, rather than a
// count of 0.

import { refusalText } from "@repo/contract/refusal-text";
import { toast } from "@repo/ui/components/sonner";

import { formatCount } from "./item-labels";

// `items` in order, `size` at a time: as many as one cell call takes
const chunksOf = <T>(items: readonly T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    chunks.push(items.slice(start, start + size));
  }
  return chunks;
};

interface ToastAction {
  readonly label: string;
  readonly onClick: () => void;
}

export interface BulkRun<T> {
  readonly items: readonly T[];
  // how many go in one call
  readonly chunk: number;
  // "Tagging": the toast reads "Tagging 1,200 of 8,512…"
  readonly verb: string;
  // "moved": a run where none landed reads "None of these 12 items could be moved."
  readonly past: string;
  // what one of `items` is, when not an item: "link" reads "That link couldn't be saved."
  readonly noun?: string;
  // "always" for a call that takes a while, as a file's upload does; by default progress shows
  // only once a run takes more than one call
  readonly show?: "many" | "always";
  // answers how many of the chunk landed
  readonly run: (chunk: readonly T[]) => Promise<number>;
  // the sentence once every chunk ran, given how many landed
  readonly done: (count: number) => string;
  // the button on the closing toast of a run where any landed, stopped or not: Delete's Undo of
  // what went, a lone saved link's Open
  readonly action?: () => ToastAction | undefined;
}

const noneLanded = <T>(total: number, { noun = "item", past }: BulkRun<T>): string =>
  total === 1
    ? `That ${noun} couldn't be ${past}.`
    : `None of these ${formatCount(total)} ${noun}s could be ${past}.`;

export const runBulk = async <T>(job: BulkRun<T>): Promise<void> => {
  const total = job.items.length;
  if (total === 0) {
    return;
  }
  const calls = chunksOf(job.items, Math.max(1, job.chunk));
  const shown = job.show === "always" || calls.length > 1;
  // one toast from the first progress to the outcome
  const id = `bulk-${String(Date.now())}-${String(Math.random())}`;
  let stop = false;
  let asked = 0;
  let landed = 0;
  const stopButton: ToastAction = {
    label: "Stop",
    onClick: () => {
      stop = true;
    },
  };
  // an update by id keeps what the toast held, so an outcome names its own button, or none, to
  // take the run's Stop off it
  const close = (kind: "success" | "info" | "error", sentence: string): void => {
    toast[kind](sentence, {
      action: landed > 0 ? job.action?.() : undefined,
      duration: kind === "error" ? 6000 : 4000,
      id,
    });
  };
  const stopped = (): string => `Stopped after ${formatCount(landed)} of ${formatCount(total)}.`;
  for (const [at, chunk] of calls.entries()) {
    if (stop) {
      close("info", stopped());
      return;
    }
    asked += chunk.length;
    if (shown) {
      toast.loading(`${job.verb} ${formatCount(asked)} of ${formatCount(total)}…`, {
        // only while a call after this one is left to skip
        action: at === calls.length - 1 ? undefined : stopButton,
        duration: Number.POSITIVE_INFINITY,
        id,
      });
    }
    try {
      landed += Math.min(chunk.length, Math.max(0, await job.run(chunk)));
    } catch (error) {
      const reached = landed === 0 ? noneLanded(total, job) : stopped();
      close("error", `${reached} ${refusalText(error, "The library didn't answer.")}`);
      return;
    }
  }
  if (landed === 0) {
    close("error", noneLanded(total, job));
  } else {
    close("success", job.done(landed));
  }
};
