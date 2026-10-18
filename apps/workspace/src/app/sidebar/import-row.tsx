// The rail's footer while a Raindrop import runs: how far it has got, and Stop. The job is the
// server's, so the row reads its status, which the bus refetches on every import-changed; a job
// this window saw running that has finished says so once, in a toast.

import type { ImportJob } from "@repo/contract/local/imports/imports-schema";
import { Button } from "@repo/ui/components/button";
import { toast } from "@repo/ui/components/sonner";
import { plural } from "@repo/ui/lib/plural";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useEffectEvent, useRef } from "react";

import { failed, orpc } from "../api";
import { formatCount } from "../library/item-labels";

// how many of the job's items it has been through, the ones it found already saved included
const progressOf = (job: ImportJob): number => Math.min(job.total, job.added + job.alreadySaved);

const finishedToast = (job: ImportJob, onShowLibrary: () => void): void => {
  switch (job.state) {
    case "done": {
      toast.success(`Added ${plural(job.added, "item")} from Raindrop`, {
        action: { label: "Show in library", onClick: onShowLibrary },
      });
      break;
    }
    case "cancelled": {
      toast.info(`Import stopped. ${plural(job.added, "item")} from Raindrop were added.`);
      break;
    }
    case "failed": {
      toast.error(job.message ?? "The import from Raindrop stopped.");
      break;
    }
    case "running": {
      break;
    }
    // no default
  }
};

export const ImportRow = ({ onShowLibrary }: { onShowLibrary: () => void }) => {
  const queryClient = useQueryClient();
  const statusQuery = useQuery(orpc.imports.status.queryOptions());
  const job = statusQuery.data?.job ?? null;
  const cancel = useMutation(
    orpc.imports.cancel.mutationOptions({
      onError: (error) => {
        failed(error, "The import couldn't be stopped.");
      },
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: orpc.imports.status.key() });
      },
    }),
  );
  // the job this window last saw running, so only an import that finished while it watched toasts
  const watched = useRef<string | null>(null);
  const settled = useEffectEvent((finished: ImportJob) => {
    finishedToast(finished, onShowLibrary);
  });

  useEffect(() => {
    if (job === null) {
      return;
    }
    if (job.state === "running") {
      watched.current = job.id;
      return;
    }
    if (watched.current === job.id) {
      watched.current = null;
      settled(job);
    }
  }, [job]);

  if (job === null || job.state !== "running") {
    return null;
  }
  const done = progressOf(job);
  return (
    <div className="flex flex-col gap-1 px-2 pt-1 pb-2" aria-live="polite">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-body text-ink-2">
          Importing from Raindrop · {formatCount(done)} of {formatCount(job.total)}
        </span>
        <Button
          variant="ghost"
          size="compact"
          onClick={() => {
            cancel.mutate({ id: job.id });
          }}
        >
          Stop
        </Button>
      </div>
      <progress
        aria-label="Import from Raindrop"
        max={Math.max(job.total, 1)}
        value={done}
        className="h-1 w-full appearance-none overflow-hidden rounded-full bg-line [&::-moz-progress-bar]:bg-primary [&::-webkit-progress-bar]:bg-line [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-primary"
      />
    </div>
  );
};
