// an import is a server job over a copy of the file: a plan reads it and answers what it would
// add, a start runs that plan in batches, and the job's counts reach the page as import-changed.

import type {
  ImportJob,
  ImportSource,
  ImportsPlanResponse,
} from "@repo/contract/local/imports/imports-schema";
import { ImportsError } from "./imports-error";

export interface ImportService {
  // throws ImportsError "unreadable" with its reason
  plan: (source: ImportSource, bytes: Uint8Array) => Promise<ImportsPlanResponse>;
  start: (planId: string) => Promise<ImportJob>;
  // the latest job, or null when this library never imported
  status: () => Promise<ImportJob | null>;
  cancel: (id: string) => Promise<ImportJob>;
  // resumes a job a shutdown stopped between batches
  boot: () => void;
  dispose: () => Promise<void>;
}

export interface ImportServiceDeps {
  // bus.notifyVault(["import-changed"]), each time a job's counts or state move
  notify: () => void;
  dataDir: string;
  now: () => Date;
  newId: () => string;
}

// PIVOT-STUB(S3): replaced by the Raindrop plan and the batched job (§4.8, §10)
export const createImportService = (_deps: ImportServiceDeps): ImportService => ({
  boot: () => {
    /* no job to resume */
  },
  cancel: () => Promise.reject(new ImportsError("job-not-found")),
  dispose: () => Promise.resolve(),
  plan: () =>
    Promise.reject(new ImportsError("unreadable", { message: "PIVOT-STUB(S3)", reason: "empty" })),
  start: () => Promise.reject(new ImportsError("plan-gone")),
  status: () => Promise.resolve(null),
});
