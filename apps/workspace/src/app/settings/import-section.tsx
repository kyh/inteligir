// Bringing a library in, the cell's job (`library.imports.*`): a Raindrop export or a zip of
// markdown, an Obsidian vault among them, goes up to the library's files by its SHA-256 and is read
// a page at a time, every item it adds in one change set, and Stop ends it after the
// page it is on, keeping what it added. It waits for a connection, and reaches `/v1` under the
// page's session cookie.

import type { importJobSchema } from "@repo/contract/cloud/library/library-wire";
import { keptFileType } from "@repo/notes/items/item-kind";
import { Button } from "@repo/ui/components/button";
import { toast } from "@repo/ui/components/sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import type { z } from "zod";

import { useCloud, useWire } from "../cloud/library-context";
import { FileRefusedError, uploadFile } from "../cloud/library-files";
import { refusalText } from "@repo/contract/cloud/refusal-text";
import { NEEDS_CONNECTION } from "../cloud/needs-connection";
import { formatCount } from "../library/item-labels";
import { Row, SectionHeading } from "./settings-chrome";

type ImportJob = z.infer<typeof importJobSchema>;
type ImportSource = ImportJob["source"];

// a running job is asked again this often, until it ends
const JOB_POLL_MS = 1500;

// what an import says once it ran, or as it runs
/** @internal */
export const importSentence = (job: ImportJob): string => {
  switch (job.state) {
    case "running": {
      return job.total === 0
        ? "Reading the file…"
        : `Added ${formatCount(job.added)} of ${formatCount(job.total)}…`;
    }
    case "done": {
      const parts = [`Added ${formatCount(job.added)}`];
      if (job.alreadySaved > 0) {
        parts.push(`${formatCount(job.alreadySaved)} already in the library`);
      }
      if (job.unreadable > 0) {
        parts.push(`${formatCount(job.unreadable)} couldn't be read`);
      }
      return `${parts.join(", ")}.`;
    }
    case "failed": {
      return job.message ?? "The import stopped.";
    }
    case "cancelled": {
      return `Stopped after adding ${formatCount(job.added)}.`;
    }
    // no default
  }
};

const SOURCES: readonly { source: ImportSource; label: string; accept: string }[] = [
  { accept: ".csv,text/csv", label: "Import from Raindrop…", source: "raindrop" },
  { accept: ".zip,application/zip", label: "Import a zip of notes…", source: "markdown" },
];

const ImportRow = () => {
  const { client, orpc } = useWire();
  const cloud = useCloud();
  const queryClient = useQueryClient();
  const pickerRef = useRef<HTMLInputElement | null>(null);
  const [source, setSource] = useState<ImportSource>("raindrop");
  const latest = useQuery({
    ...orpc.library.imports.latest.queryOptions(),
    refetchInterval: (query) => (query.state.data?.job?.state === "running" ? JOB_POLL_MS : false),
  });
  const start = useMutation({
    mutationFn: async ({ file, from }: { file: File; from: ImportSource }) => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const sha = await uploadFile(cloud, bytes, keptFileType(file.type));
      return await client.library.imports.start({ sha, source: from });
    },
    onError: (cause) => {
      toast.error(
        cause instanceof FileRefusedError
          ? cause.message
          : refusalText(cause, "The import couldn't start."),
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: orpc.library.imports.key() });
    },
  });
  const stop = useMutation(
    orpc.library.imports.cancel.mutationOptions({
      onError: (cause) => {
        toast.error(refusalText(cause, "The import couldn't be stopped."));
      },
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: orpc.library.imports.key() });
      },
    }),
  );
  const job = latest.data?.job ?? null;
  return (
    <Row label="Import">
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap gap-1.5">
          {SOURCES.map((option) => (
            <Button
              key={option.source}
              size="compact"
              variant="secondary"
              disabled={start.isPending || job?.state === "running"}
              onClick={() => {
                setSource(option.source);
                if (pickerRef.current !== null) {
                  pickerRef.current.accept = option.accept;
                  pickerRef.current.click();
                }
              }}
            >
              {option.label}
            </Button>
          ))}
        </div>
        <input
          ref={pickerRef}
          type="file"
          hidden
          aria-label="The file to import"
          onChange={(event) => {
            const [file] = event.currentTarget.files ?? [];
            event.currentTarget.value = "";
            if (file !== undefined) {
              start.mutate({ file, from: source });
            }
          }}
        />
        {latest.fetchStatus === "paused" ? (
          <p className="m-0 text-body text-muted-foreground">{NEEDS_CONNECTION}</p>
        ) : null}
        {job === null ? null : (
          <div className="flex items-center gap-2">
            <p className="m-0 text-body text-muted-foreground" data-import-state={job.state}>
              {importSentence(job)}
            </p>
            {job.state === "running" ? (
              <Button
                size="compact"
                variant="ghost"
                disabled={stop.isPending}
                onClick={() => {
                  stop.mutate({ id: job.id });
                }}
              >
                Stop
              </Button>
            ) : null}
          </div>
        )}
      </div>
    </Row>
  );
};

export const ImportSection = () => (
  <section id="import" className="scroll-mt-10 space-y-2">
    <SectionHeading>Import</SectionHeading>
    <dl className="space-y-3">
      <ImportRow />
    </dl>
  </section>
);
