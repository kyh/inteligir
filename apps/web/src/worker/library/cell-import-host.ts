// What an import's run works with inside the account's cell: the engine every write lands
// through, the bucket the library's files live in, and the steps its runs share. An item lands as
// a write of the import's own actor, so every item one import adds is one change set History
// shows and Undo takes back; the job's rows move in the same transaction.

import { z } from "zod";

import type { CellActor } from "./cell-actor";
import { blobKey } from "./cell-blobs";
import type { ImportJob } from "./cell-import-jobs";
import type { LandingScope } from "./cell-landing";
import { settleStored } from "./cell-library";
import type { LibraryEngine } from "./library-engine";

export interface ImportHost {
  readonly env: Env;
  readonly accountId: string;
  readonly library: LibraryEngine;
  // the platform's clock, which a test moves
  readonly now: () => number;
  // every write so far on disk (`ctx.storage.sync()`), so what a run counted before its work
  // stands even when the platform ends the run
  readonly durable: () => Promise<void>;
}

// what one run of a job came to: more to do, the job done, or stopped with the reason said
export type StepOutcome =
  | { readonly kind: "more" }
  | { readonly kind: "done" }
  | { readonly kind: "failed"; readonly message: string };

export const MORE: StepOutcome = { kind: "more" };
export const DONE: StepOutcome = { kind: "done" };
export const failed = (message: string): StepOutcome => ({ kind: "failed", message });

// a run's page ends past this much wall time, which moves only while the run waits on R2, past
// the bytes it read, or past its own count of rows, whichever comes first: the clock bounds a run's
// waiting, never its CPU, which the bytes and the count keep well inside an alarm's 30 s
export const PAGE_MS = 10_000;

export const LIBRARY_FULL =
  "Your library is full, so the import stopped. Free some room and import again.";

const LABELS = {
  markdown: "Imported from Markdown",
  raindrop: "Imported from Raindrop",
} as const;

export const importActor = (job: ImportJob): CellActor => ({
  jobId: job.id,
  kind: "import",
  label: LABELS[job.source],
});

const NOTHING = z.object({});

// a write of the job's own rows alone, joining no change set; false once the account is going
export const apart = (library: LibraryEngine, work: (scope: LandingScope) => void): boolean =>
  library.landApart({ answer: NOTHING, opId: undefined }, (scope) => {
    work(scope);
    return {};
  }).ok;

// a file the import brings, put in the library as a device's upload is: room asked at its size,
// the bytes put in R2 under their sha, which R2 checks, and the row settled at what R2 holds;
// `full` when the library has no room for it
export const keepFile = async (
  host: ImportHost,
  file: {
    readonly sha: string;
    readonly size: number;
    readonly mime: string;
    readonly body: () => Promise<ReadableStream<Uint8Array> | Uint8Array>;
  },
): Promise<"kept" | "full" | "lost"> => {
  const room = host.library.reserve({ bytes: file.size, mime: file.mime, sha: file.sha });
  if (!room.ok) {
    return room.refusal.kind === "quota" ? "full" : "lost";
  }
  if (room.value.held) {
    return "kept";
  }
  await host.env.BLOBS.put(blobKey(host.accountId, file.sha), await file.body(), {
    httpMetadata: { contentType: file.mime },
    sha256: file.sha,
  });
  const settled = await settleStored(host.env, host.accountId, host.library, file.sha);
  if (!settled.ok) {
    return settled.refusal.kind === "quota" ? "full" : "lost";
  }
  return settled.value.settled ? "kept" : "lost";
};
