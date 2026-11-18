import { refusalText } from "@repo/contract/rpc/refusal-text";
import { toast } from "@repo/ui/components/sonner";
import { formatCount } from "@repo/ui/lib/plural";

const chunksOf = <T>(items: readonly T[], size: number) => {
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
  readonly chunk: number;
  readonly verb: string;
  readonly past: string;
  readonly noun?: string;
  readonly show?: "many" | "always";
  readonly run: (chunk: readonly T[]) => Promise<number>;
  readonly done: (count: number) => string;
  readonly action?: () => ToastAction | undefined;
}

const noneLanded = <T>(total: number, { noun = "item", past }: BulkRun<T>) =>
  total === 1
    ? `That ${noun} couldn't be ${past}.`
    : `None of these ${formatCount(total)} ${noun}s could be ${past}.`;

export const runBulk = async <T>(job: BulkRun<T>) => {
  const total = job.items.length;

  if (total === 0) {
    return;
  }

  const calls = chunksOf(job.items, Math.max(1, job.chunk));
  const shown = job.show === "always" || calls.length > 1;
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

  const close = (kind: "success" | "info" | "error", sentence: string) => {
    toast[kind](sentence, {
      action: landed > 0 ? job.action?.() : undefined,
      duration: kind === "error" ? 6000 : 4000,
      id,
    });
  };

  const stopped = () => `Stopped after ${formatCount(landed)} of ${formatCount(total)}.`;

  for (const [at, chunk] of calls.entries()) {
    if (stop) {
      close("info", stopped());

      return;
    }

    asked += chunk.length;

    if (shown) {
      toast.loading(`${job.verb} ${formatCount(asked)} of ${formatCount(total)}…`, {
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
