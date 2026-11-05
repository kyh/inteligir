// Bringing a library in and taking it out, both the cell's jobs (`library.imports.*`,
// `library.exports.*`): a Raindrop export or a zip of markdown (this app's export, or an Obsidian
// vault) goes up to the library's files by its SHA-256 and is read a page at a time, every item it
// adds in one change set History shows, and Stop ends it after the page it is on, keeping what it
// added; an export is a zip in the same format, written in the cloud and saved from
// `/v1/exports/<id>` while it is kept. Each waits for a connection, and each reaches `/v1` through
// the page's host, the tab's cookie or the Mac's credential.

import { V1_BLOBS_PATH, V1_EXPORTS_PATH } from "@repo/contract/cloud/library/library-blobs";
import type { importJobSchema } from "@repo/contract/cloud/library/library-wire";
import { fileSha } from "@repo/library-replica/library-replica";
import type { ReplicaTransport } from "@repo/library-replica/replica-ports";
import { Button } from "@repo/ui/components/button";
import { toast } from "@repo/ui/components/sonner";
import { skipToken, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import type { z } from "zod";

import { useCloud, useWire } from "../cloud/library-context";
import { NEEDS_CONNECTION, refusalText } from "../cloud/needs-connection";
import { formatBytes, formatCount } from "../library/item-labels";
import { Row, SectionHeading } from "./settings-chrome";

type ImportJob = z.infer<typeof importJobSchema>;
type ImportSource = ImportJob["source"];

// a running job is asked again this often, until it ends
const JOB_POLL_MS = 1500;

// what an import says once it ran, or as it runs
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

// the store's refusal of a file, or of an export, in the person's words
class UploadRefusedError extends Error {
  override name = "UploadRefusedError";
}

// the file's bytes in the library's files, by their SHA-256, which the import then names
const uploadFile = async (cloud: ReplicaTransport, file: File): Promise<string> => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const sha = fileSha(bytes);
  const response = await cloud.fetch(
    new Request(`${cloud.origin}${V1_BLOBS_PATH}/${sha}`, {
      body: bytes,
      headers: { "content-type": file.type === "" ? "application/octet-stream" : file.type },
      method: "PUT",
    }),
  );
  if (!response.ok) {
    throw new UploadRefusedError(
      response.status === 413
        ? "This file is larger than the library takes."
        : "The file couldn't be sent. Try again.",
    );
  }
  return sha;
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
      const sha = await uploadFile(cloud, file);
      return await client.library.imports.start({ sha, source: from });
    },
    onError: (cause) => {
      toast.error(
        cause instanceof UploadRefusedError
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

// the export's own name for itself, which the cloud gives as it serves the zip
const savedNameOf = (disposition: string | null): string =>
  /filename="(?<name>[^"]+)"/u.exec(disposition ?? "")?.groups?.name ?? "library.zip";

// how long a saved zip's address outlives the click that saved it, so the save has begun
const SAVED_ADDRESS_MS = 60_000;

// the zip fetched through the page's host and handed to the browser's own download: the tab's
// cookie and the Mac's credential both ride the fetch, where a bare link carries neither of the Mac's
const saveExport = async (cloud: ReplicaTransport, id: string): Promise<void> => {
  const response = await cloud.fetch(new Request(`${cloud.origin}${V1_EXPORTS_PATH}/${id}`));
  if (!response.ok) {
    await response.body?.cancel();
    throw new UploadRefusedError("That export is gone. Export again.");
  }
  const address = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = address;
  link.download = savedNameOf(response.headers.get("content-disposition"));
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(address);
  }, SAVED_ADDRESS_MS);
};

const ExportRow = () => {
  const { orpc } = useWire();
  const cloud = useCloud();
  const save = useMutation({
    mutationFn: async (id: string) => {
      await saveExport(cloud, id);
    },
    onError: (cause) => {
      toast.error(
        cause instanceof UploadRefusedError
          ? cause.message
          : "The zip couldn't be saved. Try again.",
      );
    },
  });
  const [exportId, setExportId] = useState<string | null>(null);
  const start = useMutation(
    orpc.library.exports.start.mutationOptions({
      onError: (cause) => {
        toast.error(refusalText(cause, "The export couldn't start."));
      },
      onSuccess: (answer) => {
        setExportId(answer.export.id);
      },
    }),
  );
  const current = useQuery({
    ...orpc.library.exports.get.queryOptions({
      input: exportId === null ? skipToken : { id: exportId },
    }),
    refetchInterval: (query) =>
      query.state.data?.export.state === "writing" ? JOB_POLL_MS : false,
  });
  const job = current.data?.export ?? null;
  return (
    <Row label="Export">
      <div className="flex flex-col gap-1.5">
        <Button
          size="compact"
          variant="secondary"
          className="self-start"
          disabled={start.isPending || job?.state === "writing"}
          onClick={() => {
            start.mutate({});
          }}
        >
          Export the library
        </Button>
        {job === null ? null : (
          <p className="m-0 text-body text-muted-foreground" data-export-state={job.state}>
            {job.state === "writing" ? "Writing the zip…" : null}
            {job.state === "ready" ? (
              <a
                href={`${cloud.origin}${V1_EXPORTS_PATH}/${job.id}`}
                download
                className="underline"
                onClick={(event) => {
                  event.preventDefault();
                  save.mutate(job.id);
                }}
              >
                Download the zip{job.bytes === null ? "" : ` (${formatBytes(job.bytes)})`}
              </a>
            ) : null}
            {job.state === "failed" ? (job.message ?? "The export stopped.") : null}
            {job.state === "expired" ? "That export is gone. Export again." : null}
          </p>
        )}
      </div>
    </Row>
  );
};

export const ImportExportSection = () => (
  <section id="import" className="scroll-mt-10 space-y-2">
    <SectionHeading>Import and export</SectionHeading>
    <dl className="space-y-3">
      <ImportRow />
      <ExportRow />
    </dl>
  </section>
);
